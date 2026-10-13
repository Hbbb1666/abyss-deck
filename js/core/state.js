/**
 * 全局游戏状态 G + 存档
 * 卡组以 {id, up} 形式存储（轻量、好序列化），进战斗时再水化成卡实例。
 */
import { makeRng, clamp } from './util.js';
import { CARDS, makeCard, rewardPool } from '../data/cards.js';
import { RELICS, relicPool } from '../data/relics.js';
import { POTIONS } from '../data/potions.js';
import { CLASSES, startingDeck } from '../data/classes.js';
import { pickById, scoreOf } from '../data/difficulty.js';

const SAVE_KEY = 'abyss_deck_save_v1';
const META_KEY = 'abyss_deck_meta_v1';

export let G = null;

/* ---------- 新开一局 ---------- */
export function newRun(clsId, seed, picks = []) {
  const cls = CLASSES[clsId];
  const s = seed ?? (Math.random() * 0xffffffff) >>> 0;
  G = {
    seed: s,
    rng: makeRng(s),
    cls: clsId,
    act: 1,
    floor: 0,
    hp: cls.hp, maxHp: cls.hp,
    baseMaxHp: cls.hp,
    gold: cls.gold,
    potionSlots: 3,
    deck: startingDeck(clsId).map(id => ({ id, up: false })),
    relics: [],
    potions: [],
    picks: [...picks],              // 本局选的难度/增益条目（id 数组）
    map: null,
    node: null,
    pending: null,
    visited: {},
    path: [],
    stats: { kills: 0, elites: 0, bosses: 0, floors: 0, cardsPlayed: 0, dmgDealt: 0, dmgTaken: 0, turns: 0 },
    startedAt: Date.now(),
    over: null, // 'win' | 'dead'
  };
  addRelic(cls.relic, true);
  applyPickStartBonuses();
  return G;
}

/**
 * 只汇总"难度/增益"那部分修正。
 * ⚠️ 开局加成必须用这个，**不能用 relicMods()** ——
 * 后者把遗物也算进来了，而遗物的 maxHp/potionSlots 已经在 addRelic() 里生效过一次，
 * 再套一遍就是**重复叠加**（选一件 +10 生命的遗物会变成 +20）。
 * 我第一版就是直接用 relicMods()，靠这条注释才没把 bug 留下来。
 */
export function pickMods() {
  const out = {};
  for (const id of (G.picks || [])) {
    const def = pickById(id);
    if (!def) continue;
    for (const [k, v] of Object.entries(def.mods || {})) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      else out[k] = v;
    }
  }
  return out;
}

/**
 * 把"开局生效"的难度/增益修正落到实处。
 * 为什么单独一步而不是在 relicMods() 读的时候顺手做：
 *   maxHp / potionSlots / 初始金币 / 初始药水 / 额外遗物 都是**一次性**效果，
 *   而 relicMods() 每场战斗都会调用 —— 放在那里会被反复叠加。
 * 顺序：先调属性，再给遗物（额外遗物自身还可能带 maxHp 等修正）。
 */
function applyPickStartBonuses() {
  const m = pickMods();                       // ← 只取难度/增益，不含遗物
  if (m.maxHp) gainMaxHp(m.maxHp);
  if (m.potionSlots) G.potionSlots = Math.max(1, G.potionSlots + m.potionSlots);
  if (m.bonusGold) gainGold(m.bonusGold);
  if (m.startExtraRelic) {
    for (let i = 0; i < m.startExtraRelic; i++) {
      const id = rollRelic(['common', 'uncommon']);
      if (id) addRelic(id, true);
    }
  }
  if (m.startPotion) {
    for (let i = 0; i < m.startPotion; i++) {
      if (G.potions.length >= G.potionSlots) break;
      addPotion(rollPotion());
    }
  }
}

/* ---------- 生命上限 ----------
   提升上限时**当前生命同步增加相同的量**（上限涨 10，血也涨 10）——
   不然"最大生命 +10"对满血玩家等于没效果，拿到手毫无感觉。
   降低上限时只做夹紧，不会把人直接扣死。 */
export function gainMaxHp(n) {
  if (!n) return;
  G.maxHp = Math.max(1, G.maxHp + n);
  G.baseMaxHp = Math.max(1, (G.baseMaxHp ?? G.maxHp) + n);
  if (n > 0) G.hp = Math.min(G.maxHp, G.hp + n);
  else G.hp = clamp(G.hp, 0, G.maxHp);
}

/* ---------- 遗物 ---------- */
export const hasRelic = id => G.relics.includes(id);

export function addRelic(id, silent) {
  if (!id || G.relics.includes(id)) return false;
  const def = RELICS[id];
  // 未知遗物 id 直接忽略。G.relics 是**存进存档**的，一旦某个遗物被删掉/改名，
  // 老存档里就会留着一个已经不存在于 RELICS 的 id —— 不校验的话，
  // 光是把存档读出来渲染一遍（relicEl 读 .rarity）就会抛异常把整个界面搞崩。
  if (!def) return false;
  G.relics.push(id);
  const m = def.mods || {};
  if (m.maxHp) gainMaxHp(m.maxHp);
  if (m.potionSlots) G.potionSlots = Math.max(1, G.potionSlots + m.potionSlots);
  return true;
}

/** 汇总所有遗物**以及所选难度/增益**的静态修正。
 *
 * 为什么把难度并进来：难度规则的效果（怪物血量/攻击、商店价格、营火治疗…）
 * 和遗物是同一类东西 —— 都是"若干条静态修正"。并进来之后，
 * 战斗、地图、商店、营火照旧只读 `relicMods()`，完全不需要知道难度的存在，
 * 也不用在二十几个调用点各判断一次"有没有开这条难度"。 */
export function relicMods() {
  const out = {};
  const add = def => {
    for (const [k, v] of Object.entries(def.mods || {})) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      else out[k] = v;
    }
  };
  for (const id of G.relics) {
    const def = RELICS[id];
    if (!def) continue;                       // 防线：脏 id 直接跳过
    add(def);
  }
  for (const id of (G.picks || [])) {
    const def = pickById(id);
    if (!def) continue;                       // 防线：难度条目被删掉后老存档还留着 id
    add(def);
  }
  return out;
}

/** 汇总遗物与难度/增益的钩子。
 *
 * 返回 `[id, 函数, 定义]` 三元组 —— **第三个元素是必须的**：
 * 调用点以前写的是 `hook(this, card, RELICS[id])`，而 id 现在也可能是难度条目
 * （不在 RELICS 里）→ 那里会变成 `undefined`。把定义一起带出来，
 * 调用点就不必关心钩子来自遗物还是难度。
 */
export function relicHooks(name) {
  const out = [];
  for (const id of G.relics) {
    if (!RELICS[id]) continue;                // 防线：脏 id 直接跳过
    const fn = RELICS[id].hooks?.[name];
    if (fn) out.push([id, fn, RELICS[id]]);
  }
  for (const id of (G.picks || [])) {
    const def = pickById(id);
    const fn = def?.hooks?.[name];
    if (fn) out.push([id, fn, def]);
  }
  return out;
}

/* ---------- 难度选择 ---------- */
export const hasPicks = id => (G.picks || []).includes(id);
export const pickScore = () => scoreOf(G.picks || []);

/* ---------- 卡组 ---------- */
export function addCardToDeck(id, up = false) { G.deck.push({ id, up }); }
export function deckCount(id) { return G.deck.filter(c => c.id === id).length; }

export function removeCardAt(i) {
  if (i < 0 || i >= G.deck.length) return;
  G.deck.splice(i, 1);
}
export function upgradeCardAt(i) {
  const c = G.deck[i];
  if (c && CARDS[c.id] && CARDS[c.id].up && !c.up) c.up = true;
}
export function hydrate(entry) { return makeCard(entry.id, entry.up); }

/* ---------- 药水 ---------- */
export function addPotion(p) {
  if (G.potions.length >= G.potionSlots) return false;
  G.potions.push(p);
  return true;
}
export function removePotionAt(i) { G.potions.splice(i, 1); }

/** 统一的「获得金币」入口。
    所有**赚到的**钱都走这里，这样难度词条（如「获得的金币减少 30%」）只需读一个乘区；
    花费不走这里 —— 花钱时不该再被同一个乘区打一次折。
    返回**实际到账**的数额（提示文案要显示真实数字，不能显示税前）。 */
export function gainGold(n) {
  if (!n) return 0;
  if (n < 0) { G.gold = Math.max(0, G.gold + n); return n; }
  const mult = relicMods().goldMult ?? 1;
  const real = Math.max(0, Math.round(n * mult));
  G.gold += real;
  return real;
}

/* ---------- 奖励池 ---------- */
/** 职业专属卡相对中立卡的权重。调高 = 更容易拿到本职业的牌。
    设计意图：玩家选了这个职业，就应该主要在强化这个职业的打法，
    不然奖励里一半是中立牌，构筑会越来越趋同。 */
export const CLASS_CARD_WEIGHT = 3;

/** 终结牌的抽取权重（普通稀少度的牌是 1，职业牌 ×3）。
 *
 * 产品要求"获得权重较低" —— 它们是**一次性的大牌**，摸到一张就定型了，
 * 出现得太多会让每局都变成"等终结牌"。
 * 0.18 的含义：一次金卡位里，终结牌的出现概率大约是同池普通牌的 1/6。
 * 配合 `unique`（牌组里有一张就不再给第二张），一局通常只会见到 1~2 张。 */
export const FINISHER_WEIGHT = 0.18;

/** 这张卡现在能不能进奖励池。
 *  `unique` 的终结牌：牌组里已经有一张就不再出现（产品要求"有一个就不会获得第二个"）。 */
function rewardEligible(c) {
  if (!c.unique) return true;
  return !(G.deck || []).some(d => d && d.id === c.id);
}

export function rollCardChoices(n = 3) {
  const cls = G.cls;
  // 终结牌不再按 58/32/10 的普通稀有度分布掷 —— 它们自成一体，
  // 这里把 `finisher` 当成第四个档位，用一个很小的概率单独掷。
  // 不这么做的话，终结牌混进 rare 池会把金卡位的概率整体稀释掉。
  const rarityRoll = () => G.rng.weighted([['common', 58], ['uncommon', 32], ['rare', 10], ['finisher', 4]]);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const r = rarityRoll();
    // 同一个稀有度里，专属卡的抽取权重是中立卡的 CLASS_CARD_WEIGHT 倍
    const pool = rewardPool(cls, [r])
      .filter(c => rewardEligible(c))
      .filter(c => !out.some(x => x.id === c.id));
    if (!pool.length) continue;
    const c = G.rng.weighted(pool.map(x => [
      x,
      (x.cls === cls ? CLASS_CARD_WEIGHT : 1) * (x.finisher ? FINISHER_WEIGHT : 1),
    ]));
    out.push(c);
  }
  // 兜底：池子太小时放宽
  if (out.length < n) for (const c of G.rng.sample(rewardPool(cls), n)) if (!out.some(x => x.id === c.id)) out.push(c);
  return out.slice(0, n).map(c => ({ id: c.id, up: false }));
}

export function rollRelic(rarities = ['common', 'uncommon', 'rare']) {
  const owned = new Set(G.relics);
  const pool = relicPool(rarities).filter(r => !owned.has(r.id));
  if (!pool.length) return null;
  return G.rng.pick(pool).id;
}

export function rollPotion() {
  const ids = Object.keys(POTIONS);
  return { ...POTIONS[G.rng.pick(ids)] };
}

/* ---------- 存档 ---------- */
export function save() {
  if (!G) return;
  try {
    const snap = { ...G, rngState: G.rng.getState(), rng: undefined };
    localStorage.setItem(SAVE_KEY, JSON.stringify(snap));
  } catch (e) { console.warn('存档失败', e); }
}

export function hasSave() {
  try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
}

export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    s.rng = makeRng(s.seed);
    if (s.rngState != null) s.rng.setState(s.rngState);
    // JSON 反序列化后 map.nodes 与 map.byRow 是两份互不相干的对象，
    // 任何依赖对象引用相等的代码都会失效 —— 这里统一重建一次。
    if (s.map && Array.isArray(s.map.nodes)) {
      const rows = [];
      const maxR = s.map.nodes.reduce((m, n) => Math.max(m, n.r), 0);
      for (let r = 0; r <= maxR + 1; r++) rows.push(s.map.nodes.filter(n => n.r === r).sort((a, b) => a.c - b.c));
      s.map.byRow = rows;

      // 修补旧存档：早期版本有个 bug 导致 Boss 格子被随机成了普通房间，
      // 那样打完顶层也进不了下一层。这里补一个 Boss 回去，别让玩家白打一局。
      if (s.map.boss && !s.map.nodes.some(n => n.type === 'boss')) {
        const br = s.map.boss.r, bc = s.map.boss.c;
        const cand = s.map.nodes.filter(n => n.r === br && n.type !== 'rest');
        const target = cand.find(n => n.c === bc) || cand.sort((a, b) => Math.abs(a.c - bc) - Math.abs(b.c - bc))[0];
        if (target) { target.type = 'boss'; target.c = bc; s.map.boss = target; }
      }
    }
    // 清洗存档里引用了"已经不存在的数据"的条目。
    // G.relics / G.deck 存的是 id，而 id 指向的数据表是会被改的
    // （删掉一件遗物、重命名一张卡）—— 不清掉的话，这些脏 id 会在
    // 渲染时到处炸（relicMods 每场战斗都读，relicEl 直接读 .rarity）。
    // 集中在这里处理，比在二十几个调用点各加一次防护可靠得多。
    const dropped = { relics: [], cards: [] };
    if (Array.isArray(s.relics)) {
      const keep = s.relics.filter(id => RELICS[id]);
      dropped.relics = s.relics.filter(id => !RELICS[id]);
      s.relics = keep;
    }
    if (Array.isArray(s.deck)) {
      const keep = s.deck.filter(c => c && CARDS[c.id]);
      dropped.cards = s.deck.filter(c => !c || !CARDS[c.id]).map(c => c && c.id);
      s.deck = keep;
    }
    if (dropped.relics.length || dropped.cards.length) {
      console.warn('[存档修补] 丢弃了已不存在的条目 —— 遗物:',
        dropped.relics.join(',') || '无', '/ 卡牌:', dropped.cards.join(',') || '无');
    }

    /* ---------------------------------------------------------------
       🔴 字段兜底（2026-10-13 加）—— 这是"结算界面卡死"的真凶。

       老存档（或任何一次字段改名/新增之前的存档）里可能**缺字段**，
       而读档之后到处直接读它们，第一个撞上的地方就抛 TypeError，
       把整个场景渲染打断 → 玩家看到的是**卡死/白屏**（因为 go() 是
       先 clear 再 append，抛错时旧界面已经删了）。

       产品实测的那次：「第 1 层 Boss 打完后结算卡死」——
       `rewardScene` 第一件事就是 `G.stats.bosses++`，而老存档没有 `stats`，
       于是 `Cannot read properties of undefined (reading 'bosses')`。

       以前只有 relics/deck 做了清洗（因为它们是"引用了已删除的数据"），
       但**结构性字段缺失**同样致命、而且更难发现（只有走到那一步才炸）。
       这里一次性把所有必需字段补齐，比在二十几个读取点各加 `?.` 可靠。 */
    s.stats = { kills: 0, elites: 0, bosses: 0, floors: 0, cardsPlayed: 0, dmgDealt: 0, dmgTaken: 0, turns: 0, ...(s.stats || {}) };
    s.visited = s.visited || {};
    s.path = Array.isArray(s.path) ? s.path : [];
    s.potions = Array.isArray(s.potions) ? s.potions : [];
    s.relics = Array.isArray(s.relics) ? s.relics : [];
    s.deck = Array.isArray(s.deck) ? s.deck : [];
    s.picks = Array.isArray(s.picks) ? s.picks : [];
    s.gold = typeof s.gold === 'number' ? s.gold : 99;
    s.potionSlots = typeof s.potionSlots === 'number' ? s.potionSlots : 3;
    s.hp = typeof s.hp === 'number' ? s.hp : 50;
    s.maxHp = typeof s.maxHp === 'number' ? s.maxHp : 50;
    s.baseMaxHp = typeof s.baseMaxHp === 'number' ? s.baseMaxHp : s.maxHp;
    s.act = typeof s.act === 'number' ? s.act : 1;
    s.over = s.over || null;
    s.startedAt = s.startedAt || Date.now();
    // 牌组为空会让整个玩法失去意义（打不出任何牌）——退回该职业的起始卡组。
    // 用 startingDeck() 而不是自己拼 classes.js 里的 deck 数组：那个函数已经
    // 处理了"发牌"的细节，自己拼等于把同一套逻辑再写一遍（迟早对不上）。
    if (!s.deck.length && CLASSES[s.cls]) {
      s.deck = startingDeck(s.cls);
      console.warn('[存档修补] 牌组为空，已重置为该职业的起始卡组');
    }

    G = s;
    return G;
  } catch { return null; }
}

export function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch {} }

/* ---------- 跨局统计 ---------- */
export function loadMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || { runs: 0, wins: 0, best: 0, totalKills: 0 }; }
  catch { return { runs: 0, wins: 0, best: 0, totalKills: 0 }; }
}
export function saveMeta(m) { try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {} }
export function bumpMeta(patch) {
  const m = { ...loadMeta(), ...patch };
  saveMeta(m); return m;
}

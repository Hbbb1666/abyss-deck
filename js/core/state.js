/**
 * 全局游戏状态 G + 存档
 * 卡组以 {id, up} 形式存储（轻量、好序列化），进战斗时再水化成卡实例。
 */
import { makeRng, clamp } from './util.js';
import { CARDS, makeCard, rewardPool } from '../data/cards.js';
import { RELICS, relicPool } from '../data/relics.js';
import { POTIONS } from '../data/potions.js';
import { CLASSES, startingDeck } from '../data/classes.js';

const SAVE_KEY = 'abyss_deck_save_v1';
const META_KEY = 'abyss_deck_meta_v1';

export let G = null;

/* ---------- 新开一局 ---------- */
export function newRun(clsId, seed) {
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
  return G;
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

/** 汇总所有遗物的静态修正 */
export function relicMods() {
  const out = {};
  for (const id of G.relics) {
    const def = RELICS[id];
    if (!def) continue;                       // 防线：脏 id 直接跳过
    for (const [k, v] of Object.entries(def.mods || {})) {
      if (typeof v === 'number') out[k] = (out[k] || 0) + v;
      else out[k] = v;
    }
  }
  return out;
}

/** 汇总遗物钩子 */
export function relicHooks(name) {
  return G.relics
    .filter(id => RELICS[id])                 // 防线：脏 id 直接跳过
    .map(id => RELICS[id].hooks?.[name] && [id, RELICS[id].hooks[name]])
    .filter(Boolean);
}

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

/* ---------- 奖励池 ---------- */
/** 职业专属卡相对中立卡的权重。调高 = 更容易拿到本职业的牌。
    设计意图：玩家选了这个职业，就应该主要在强化这个职业的打法，
    不然奖励里一半是中立牌，构筑会越来越趋同。 */
export const CLASS_CARD_WEIGHT = 3;

export function rollCardChoices(n = 3) {
  const cls = G.cls;
  const rarityRoll = () => G.rng.weighted([['common', 58], ['uncommon', 32], ['rare', 10]]);
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < 200) {
    const r = rarityRoll();
    // 同一个稀有度里，专属卡的抽取权重是中立卡的 CLASS_CARD_WEIGHT 倍
    const pool = rewardPool(cls, [r]).filter(c => !out.some(x => x.id === c.id));
    if (!pool.length) continue;
    const c = G.rng.weighted(pool.map(x => [x, x.cls === cls ? CLASS_CARD_WEIGHT : 1]));
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

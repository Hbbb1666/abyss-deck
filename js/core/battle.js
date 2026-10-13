/**
 * 战斗引擎
 * 与 UI 解耦：所有展示通过 this.view 回调，引擎只负责规则与状态。
 */
import { gainGold, G, relicMods, relicHooks, hydrate, gainMaxHp } from './state.js';
import { ENEMIES, actScale } from '../data/enemies.js';
import { CARDS, makeCard } from '../data/cards.js';
import { RELICS } from '../data/relics.js';
import { sleep, clamp } from './util.js';

/* ================= 状态效果定义 ================= */
/** 敌人强度的层级缩放。基础曲线在 data/enemies.js 的 actScale()，
    这里再叠加**难度选项**的"每层额外增幅"（enemyHpPerAct / enemyAtkPerAct），
    并补一个兜底（act 缺失/非法时按第 1 层算）。
    第 1 层不吃额外增幅（n=0）—— 否则"每层增幅"会变成"开局就变强"。 */
const enemyScale = (act, mods = {}) => {
  const base = actScale(act || 1);
  const n = Math.max(0, (act | 0) - 1);          // 第 1 层不吃难度里的"每层额外增幅"
  return {
    hp: base.hp * (1 + (mods.enemyHpPerAct || 0) * n),
    atk: base.atk * (1 + (mods.enemyAtkPerAct || 0) * n),
  };
};

/** 敌人招式的"层级缩放后"基础伤害（还没算力量/虚弱/易伤）。
    界面预告与实际结算都把这个值交给 calcDamage() —— 用同一个函数，
    就不可能再出现"预告 12、实际打 15"这类不一致。 */
function defDamage(def, e) {
  return Math.round((def.dmg || 0) * (e.atkMult || 1));
}

/** 把 desc 里的 N 换成实际层数，得到一句话说明 */
export function stText(k, n) {
  const d = ST[k];
  if (!d) return '';
  return d.desc.replace(/N/g, String(n ?? 0));
}

/** 每层虚弱让**每一次伤害结算**少打多少点。
    注意是**固定值**不是百分比：虚弱 3 层，则每一段伤害都 -3。
    分段的招式（如 3×4）会**每段各扣一次**，所以 3 层虚弱下 3 段 4 点 → 3×(4-3)=3 点。
    因为扣的是固定值，大伤害不会被压成 0（22 点挨 3 层虚弱仍然打出 19 点），
    只有本来就很小段的攻击才可能被削到 0 —— 这正是这套曲线想要的手感。 */
export const WEAK_FLAT_PER_STACK = 1;

/** 易伤：每层让**每一段**受到的伤害 **+1**（固定值，不是百分比）。
 *
 * 2026-10-13 从"受到的伤害 ×1.5"改成固定值加法（桌面端）—— 手机端那份累积补丁
 * 是在旧基线上做的，会把它退回 ×1.5，合并时按产品的定义重新落回固定值。
 * 为什么改：
 *   · 百分比模型下，易伤对小段攻击几乎没用（3 点 ×1.5 = 4，只多 1 点），
 *     对单发大招却极强（30 点 → 45）—— 强弱差被放大成 15 倍。
 *   · 固定值模型下，每一层对**每一段**都 +1，所以"多段攻击"和"多叠易伤"
 *     两种构筑都能吃满收益，和虚弱的 -1 也刚好对称（一个加、一个减）。
 *   · 与虚弱一样，**分段招式每段各算一次**：3 段攻击、目标 2 层易伤 → 每段 +2，合计 +6。
 *
 * 衰减仍然是"轮到它自己的回合结束时 -1"（见 tickEnd），层数 == 还能生效几轮。 */
export const VULN_FLAT_PER_STACK = 1;

/** 脆弱：每层让受到的**每一段**伤害 **+7%**（比例放大），最多叠加到 9 层。
 *
 * 2026-10-13 重新定义。它以前是"**自己获得的护甲** -25%"（作用于产出），
 * 现在改成"**受到的伤害** +7%/层"（作用于承伤），和易伤同属"放大伤害"这一类。
 *
 * 为什么和易伤并存而不是合并 —— 两者**乘区不同**，所以对不同牌型强弱相反：
 *   · 易伤是**固定 +1/层/段** → 对**多段小伤害**收益极高（3 段 4 点 ×2 层 = +6）
 *   · 脆弱是**比例 +7%/层** → 对**单发大伤害**收益极高（30 点 ×9 层 = +18.9）
 * 于是"叠易伤"和"叠脆弱"是两条不同的构筑方向，而不是同一个东西的两个名字。
 *
 * 上限 9 层是**硬上限**（产品给定）：9 × 7% = +63%，再往上会失控。
 * 衰减规则与易伤/虚弱一致 —— 轮到它自己的回合结束时 -1（见 tickEnd）。 */
export const FRAIL_PCT = 7;
export const FRAIL_MAX_STACKS = 9;

/** Boss 的**第一次攻击**打几折。0.7 = 减伤 30%。
    目的：玩家刚进 Boss 房往往还没铺好护甲/缓冲，Boss 一记大招就能直接带走 ——
    这种"初见杀"不是技术差距，是信息差。给第一击打个折，让玩家至少有一次反应机会。
    注意是"第一次**攻击**"而不是"第一回合"：Boss 若先加 buff，那一击仍然享受减伤。 */
export const BOSS_FIRST_ATTACK_MULT = 0.85;

export const ST = {
  strength: { pri: 90, name: '力量', icon: '⬆', desc: '攻击伤害 +N', buff: true, color: '#ff8a5c' },
  dexterity: { pri: 85, name: '敏捷', icon: '✦', desc: '获得的护甲 +N', buff: true, color: '#6ee7a8' },
  vulnerable: { pri: 88, name: '易伤', icon: '✸', desc: '每层使受到的**每一段**伤害 +1，自身回合结束时 -1', color: '#ff5c8a' },
  weak: { pri: 86, name: '虚弱', icon: '↓', desc: '每层使**每一次**造成的伤害 -1（分段招式每段都扣，每段至少留 1），回合结束 -1', color: '#c07bff' },
  energy_cap: { pri: 92, name: '能量饱和', icon: '◉', desc: '每回合能量上限 +N', buff: true, color: '#8fd4ff' },
  // 真理：奥术法师专属。本身没有直接效果，它的作用是**在引擎里当"多段加成"的计数器**：
  // 每层让本来就有多段的攻击/技能牌多打 1 次（见 effHits）。
  // 能量枯竭：深层 Boss 专属。下一回合能量 -N，结算后清除（不是每回合都扣）。
  drained: { pri: 89, name: '能量枯竭', icon: '⚡', color: '#c07bff',
             desc: '下一回合的能量 <b>-N</b>（结算一次后消失）' },
  truth: { pri: 90, name: '真理', icon: '◆', color: '#d8b4ff', buff: true,
           desc: '每层使<b>多段</b>攻击/技能牌额外多打 <b>1</b> 次' },
  // 流血：DOT，但**结算时机与中毒/灼烧不同** —— 怪物**行动之后**才结算，
  // 且每跳造成 N 点伤害后**层数减半**（奇数取下）。见 settleBleed()。
  // 游侠的职业 DOT。
  bleed: { pri: 92, name: '流血', icon: '✚', color: '#ff6b7a',
           desc: '它行动后失去 N 点生命（无视护甲），然后层数<b>减半</b>（奇数取下）' },
  freeze: { pri: 97, name: '冰冻', icon: '❄', sprite: 'icon_freeze', color: '#b8f0ff', desc: '怪物：轮到它行动时消耗 <b>1</b> 层、受最大生命 <b>5%</b> 伤害并跳过这次行动。<b>玩家</b>：本回合能量<b>减半</b>' },
  frost: { pri: 91, name: '冰霜', icon: '❄', sprite: 'icon_frost', color: '#8ee6ff', desc: '集满后转化为 <b>1</b> 层冰冻（普通/精英 <b>3</b> 层，Boss <b>5</b> 层）。不会自然衰减' },
  burn: { pri: 93, name: '点燃', icon: '火', sprite: 'icon_burn', color: '#ff7a3c', desc: '轮到它行动时失去 N 点生命，然后 -1' },
  poison: { pri: 95, name: '中毒', icon: '☠', desc: '轮到它行动时失去 N 点生命，然后 -2', color: '#7ee787' },
  regen: { pri: 40, name: '再生', icon: '✚', desc: '回合结束回复 N 点生命，然后 -1', buff: true, color: '#7ee787' },
  thorns: { pri: 80, name: '荆棘', icon: '✹', desc: '被攻击时反弹 N 点伤害', buff: true, color: '#ffb04a' },
  // 强化（原「仪式」）：每回合开始获得 N 层力量，滚雪球型。
  ritual: { pri: 78, name: '强化', icon: '☯', desc: '每回合开始获得 N 层力量', buff: true, color: '#ff8a5c' },
  barricade: { pri: 72, name: '壁垒', icon: '▣', desc: '护甲不再于回合结束时消失', buff: true, color: '#ffcc52' },
  extra_draw: { pri: 66, name: '洞察', icon: '❖', desc: '每回合额外抽 N 张牌', buff: true, color: '#8fd4ff' },
  poison_plus: { pri: 60, name: '淬毒', icon: '☠', desc: '施加中毒时额外 +N 层', buff: true, color: '#7ee787' },
  bleed_plus: { pri: 61, name: '血涌', icon: '✚', desc: '施加流血时额外 +N 层', buff: true, color: '#ff8a95' },
  block_next: { pri: 50, name: '备战', icon: '⛨', desc: '下回合获得 N 点护甲', buff: true, color: '#8fa8c0' },
  // 脆弱（2026-10-13 重新定义）：原来作用于"自己获得的护甲 -25%"，
  // 现在改成**受伤放大**——每层让受到的**每一段**伤害 +7%，最多 9 层，轮到它自己回合结束时 -1。
  // 注意它和易伤是**两种不同的放大**：易伤是固定 +1，脆弱是按比例 ×(1+0.07N)，
  // 所以脆弱对**大伤害**更狠、易伤对**小段数**更狠，两者刻意不重合。
  frail: { pri: 76, name: '脆弱', icon: '▽', color: '#c07bff',
           desc: `每层使受到的**每一段**伤害 +${FRAIL_PCT}%，最多 ${FRAIL_MAX_STACKS} 层，自身回合结束时 -1` },
  artifact: { pri: 55, name: '抵挡', icon: '◈', desc: '免疫下 N 次减益', buff: true, color: '#ffcc52' },
};

/** 战斗内怪物数量硬上限。再多战场就挤不下意图栏了（实测 8 只是能全部看清的上限）。
    放在 spawn() 这个唯一入口上，任何召唤路径都绕不过去。 */
export const MAX_ENEMIES = 8;

export class Battle {
  constructor(encounter, opts = {}) {
    this.kind = opts.kind || 'battle';            // battle / elite / boss
    this.act = G.act;
    this.rng = G.rng;
    this.view = opts.view || {};
    this.turn = 0;
    this.over = false;
    this.result = null;
    this.log = [];
    this.uid = 0;

    const m = relicMods();
    this.mods = m;

    const p = { hp: G.hp, maxHp: G.maxHp, block: 0, st: {}, isPlayer: true, name: '你' };
    this.player = p;

    this.enemies = [];
    for (const id of encounter) this.spawn(id);

    // 牌堆
    this.draw = this.rng.shuffle(G.deck.map(e => hydrate({ ...e })));
    this.hand = []; this.discard = []; this.exhaustPile = [];
    this.energy = 0; this.energyMax = 3;
    this.cardsPlayedThisTurn = 0;
    // 本轮意图是否已经掷过（rollIntents 的幂等标志，见 rollIntents 注释）
    this.intentRolled = false;

    // 从存档恢复：直接套用快照，不要重新随机
    this.restoreFailed = false;
    if (opts.restore && !this.applySnapshot(opts.restore)) this.restoreFailed = true;
  }

  /* ---------------- 存档 / 读档 ----------------
     战斗中途关掉页面再回来，敌人、血量、手牌必须和之前一模一样，
     所以整场战斗的状态都要能序列化（全是纯数据，没有函数）。 */
  serialize() {
    const c = card => ({ id: card.id, up: !!card.upgraded });
    return {
      v: 1,
      kind: this.kind,
      turn: this.turn,
      energy: this.energy,
      energyMax: this.energyMax,
      player: { hp: this.player.hp, maxHp: this.player.maxHp, block: this.player.block, st: { ...this.player.st } },
      enemies: this.enemies.map(e => ({
        defId: e.defId, hp: e.hp, maxHp: e.maxHp, block: e.block, st: { ...e.st },
        turn: e.turn, moveId: e.moveId, dead: !!e.dead, attacked: e.attacked || 0,
        // 存下标而不是 uid：uid 每次读档都会重新分配，存 uid 对不上
        summonedBy: e.summonedBy ? this.enemies.findIndex(x => x.uid === e.summonedBy) : -1,
      })),
      draw: this.draw.map(c), hand: this.hand.map(c),
      discard: this.discard.map(c), exhaust: this.exhaustPile.map(c),
    };
  }

  /** 套用快照。**返回是否成功** —— 调用方必须看这个返回值：
      早先这里是 `if (!s || s.v !== 1) return;` 直接静默返回，敌人数组保持空
      （resumeBattle 传进来的 encounter 是 []），于是 resume() 判定"敌人全死"，
      直接 endBattle(true) —— 白送一关。改快照结构时必须同步改这里。 */
  applySnapshot(s) {
    // 校验必须够严：只要有一点对不上就整体拒绝（返回 false 由调用方兜底），
    // 半套用的状态比不套用更危险 —— 会留下一个"看起来正常"但数据错位的战斗。
    if (!s || s.v !== 1) return false;
    if (!s.player || typeof s.player.hp !== 'number' || typeof s.player.maxHp !== 'number') return false;
    if (!Array.isArray(s.enemies) || !s.enemies.length) return false;
    this.turn = s.turn || 0;
    this.energy = s.energy || 0;
    this.energyMax = s.energyMax || 3;
    Object.assign(this.player, {
      hp: s.player.hp, maxHp: s.player.maxHp, block: s.player.block || 0, st: { ...(s.player.st || {}) },
    });
    {
      // 先按快照顺序把敌人重建出来（uid 会重新分配）
      const sc = enemyScale(this.act);
      this.enemies = s.enemies.map(e => {
        const d = ENEMIES[e.defId];
        if (!d) return null;
        return {
          uid: 'e' + (++this.uid), defId: e.defId, def: d, name: d.name, sprite: d.sprite,
          hp: e.hp, maxHp: e.maxHp, block: e.block || 0, st: { ...(e.st || {}) },
          turn: e.turn || 0, moveId: e.moveId || null, body: d.body || 1,
          // 层级攻击倍率必须一起恢复：漏了它，读档续战会突然变回未缩放的原始伤害，
          // 而且界面预告会跟着一起变小（看起来"正常"，实则玩家白捡便宜）。
          atkMult: sc.atk,
          elite: !!d.elite, boss: !!d.boss, dead: !!e.dead,
          // 一起恢复：漏了它，读档续战会把已经打过的 Boss 当成"还没出过手"，
          // 白送一次减伤。
          attacked: e.attacked || 0,
          summonedBy: null,
        };
      }).filter(Boolean);
      // 再按下标把「谁召唤了谁」接回去
      s.enemies.forEach((e, i) => {
        const child = this.enemies[i];
        if (!child) return;
        const pi = typeof e.summonedBy === 'number' ? e.summonedBy : -1;
        child.summonedBy = (pi >= 0 && this.enemies[pi]) ? this.enemies[pi].uid : null;
      });
      // 有敌人因为 defId 在 ENEMIES 里找不到而被 filter 掉时，下标就对不齐了
      // （summonedBy 会整体错位），而且剩下空数组又会被 resume() 当成"打赢了"。
      // 这两种情况都只能整体拒绝，交给调用方重新开一场。
      if (this.enemies.length !== s.enemies.length) return false;
    }
    const re = arr => (arr || []).map(c => makeCard(c.id, c.up));
    this.draw = re(s.draw); this.hand = re(s.hand);
    this.discard = re(s.discard); this.exhaustPile = re(s.exhaust);
    return true;
  }

  /** 读档后继续这场战斗（不重新开局） */
  async resume() {
    this.pushLog('战斗继续');
    // 快照没套上就绝不能往下判：敌人数组空 ≠ 玩家打赢了
    if (this.restoreFailed) return false;
    if (this.player.hp <= 0) { await this.endBattle(false); return; }
    if (!this.aliveEnemies().length) { await this.endBattle(true); return; }
    // 快照里已经带着每个敌人的 moveId（意图是上一轮掷好的），
    // 所以这里**不能重掷** —— 重掷不仅会消耗随机数、还会让玩家眼前
    // 的意图和敌人接下来真做的事对不上。只有快照里缺意图时才补掷。
    if (this.aliveEnemies().some(e => !e.moveId)) this.rollIntents();
    else this.intentRolled = true;
    // 存档时若正好在敌人回合，手牌是空的 —— 补一个完整回合
    if (!this.hand.length) await this.playerTurn();
    this.view.sync?.();
  }

  /* ---------------- 基础 ---------------- */
  spawn(id, summoner) {
    // 硬上限：战场能同时显示的怪物数量有限（再多意图栏就挤到看不见了）。
    // 放在 spawn() 这个**唯一入口**上，任何召唤路径都绕不过去。
    // summon 效果另有一条更紧的上限（4 只），这里只是最后一道保险。
    if (this.aliveEnemies().length >= MAX_ENEMIES) {
      this.pushLog('场上怪物已满，召唤失败');
      return null;
    }
    const d = ENEMIES[id];
    // 按**当前层**缩放：同一张敌人表被 4 层复用，数值随层数走高（每层 +25% 生命、+15% 攻击）。
    // 难度选项可以在基础曲线上再加"每层额外 +hp%/+atk%"。
    // 关键：倍率只作用在"敌人自己的属性"上 —— 生命、以及招式里的 dmg。
    // 玩家卡牌给的易伤/虚弱在 calcDamage() 里照常生效，所以界面预告的伤害
    // （intentOf 也会乘同一份 atk）和敌人真打出来的数字始终一致。
    const sc = enemyScale(this.act, this.mods);
    const raw = this.rng.int(d.hp[0], d.hp[1]);
    // Boss 额外血量（难度"庞大的阴影"）。召唤物不算 —— 它不该吃 Boss 加成。
    const bossHpX = (d.boss && !summoner) ? (this.mods.bossHpMult || 1) : 1;
    const hp = Math.max(1, Math.round(raw * sc.hp * bossHpX));
    const e = {
      uid: 'e' + (++this.uid), defId: id, def: d, name: d.name, sprite: d.sprite,
      hp, maxHp: hp, block: 0, st: {}, turn: 0, moveId: null, body: d.body || 1,
      atkMult: sc.atk,                               // 这一场的攻击倍率（该敌人的所有招式共用）
      elite: !!d.elite, boss: !!d.boss, dead: false,
      attacked: 0,                                   // 已经挥出过几次攻击（Boss 首击减伤靠它判定）
      summonedBy: summoner ? summoner.uid : null,   // 谁召出来的
    };
    this.enemies.push(e);
    // 增益「虚弱召唤」：被召唤出来的怪物带 3 层虚弱（数值修正，不走钩子）
    if (e.summonedBy && this.mods.summonWeak) this.applyDebuff(e, 'weak', this.mods.summonWeak);
    if (e.summonedBy) for (const [, hook] of relicHooks('summoned')) hook(this, e);
    return e;
  }

  st(e) { return e.st || (e.st = {}); }
  get(e, k) { return e.st[k] || 0; }
  add(e, k, n, silent) {
    if (!n) return 0;
    if (n > 0 && this.get(e, 'artifact') > 0 && !ST[k]?.buff) {
      e.st.artifact--; if (!e.st.artifact) delete e.st.artifact;
      this.pushLog(`${e.name} 的「神器」抵消了 ${ST[k]?.name || k}`);
      return 0;
    }
    e.st[k] = (e.st[k] || 0) + n;
    if (e.st[k] <= 0) delete e.st[k];
    // 冰霜集满 → 消耗**全部**层数，转化成 1 层冰冻。
    // Boss 需要 5 层，普通/精英 3 层。多出来的层数直接丢弃（"消耗所有层数"）。
    if (k === 'frost' && e.st.frost >= this.freezeThreshold(e)) {
      delete e.st.frost;
      this.add(e, 'freeze', 1);
      this.pushLog(`${e.name} 被冻住了！`);
    }
    return n;
  }

  /** 冻住一个目标需要几层冰霜。
      普通/精英 3 层、Boss 5 层、**玩家 4 层**（产品要求 —— 玩家比小怪抗冻、比 Boss 差一点）。 */
  freezeThreshold(e) {
    if (e && e.isPlayer) return 4;
    return e && e.boss ? 5 : 3;
  }
  applyDebuff(e, k, n) {
    if (n > 0 && this.get(e, 'artifact') > 0) {
      e.st.artifact--; if (!e.st.artifact) delete e.st.artifact;
      this.pushLog(`${e.name} 的「神器」抵消了 ${ST[k]?.name || k}`);
      return;
    }
    this.add(e, k, n);
  }
  pushLog(t) { this.log.push(t); this.view.log?.(t); }

  /* ---------------- 数值计算 ---------------- */
  /** 流血结算：**怪物行动之后**才结算（中毒/灼烧是行动前）。
      造成 N 点伤害（无视护甲），然后把层数**减半**（奇数取下）：
      8 层 → 8、4、2、1 共 15 点；3 层 → 3、1 共 4 点。 */
  async settleBleed(e) {
    const n = this.get(e, 'bleed');
    if (n <= 0 || e.dead || e.hp <= 0) return;
    await this.loseHp(e, n, { isDot: true });
    this.add(e, 'bleed', -Math.ceil(n / 2));
    this.view.sync?.();
    await this.view.step?.(200);
  }

  /** 一次多段攻击的**实际段数**：把「真理」的加段算进去。
      只对**本来就有多段**的牌生效（base > 1）—— 单发牌不会因为真理变成多段，
      这是职业设定："通过叠真理层数来进行多段连击"。 */
  effHits(f, card) {
    const base = this.num(f.hits, card) || 1;
    if (base <= 1 || !this.mods.hitsPerTruth) return base;
    return base + this.get(this.player, 'truth') * this.mods.hitsPerTruth;
  }

  calcDamage(base, atk, def) {
    // 顺序是语义的一部分，而且现在**三项都是固定值加减**：
    //   ① 加力量  ② 减虚弱（扣完至少留 1）  ③ 加易伤（每层 +1）
    // 最后才乘"倍率"类的修正（Boss 首击减伤）。
    // 虚弱与易伤刻意对称：一个每层 -1、一个每层 +1，都是**每段各算一次**。
    let d = base + this.get(atk, 'strength');
    if (d > 0) {
      // 本来有伤害才扣虚弱；扣完至少留 1 点 ——
      // 否则叠够层数就能把敌人彻底废掉，"无论什么攻击都是 0" 会复现。
      d -= WEAK_FLAT_PER_STACK * this.get(atk, 'weak');
      if (d < 1) d = 1;
    }
    // 易伤：每层 +1（2026-10-13 由"×1.5 倍率"改成固定值）。
    // 同样用 `d > 0` 守卫 —— **0 点伤害的招式不该凭易伤凭空打出伤害**，
    // 这与虚弱的守卫对称（那边是"0 伤害不会被扣成负数"）。
    if (d > 0) {
      const vul = this.get(def, 'vulnerable');
      if (vul > 0) d += VULN_FLAT_PER_STACK * vul;
    }
    // 脆弱：每层 +7%（比例放大），上限 9 层。放在易伤**之后**、Boss 首击倍率**之前**。
    // 顺序有讲究：易伤是加法、脆弱是乘法，先加后乘等价于"先把每一段垫高，再整体放大"，
    // 反过来（先乘后加）会让 9 层脆弱把易伤那几点也一起放大，数值口径就飘了。
    // 同样保留 `d > 0` 守卫：0 点伤害不该被比例放大成 0.07 这种非整数。
    if (d > 0) {
      const fr = Math.min(this.get(def, 'frail'), FRAIL_MAX_STACKS);
      if (fr > 0) d = Math.floor(d * (1 + FRAIL_PCT * fr / 100));
    }
    // Boss 的第一次攻击减伤。放在**最后**乘，语义就是"这一击最终打七折"。
    // intentOf() 与 enemyTurn() 共用这个函数，所以预告和实际永远一致。
    if (d > 0 && atk && atk.boss && !atk.attacked) {
      const mult = (this.mods && this.mods.bossFirstAttackMult != null)
        ? this.mods.bossFirstAttackMult : BOSS_FIRST_ATTACK_MULT;
      d = Math.max(1, Math.round(d * mult));
    }
    return Math.max(0, d);
  }
  calcBlock(base, e) {
    // 脆弱**不再**影响护甲（2026-10-13 重定义为"受伤 +7%/层"）。
    // 以前这里是 `if (frail) b = Math.floor(b * 0.75)` —— 如果留着，
    // 脆弱就会同时削弱产出和放大承伤，等于一个状态干两件事、强度翻倍。
    let b = base + this.get(e, 'dexterity');
    return Math.max(0, b);
  }

  /* ---------------- 伤害 / 治疗 ---------------- */
  async damage(target, base, source = '?', opts = {}) {
    if (target.dead || this.over) return 0;
    const atk = opts.attacker || this.player;
    const dmg = opts.raw ? base : this.calcDamage(base, atk, target);
    const blocked = Math.min(target.block, dmg);
    const real = dmg - blocked;
    target.block -= blocked;
    if (real > 0) {
      target.hp -= real;
      if (target.isPlayer) { G.stats.dmgTaken += real; } else { G.stats.dmgDealt += real; }
    }
    this.view.onDamage?.(target, real, blocked, dmg);
    await this.view.step?.();
    // 圣骑士遗物「圣誓」：单次造成 >7 点伤害后回复 1 点生命。
    // 用 real（实际掉血）而不是 dmg（含被挡掉的部分）—— 被完全挡住的攻击不算"造成了伤害"，
    // 否则打高护甲怪反而变成回血机器。
    if (real > 7 && atk === this.player && !target.isPlayer && this.mods.healOnBigHit && !this.over) {
      await this.heal(this.player, this.mods.healOnBigHit);
    }
    // 荆棘反弹
    if (!opts.noThorns && opts.attacker && opts.melee) {
      const th = this.get(target, 'thorns');
      if (th > 0 && !target.dead) {
        this.pushLog(`${target.name} 的荆棘反弹 ${th} 点伤害`);
        await this.damage(opts.attacker, th, '荆棘', { raw: true, noThorns: true });
      }
    }
    if (target.hp <= 0) await this.kill(target);
    return real;
  }

  /** 直接扣血（无视护甲）：中毒 / 狂战代价 / 生命消耗 / 敌人自伤都走这一条路径。
      统计口径**只在这一处定义** —— 旧代码这些伤害直接在各自分支里 `hp -= n`，
      全都绕过了 damage() 的统计，于是结算面板的「造成/受到伤害」明显偏低
      （中毒流尤其离谱：一套毒打完，面板上几乎没涨）。
      opts.credit: 'player'（默认）敌人掉血记入「造成伤害」；'none' 不计（敌人自伤不算玩家的功劳）。 */
  async loseHp(target, n, opts = {}) {
    if (target.dead || this.over || n <= 0) return 0;
    const real = Math.max(0, Math.min(n, target.hp));   // 统计不超过剩余生命，别记出负数
    target.hp -= n;
    if (real > 0) {
      if (target.isPlayer) G.stats.dmgTaken += real;
      else if (opts.credit !== 'none') G.stats.dmgDealt += real;
    }
    this.view.onDamage?.(target, n, 0, n, opts.isDot);
    if (opts.step) await this.view.step?.(opts.step);
    if (target.hp <= 0) await this.kill(target);
    return real;
  }

  async damageAll(base, source, opts = {}) {
    for (const e of [...this.enemies]) if (!e.dead) await this.damage(e, base, source, opts);
  }
  /** 遗物钩子用的别名（hooks 里写 B.damageAllEnemies(...) 更直观） */
  damageAllEnemies(base, source, opts) { return this.damageAll(base, source, opts); }

  async heal(e, n) {
    if (e.dead || n <= 0) return;
    const before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + n);
    const real = e.hp - before;
    if (real > 0) { this.view.onHeal?.(e, real); await this.view.step?.(); }
  }

  async gainBlock(e, n) {
    if (e.dead || n <= 0) return;
    const b = this.calcBlock(n, e);
    e.block += b;
    this.view.onBlock?.(e, b);
    await this.view.step?.();
  }

  async kill(e) {
    if (e.dead) return;
    e.dead = true; e.hp = 0;
    this.pushLog(`${e.name} 被击败了`);
    if (e.isPlayer) { await this.endBattle(false); return; }
    G.stats.kills++;
    for (const [id, hook, def] of relicHooks('kill')) hook(this, e, def);
    this.view.onDeath?.(e);
    await this.view.step?.();

    // 召唤者死了，它召出来的小弟一并溃散（否则 Boss 打完还要清小弟，很别扭）
    const brood = this.enemies.filter(x => !x.dead && x.summonedBy === e.uid);
    for (const m of brood) {
      this.pushLog(`${m.name} 随着召唤者一起溃散了`);
      this.view.onVanish?.(m);
      m.dead = true; m.hp = 0;
      G.stats.kills++;
      this.view.onDeath?.(m);
      await this.view.step?.(60);
    }
    // 判定胜负：**任何敌人死亡之后都要重判**，不能只在"有召唤物连带清场"时判。
    //
    // 旧代码是 `if (brood.length) this.checkOver();`，而 enemyTurn() 里敌人被中毒
    // 打死走的是 `continue`，会跳过循环末尾那句 checkOver() —— 于是最后一个敌人
    // 被毒死时战斗不会结束，又回到玩家回合（场上一只敌人都没有），
    // 玩家还得自己点一次「结束回合」才进结算界面。
    // 放在这里，所有"敌人死亡"的路径（毒、反伤、自爆、斩杀…）都自动覆盖。
    this.checkOver();
  }

  /* ---------------- 效果结算 ---------------- */
  num(v, card) { return typeof v === 'string' ? (card?.[v] ?? 0) : (v || 0); }

  /** 处理 fx 上的 execute 字段：造成伤害之后，生命低于阈值的目标直接处决。
   *
   *  为什么单独拎出来：`execute` 以前**只写在卡牌数据里**，引擎从来没读过它 ——
   *  也就是说「暗杀」的斩杀效果**从来没有触发过**（不是虚弱导致的，虚弱只是
   *  让伤害更低、更容易被误以为是"因为虚弱所以没斩杀"）。
   *
   *  阈值是百分比（卡面写「若敌人生命低于 25%」）。边界取**含等号**：
   *  这样界面上显示 25% 时点下去确实会处决，不会出现"明明到了却没触发"的观感。
   *  只在 dmg 之后判定；目标已被这次伤害打死就无需再处决。 */
  async tryExecute(f, ctx, card, fallback) {
    if (f.execute == null) return false;
    const pct = this.num(f.execute, card);
    if (!(pct > 0)) return false;
    const t = (ctx.target && !ctx.target.dead) ? ctx.target
      : (fallback && !fallback.dead) ? fallback
        : this.aliveEnemies()[0];
    if (!t || t.dead || t.hp <= 0 || t.isPlayer) return false;
    if (t.hp > t.maxHp * pct / 100) return false;
    this.pushLog(`「${card?.name || '效果'}」处决了 ${t.name}`);
    this.view.onExecute?.(t, card);
    await this.kill(t);
    return true;
  }

  /** 玩家卡牌/药水的效果 */
  async resolve(fxList, ctx) {
    const { card } = ctx;
    // 目标可能已死光/未指定 —— 立刻取一个活着的，仍未定义就跳过需要目标的条目
    const pick = () => (ctx.target && !ctx.target.dead ? ctx.target : this.aliveEnemies()[0]);
    const NEEDS_TARGET = new Set(['dmg', 'dmgBlock', 'dmgPoison', 'dmgPerEnergyMax', 'dmgPerPlayed', 'detonate', 'debuff']);
    for (const f of fxList) {
      if (this.over) return;
      if (NEEDS_TARGET.has(f.t) && !pick()) continue;
      const target = pick();
      const v = this.num(f.v, card);
      switch (f.t) {
        case 'dmg': {
          const hits = this.effHits(f, card);
          // 条件加伤。**必须在结算的那一刻读**：卡面写了什么就得真的生效。
          // （`ifBlock` 以前只写在卡牌数据里、引擎从没读过，导致「反击」的
          //   额外伤害一次都没触发过 —— 和 `execute` 是同一类坑。）
          let hit = v;
          if (f.ifBlock != null && this.player.block > 0) hit += this.num(f.ifBlock, card);
          if (f.ifVulnerable != null && target && this.get(target, 'vulnerable') > 0) {
            hit += this.num(f.ifVulnerable, card);
          }
          if (f.ifFrozen != null && target && this.get(target, 'freeze') > 0) {
            hit += this.num(f.ifFrozen, card);
          }
          for (let i = 0; i < hits; i++) {
            const t = target && !target.dead ? target : this.aliveEnemies()[0];
            if (!t) break;
            await this.damage(t, hit, card?.name || '效果', { attacker: this.player, melee: !!ctx.melee });
          }
          // 斩杀（fx 上的 execute 字段）：伤害结算完之后再判定
          await this.tryExecute(f, ctx, card, target);
          break;
        }
        case 'dmgAll': {
          // hits 要和 dmg 一样被尊重：文档里写了 hits?，旧代码却直接忽略它，
          // 将来谁写一张"对所有敌人各打 2 次"的牌会静默只打 1 次。
          // 注意这里**不传 melee**（保持现状）：群攻是否触发敌人荆棘是平衡性问题，
          // 见 docs/开发与维护指南.md 的待修清单，不要在修 bug 时顺手改掉。
          const n = this.effHits(f, card);
          for (let i = 0; i < n; i++) {
            if (!this.aliveEnemies().length) break;
            await this.damageAll(v, card?.name || '效果', { attacker: this.player });
          }
          break;
        }
        case 'dmgBlock':
          await this.damage(target, this.player.block + this.num(f.bonus, card), card?.name, { attacker: this.player });
          break;
          break;
        case 'dmgPoison':
          await this.damage(target, this.get(target, 'poison') * (this.num(f.mult, card) || 1), card?.name, { attacker: this.player });
          break;
        case 'dmgBleed':
          await this.damage(target, this.get(target, 'bleed') * (this.num(f.mult, card) || 1), card?.name, { attacker: this.player });
          break;
        case 'detonate': {
          // 引爆：直接结算目标身上的全部「点燃」层数（每层 v 点，默认 2 倍），然后清空。
          // 只对**有层数**的目标生效 —— 没铺垫就白打，这是它换来高倍率的代价。
          const mult = f.mult != null ? this.num(f.mult, card) : 2;
          const foes = f.all ? this.aliveEnemies() : [target || this.aliveEnemies()[0]].filter(Boolean);
          for (const t of foes) {
            if (!t || t.dead) continue;
            const stacks = this.get(t, 'burn');
            if (stacks <= 0) continue;
            await this.damage(t, stacks * mult, card?.name || '引爆', { attacker: this.player });
            this.add(t, 'burn', -stacks);
            this.pushLog(`引爆了 ${stacks} 层点燃（${stacks * mult} 点）`);
            this.view.sync?.();
            await this.view.step?.(200);
          }
          break;
        }
        case 'dmgPerPlayed': {
          // 伤害 = v × 本回合已打出的牌数。这是"低费快过牌"的收尾手段。
          // 计数在 playCard() 里先加、再进 resolve，所以读到的**包含这一张自己** ——
          // 第一张打出来也有基础伤害，不会出现"铺垫半天结果是 0"。
          const per = this.num(f.v, card) || 0;
          const n = Math.max(0, this.cardsPlayedThisTurn || 0);
          const t = target && !target.dead ? target : this.aliveEnemies()[0];
          if (t) await this.damage(t, n * per, card?.name || '效果', { attacker: this.player, melee: !!ctx.melee });
          await this.tryExecute(f, ctx, card, target);
          break;
        }
        case 'dmgPerEnergyMax': {
          // 伤害 = 能量上限 × v。法师的招牌：法力增幅叠得越高，这一发越狠。
          const per = this.num(f.v, card) || 0;
          const t = target && !target.dead ? target : this.aliveEnemies()[0];
          if (t) await this.damage(t, Math.max(0, this.energyMax * per), card?.name || '效果', { attacker: this.player, melee: !!ctx.melee });
          await this.tryExecute(f, ctx, card, target);
          break;
        }
        case 'dmgPerHand': {
          const n = this.hand.length;
          for (let i = 0; i < n; i++) {
            const t = target && !target.dead ? target : this.aliveEnemies()[0];
            if (!t) break;
            await this.damage(t, v, card?.name, { attacker: this.player });
          }
          break;
        }
        case 'block':
          await this.gainBlock(this.player, v);
          break;
        case 'blockFromBlock':
          await this.gainBlock(this.player, this.player.block * (this.num(f.mult, card) || 1));
          break;
        case 'draw': await this.drawCards(v); break;
        case 'energy': this.energy += v; this.view.onEnergy?.(); await this.view.step?.(); break;
        case 'heal': await this.heal(this.player, v); break;
        case 'loseHp':
          await this.loseHp(this.player, v, { step: 70 });
          break;
        case 'buff': this.add(this.player, f.k, v); this.view.onStatus?.(this.player); await this.view.step?.(); break;
        case 'debuff': {
          let dv = v;
          if (f.k === 'poison') dv += this.get(this.player, 'poison_plus');
          if (f.k === 'bleed') dv += this.get(this.player, 'bleed_plus');
          this.applyDebuff(target, f.k, dv); this.view.onStatus?.(target); await this.view.step?.(); break;
        }
        case 'debuffAll':
          for (const e of this.aliveEnemies()) { this.applyDebuff(e, f.k, v + (f.k === 'poison' ? this.get(this.player, 'poison_plus') : f.k === 'bleed' ? this.get(this.player, 'bleed_plus') : 0)); this.view.onStatus?.(e); }
          await this.view.step?.(); break;
        case 'gold': { const got = gainGold(v); this.view.onGold?.(got); await this.view.step?.(); break; }
        // 塞牌给自己（文档承诺过、但旧代码只有敌人侧实现，写进卡里会静默无效）
        case 'addCard': {
          const n = this.num(f.n, card) || 1;
          for (let i = 0; i < n; i++) {
            const c = makeCard(f.id);
            if (f.to === 'hand') { if (this.hand.length < 10) this.hand.push(c); else this.discard.push(c); }
            else if (f.to === 'draw') this.draw.splice(this.rng.int(0, this.draw.length), 0, c);
            else this.discard.push(c);
          }
          this.pushLog(`「${CARDS[f.id]?.name || f.id}」被塞到了${f.to === 'hand' ? '手牌' : f.to === 'draw' ? '抽牌堆' : '弃牌堆'}`);
          await this.view.step?.();
          break;
        }
        // 弃牌是「代价」不是「效果」，必须真的落在手牌上 —— 见 discardFromHand()。
        // 旧代码是 `this.view.requestDiscard?.(v)`：界面根本没实现这个回调，
        // 可选链把整条静默跳过 → 卡面写着"弃 1 张牌"却什么也没发生。
        case 'discard': await this.discardFromHand(v || 1); break;
      }
    }
  }

  /** 敌人招式的效果（self=敌人自己，对玩家的减益直接作用在玩家身上） */
  async resolveEnemyFx(fxList, enemy) {
    for (const f of fxList) {
      if (this.over) return;
      const v = f.v || 0;
      switch (f.t) {
        case 'buff': this.add(enemy, f.k, v); this.view.onStatus?.(enemy); break;
        case 'buffAll': for (const e of this.aliveEnemies()) { this.add(e, f.k, v); this.view.onStatus?.(e); } break;
        case 'debuff': this.applyDebuff(this.player, f.k, v); this.view.onStatus?.(this.player); break;
        case 'healSelf': await this.heal(enemy, v); break;
        case 'block': await this.gainBlock(enemy, v); break;
        case 'summon':
          for (let i = 0; i < (f.n || 1); i++) {
            if (this.enemies.filter(e => !e.dead).length >= 4) break;
            const ne = this.spawn(f.id, enemy);
            this.pushLog(`${enemy.name} 召唤了 ${ne.name}`);
            this.view.onSummon?.(ne);
          }
          if (this.enemies.length > 4) { /* 超出上限的不再补 */ }
          break;
        case 'addCard':
          for (let i = 0; i < (f.n || 1); i++) {
            const c = makeCard(f.id);
            this.discard.push(c);
          }
          this.pushLog(`${f.n || 1} 张「${CARDS[f.id].name}」被塞进了你的弃牌堆`);
          break;
      }
      await this.view.step?.();
    }
  }

  /* ---------------- 牌堆 ---------------- */
  aliveEnemies() { return this.enemies.filter(e => !e.dead); }

  async drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (!this.draw.length) {
        if (!this.discard.length) break;
        this.draw = this.rng.shuffle(this.discard);
        this.discard = [];
        this.pushLog('弃牌堆已洗回抽牌堆');
      }
      const c = this.draw.pop();
      if (this.hand.length >= 10) { this.discard.push(c); continue; }
      this.hand.push(c);
      this.view.onDraw?.(c);
      await this.view.step?.(18);
    }
  }

  /* ---------------- 出牌 ---------------- */
  canPlay(c) {
    if (this.over || c.unplayable) return false;
    const cost = this.cardCost(c);
    return this.energy >= cost;
  }
  cardCost(c) { return Math.max(0, c.cost ?? 0); }

  /** 从手牌里丢掉一张（「飞刀」之类的弃牌代价）。
      优先让界面弹选牌器；界面没接这个回调、或玩家取消/没有可弃的牌时，
      退化成随机丢一张，保证卡面承诺的代价一定真的发生、且永远不会卡住流程。 */
  async discardFromHand(n = 1) {
    const freed = [];
    for (let i = 0; i < n; i++) {
      if (!this.hand.length) break;
      let idx = -1;
      if (this.view.requestDiscard) {
        try { idx = await this.view.requestDiscard(this.hand, this); } catch { idx = -1; }
      }
      if (typeof idx !== 'number' || idx < 0 || idx >= this.hand.length) idx = this.rng.int(0, this.hand.length - 1);
      const [c] = this.hand.splice(idx, 1);
      if (!c) break;
      this.discard.push(c);
      freed.push(c);
      this.pushLog(`弃掉了「${c.name}」`);
      await this.view.step?.(60);
    }
    if (freed.length) { this.view.sync?.(); }
    return freed;
  }

  async playCard(card, target) {
    if (!this.canPlay(card)) return false;
    const i = this.hand.indexOf(card);
    if (i < 0) return false;
    this.energy -= this.cardCost(card);
    this.hand.splice(i, 1);
    this.cardsPlayedThisTurn++;
    G.stats.cardsPlayed++;
    this.view.onPlay?.(card, target);
    await this.view.step?.(120);

    await this.resolve(card.fx || [], { card, target: target || this.aliveEnemies()[0], melee: card.type === 'attack' });

    // 职业特性（做在起始遗物里，和遗物/难度走同一条 mod 通路）：
    //   burnOnSkill  火焰法师 —— 打出的技能牌给受影响的敌人挂 N 层点燃
    //   frostOnSkill 寒冰法师 —— 同上，挂 N 层冰霜
    // 触发条件是**技能牌**，且这张牌要对敌人生效：
    //   target 'enemy' 打击指定目标；target 'all' 命中全体（含群体 debuff 牌）。
    //   给自己加护甲/抽牌那种 target 'self' 的牌不触发。
    // 一次出牌每敌只挂一次（按牌算，不按段数算）—— 否则多段牌一发就能叠十几层。
    // 游侠遗物「血牙」：打出的**攻击牌**给目标附加 N 层流血
    if (!this.over && this.mods.bleedOnAttack && card.type === 'attack') {
      const nb = this.mods.bleedOnAttack;
      const isAoe = card.target === 'all';
      const foes = (isAoe ? this.aliveEnemies() : [target || this.aliveEnemies()[0]]).filter(t => t && !t.dead);
      for (const t of foes) {
        this.applyDebuff(t, 'bleed', nb);
        this.pushLog(`${t.name} 开始流血 +${nb}`);
      }
    }
    if (!this.over && card.type === 'skill'
        && (card.target === 'enemy' || card.target === 'all')) {
      const onSkill = [['burn', this.mods.burnOnSkill], ['frost', this.mods.frostOnSkill]];
      if (onSkill.some(([, n]) => n)) {
        const isAoe = card.target === 'all';
        const foes = (isAoe ? this.aliveEnemies() : [target || this.aliveEnemies()[0]])
          .filter(t => t && !t.dead);
        for (const [k, n] of onSkill) {
          if (!n) continue;
          for (const t of foes) {
            this.applyDebuff(t, k, n);
            this.pushLog(`${t.name} 沾染了${ST[k]?.name || k} +${n}`);
          }
        }
      }
    }

    for (const [id, hook, def] of relicHooks('cardPlayed')) hook(this, card, def);
    // 增益「战意沸腾」：打出**能力卡**后获得 1 层力量（走 powerPlayed 钩子）。
    // 用 card.type === 'power' 判断，因为"能力"是卡牌类型，与效果怎么实现无关。
    if (card.type === 'power') for (const [, hook] of relicHooks('powerPlayed')) hook(this, card);

    if (card.exhaust) { this.exhaustPile.push(card); this.view.onExhaust?.(card); }
    else this.discard.push(card);
    this.view.onEnergy?.();
    this.view.sync?.();
    this.view.afterAction?.();     // 让界面立刻存一次档（别被节流吃掉）
    if (this.checkOver()) return true;
    return true;
  }

  async usePotion(potion, target) {
    this.potionUsed = true;      // 炼金师遗物：本场用过药水 → 结算时额外给钱
    this.view.onPotion?.(potion);
    await this.resolve(potion.fx || [], { card: null, target: target || this.aliveEnemies()[0] });
    this.view.sync?.();
    this.checkOver();
  }

  /* ---------------- 回合流程 ---------------- */
  async start() {
    this.pushLog('战斗开始！');
    const m = this.mods;
    // 遗物：战斗开始
    if (m.startHeal) await this.heal(this.player, m.startHeal);
    if (m.startLoseHp) await this.loseHp(this.player, m.startLoseHp);
    if (m.startBlock) await this.gainBlock(this.player, m.startBlock);
    if (m.startStrength) this.add(this.player, 'strength', m.startStrength);
    if (m.startDexterity) this.add(this.player, 'dexterity', m.startDexterity);
    if (m.startThorns) this.add(this.player, 'thorns', m.startThorns);
    if (m.startPoisonAll) for (const e of this.aliveEnemies()) this.applyDebuff(e, 'poison', m.startPoisonAll);
    if (m.startDebuffAll) for (const e of this.aliveEnemies()) for (const [k, v] of Object.entries(m.startDebuffAll)) this.applyDebuff(e, k, v);
    for (const [id, hook, def] of relicHooks('battleStart')) hook(this, def);
    this.view.sync?.();
    await this.view.step?.(250);
    if (this.player.hp <= 0) { await this.kill(this.player); return; }
    await this.playerTurn();
  }

  async playerTurn() {
    if (this.over) return;
    this.turn++;
    G.stats.turns++;
    const m = this.mods;

    // 回合开始的负面结算
    if (!this.get(this.player, 'barricade')) this.player.block = 0;
    this.pushLog(`—— 第 ${this.turn} 回合 ——`);

    // 中毒 / 点燃：轮到行动时掉 N 点血（无视护甲），然后 -1。
    // 两者规则完全一致，只是来源和颜色不同（点燃由火焰法师的攻击牌挂上）。
    // 中毒每跳 -2（衰减比点燃快一倍），点燃每跳 -1。
    // 用 Math.min(n, decay) 而不是直接减：1 层毒减 2 会变成 -1，
    // 虽然 add() 里 `<=0 就删除` 兜住了，但显式夹紧更不容易被后来的改动破坏。
    for (const [dot, decay] of [['poison', 2], ['burn', 1]]) {
      const n = this.get(this.player, dot);
      if (n <= 0) continue;
      await this.loseHp(this.player, n, { isDot: true });
      this.add(this.player, dot, -Math.min(n, decay));
      await this.view.step?.(180);
      if (this.over || this.player.hp <= 0) return;
    }
    // 备战（下回合护甲）/ 强化（每回合力量）
    // 注意「不屈」已经删除（2026-10-13）：它的效果"每回合开始获得 N 点护甲"
    // 与「敏捷」（每次获得护甲 +N）实质重复，产品决定只留敏捷。
    // 原来用不屈的 5 张牌都改成敏捷了 —— 敏捷是"每次产甲都加"，
    // 比"每回合开头一次性加"更贴合护盾流，牌也因此变强了一点（见重排说明）。
    if (this.get(this.player, 'block_next') > 0) { await this.gainBlock(this.player, this.get(this.player, 'block_next')); delete this.player.st.block_next; }
    if (this.get(this.player, 'ritual') > 0) this.add(this.player, 'strength', this.get(this.player, 'ritual'));

    // 能量
    // 能量上限 = 基础 3 + 遗物/难度修正 + **能量饱和**层数。
    // 法师的核心机制：这是唯一能让"费用上限"永久变高的途径 ——
    // 遗物那套 energyPerTurn 是固定值，卡牌只能用这个持久状态来加。
    this.energyMax = 3 + (m.energyPerTurn || 0) + this.get(this.player, 'energy_cap');
    if (this.turn === 1) this.energyMax += (m.firstTurnEnergy || 0);
    // 玩家身上的**冰冻**：每层让本回合能量 -1，消耗 1 层。
    // 刻意不是"跳过整个回合" —— 卡牌游戏里被剥夺一整回合太惩罚性，也不知道该干嘛。
    const pfz = this.get(this.player, 'freeze');
    if (pfz > 0) {
      this.add(this.player, 'freeze', -1);
      // 产品定的惩罚：**本回合能量减半（向上取整）**。
      // 不是"跳过整个回合"（卡牌游戏里失去一整回合太惩罚性），也不是 -1（太轻）。
      const before = this.energyMax;
      this.energyMax = Math.ceil(this.energyMax / 2);
      this.pushLog(`你被冻住了：本回合能量 ${before} → ${this.energyMax}`);
    }
    // 能量枯竭：下一回合 -N，结算后清除
    const pdr = this.get(this.player, 'drained');
    if (pdr > 0) {
      this.energyMax = Math.max(0, this.energyMax - pdr);
      delete this.player.st.drained;
      this.pushLog(`能量枯竭：本回合能量 -${pdr}`);
    }
    this.energy = this.energyMax;

    // 「本回合打出过几张牌」必须每回合清零 ——
    // 之前只在构造时初始化，一整场战斗都在累加（虽然暂时没有卡读它，
    // 但任何"本回合每打出一张牌就…"的牌都会因此算错）。
    this.cardsPlayedThisTurn = 0;

    // 抽牌
    let n = 5 + (m.drawPerTurn || 0) + this.get(this.player, 'extra_draw');
    if (this.turn === 1) n += (m.firstTurnDraw || 0);
    n = Math.max(0, n);
    const keep = this.hand.slice();
    this.hand = [];
    this.discard.push(...keep);
    await this.drawCards(n);

    for (const [id, hook, def] of relicHooks('turnStart')) hook(this, def);
    this.rollIntents();
    this.view.onTurnStart?.(this.turn);
    this.view.sync?.();
    this.view.afterAction?.();
  }

  async endTurn() {
    if (this.over) return;
    this.view.beforeEndTurn?.();
    // 手牌回合结束效果（诅咒）
    for (const c of [...this.hand]) {
      const d = c.endDmg;
      if (d) {
        this.pushLog(`「${c.name}」造成 ${d} 点伤害`);
        await this.damage(this.player, d, c.name, { raw: true });
      }
      if (c.id === 'curse_regret') await this.damage(this.player, this.hand.length, c.name, { raw: true });
    }
    if (this.over) return;

    // 弃掉手牌
    this.discard.push(...this.hand);
    this.hand = [];

    // 玩家减益/增益结算
    this.tickEnd(this.player);
    // 再生
    if (this.get(this.player, 'regen') > 0) { await this.heal(this.player, this.get(this.player, 'regen')); this.add(this.player, 'regen', -1); }
    for (const [id, hook, def] of relicHooks('turnEnd')) hook(this, def);
    this.view.sync?.();
    this.view.afterAction?.();
    if (this.checkOver()) return;

    await this.enemyTurn();
  }

  tickEnd(e) {
    for (const k of ['vulnerable', 'weak', 'frail']) {
      const v = this.get(e, k);
      if (v > 0) this.add(e, k, -1);
    }
  }

  async enemyTurn() {
    // 被冰冻跳过的敌人：它的意图要留到下一回合，所以 rollIntents 得跳过它
    const hold = new Set();
    for (const e of this.aliveEnemies()) {
      if (this.over) return;
      // 冰冻检查必须在 `e.turn++` **之前**：turn 不推进，pickMove(turn+1)
      // 才会算出和这回合一样的意图，玩家看到的预告才不会是错的。
      const frozen = this.get(e, 'freeze') > 0;
      if (!frozen) e.turn++;
      if (!this.get(e, 'barricade')) e.block = 0;
      else e.block = e.block;

      // 敌人中毒
      for (const [dot, decay] of [['poison', 2], ['burn', 1]]) {
        const n = this.get(e, dot);
        if (n <= 0) continue;
        await this.loseHp(e, n, { isDot: true });
        this.add(e, dot, -Math.min(n, decay));
        await this.view.step?.(200);
        if (e.dead || e.hp <= 0) break;
      }
      if (e.dead || e.hp <= 0) continue;
      if (this.over) return;

      // 冰冻：消耗 1 层，**整个行动跳过**（不移动位、不清意图）。
      // 注意放在 DoT 结算之后 —— 冰冻剥夺的是它的"行动"，不是保护它免受毒/点燃。
      if (frozen) {
        this.add(e, 'freeze', -1);
        // 冰层碎裂：每消耗 1 层冰冻，额外受到**最大生命 5%** 的伤害（至少 1 点）。
        // 用 loseHp（不吃护甲）：这是"冰裂"造成的固定损耗，不是一个可以被挡住的攻击。
        const shard = Math.max(1, Math.round(e.maxHp * 0.05));
        await this.loseHp(e, shard, { isDot: true });
        this.pushLog(`${e.name} 的冰层碎裂（${shard} 点）`);
        hold.add(e.uid);
        await this.settleBleed(e);          // 流血在"它的回合结束后"结算（被跳过也算过了一回合）
        this.view.sync?.();
        await this.view.step?.(280);
        if (e.dead || e.hp <= 0) { this.checkOver(); continue; }
        continue;
      }

      const mv = e.moveId && e.def.moves[e.moveId] ? e.moveId : this.pickMove(e);
      const def = e.def.moves[mv];
      e._lastActed = mv;      // 供自动化测试对照「预告 vs 实际」
      e.moveId = mv;
      this.view.onEnemyAct?.(e, def);
      await this.view.step?.(280);

      if (def.blk) await this.gainBlock(e, def.blk);
      if (def.dmg) {
        const hits = def.hits || 1;
        // 基础伤害先过层级缩放，再由 damage() 里的 calcDamage 处理力量/虚弱/易伤。
        // 与 intentOf() 走的是同一条公式。
        const base = defDamage(def, e);
        for (let i = 0; i < hits; i++) {
          if (this.player.hp <= 0) break;
          await this.damage(this.player, base, e.name, { attacker: e, melee: true });
        }
        // 记下"这个敌人已经打过人了"。必须放在挥出**之后**：
        // intentOf() 是在出招前调的，那时 attacked 还是 0，看到的仍是减伤后的数值。
        e.attacked = (e.attacked || 0) + 1;
      }
      if (def.selfDamage) await this.loseHp(e, def.selfDamage, { credit: 'none' });
      if (def.fx) await this.resolveEnemyFx(def.fx, e);
      this.tickEnd(e);
      // 流血：**行动之后**才结算（和中毒/灼烧的"行动前"刻意错开）
      if (!e.dead) await this.settleBleed(e);
      if (e.dead || e.hp <= 0) { this.view.sync?.(); if (this.checkOver()) return; continue; }
      // 难度「暴怒」：每个敌人**行动之后**获得力量与敏捷（走 enemyActed 钩子）。
      // 放在 tickEnd 之后 = 这一击按旧数值结算，成长从下一轮才体现 ——
      // 否则玩家看到的意图预告会和实际打出来的伤害对不上。
      if (!e.dead) for (const [, hook] of relicHooks('enemyActed')) hook(this, e);
      this.view.sync?.();
      await this.view.step?.(160);

      if (this.player.hp <= 0) { await this.kill(this.player); return; }
      if (this.checkOver()) return;
    }
    // 敌人行动完毕：重算「下一轮」的意图，再交回玩家
    if (!this.over) {
      this.intentRolled = false;   // 本轮意图已经用掉，下一轮必须重新掷
      this.rollIntents(false, hold);   // 被冻住的那个保留原意图
      this.view.sync?.();
      await this.playerTurn();
    }
    this.view.sync?.();
  }

  /**
   * 决定敌人「下一次」要出的招。
   * 注意用 e.turn + 1：意图面板显示的必须是它接下来真会做的事，
   * 否则玩家看到的永远是它刚做完的那一下，等于意图系统失效。
   */
  pickMove(e) {
    const keys = Object.keys(e.def.moves);
    const t = e.turn + 1;
    const mv = e.def.ai ? e.def.ai(e, t, this.rng, this) : e.def.pattern?.[(t - 1) % e.def.pattern.length] || keys[0];
    return e.def.moves[mv] ? mv : keys[0];
  }

  /** 敌人头顶意图（含预测伤害） */
  intentOf(e) {
    const mv = e.moveId || this.pickMove(e);
    const def = e.def.moves[mv];
    const out = { intent: def.intent, name: def.name, dmg: 0, hits: def.hits || 1, blk: 0 };
    // 护甲也必须走 calcBlock —— 原来直接取 def.blk，于是怪物身上有「敏捷」时
    // 预告显示原始值、实际却多加了敏捷层数（**预告撒谎**，和伤害那边是同一类 bug）。
    if (def.blk) out.blk = this.calcBlock(def.blk, e);
    // 和 enemyTurn 用**完全同一套**计算：先按层缩放基础伤害，再交给 calcDamage
    // 处理力量/虚弱/易伤。以前这里是手抄一遍公式，改一处忘另一处就会"预告撒谎"。
    if (def.dmg) out.dmg = this.calcDamage(defDamage(def, e), e, this.player);
    return out;
  }

  /** 预先决定所有敌人的意图。
      **幂等**：同一轮里重复调用不会重掷。
      为什么必须幂等 —— 用 rng 决定招式的敌人（怨灵的相位、各种 rng.chance）
      每次重掷都会消耗随机数。旧代码在一个回合周期里掷了 2~3 次
      （enemyTurn 末尾一次、紧接着 playerTurn 开头又一次、读档时再一次），
      于是"关掉页面再进来"会走出一条和"没关过"完全不同的未来。
      意图本该是一轮掷一次骰子，掷完就固定下来给玩家看。 */
  rollIntents(force = false, hold = null) {
    if (!force && this.intentRolled) return;
    for (const e of this.aliveEnemies()) {
      // hold 里的敌人这回合被冰冻跳过了：**保留它的 moveId**，
      // 下一回合还是同一个意图（"该意图会保留到下个回合"）。
      if (hold && hold.has(e.uid)) continue;
      e.moveId = this.pickMove(e);
    }
    this.intentRolled = true;
  }

  checkOver() {
    if (this.over) return true;
    if (this.player.hp <= 0) { this.endBattle(false); return true; }
    if (!this.aliveEnemies().length) { this.endBattle(true); return true; }
    return false;
  }

  async endBattle(win) {
    if (this.over) return;
    this.over = true;
    this.result = win ? 'win' : 'lose';
    if (win) {
      G.hp = this.player.hp;
      G.stats.floors++;
      const m = relicMods();
      if (m.healAfterBattle) G.hp = Math.min(G.maxHp, G.hp + m.healAfterBattle);
      // 炼金师遗物：本场用过药水就额外给金币
      if (m.potionBattleGold && this.potionUsed) {
        gainGold(m.potionBattleGold);
        this.pushLog(`药剂回收 +${m.potionBattleGold} 金币`);
      }
      for (const [id, hook, def] of relicHooks('battleWin')) hook(this, def);
    } else {
      G.hp = 0;
    }
    this.view.onEnd?.(this.result);
  }

  /* 供钩子使用的**整局**生命上限入口（增益「愈战愈勇」用）。
     为什么不让钩子直接调 state.js 的 gainMaxHp：
     钩子只拿到 (B, …)，而 B 是唯一稳定的调用上下文。
     同时会同步 this.player.maxHp —— 否则战斗界面上的玩家血条按旧上限显示，
     打完这一场出图才"跳"一下。 */
  gainMaxHpRun(n) {
    if (!n) return;
    gainMaxHp(n);
    this.player.maxHp = G.maxHp;
    if (this.player.hp > this.player.maxHp) this.player.hp = this.player.maxHp;
    this.view.sync?.();
  }
}

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
/** 层内（同一张地图）的渐进增幅：按地图行号从前往后**略微**加压。
 *
 *  为什么需要它（2026-10-17，玩家反馈）：
 *    原来同一层地图上所有战斗都用同一个倍率，于是"开局第一格就撞上两只吸血蝙蝠"
 *    （4×2 各一发 = 16/回合）和"临近 Boss"一样狠 —— 梯度只存在于**层与层之间**，
 *    层内是一条水平线。玩家的体感是"开局随机抽到最狠的那一档"。
 *
 *  参数怎么取的（产品口径："不用一关一增，每几关略微增一下"）：
 *    `progress` = 该场战斗在地图上的纵向位置（0 = 最底层起点，1 = Boss 前一行）。
 *    取 **居中** 映射：progress 0.5 时正好 ×1.00（等于原来的基准），
 *    两端各 ±20%（地图开头 ×0.80、Boss 前 ×1.20）。
 *    居中的好处：**层平均值不变**，产品定的那份一览伤害档位表（每层的普通/精英/Boss 上限）
 *    仍然成立，不需要重做；而地图前半段确实变轻了。
 *
 *  ⚠️ 为什么是 **0.20** 而不是更小的数字 —— 这是被**取整**逼出来的：
 *    玩家看到的伤害是 `Math.round(基础 × 倍率)`，而小怪单段只有 3 点。
 *    ±8% / ±12% / ±15% 时，3×0.88=2.64、3×1.15=3.45 **都四舍五入回 3**，
 *    也就是说层内梯度在数值上**根本看不见**（实测：一整层都是 3×2=6）。
 *    要让它跨过一个整数，倍率必须偏到 ±20%（3×0.80=2.4→2，3×1.20=3.6→4）。
 *
 *  ⚠️ 代价（如实记下）：层内 ±20% 大于层间 +17%，所以
 *    **第 1 层末（×1.20）会略强于第 2 层初（×0.80×1.17≈×0.94）**。
 *    这是"让开局不撞墙"与"层间严格递增"之间的取舍，产品选的是前者
 *    （开局撞双蝙蝠的痛感远大于"层间有一小段回落"）。*/
export const ACT_INNER_STEP = 0.20;

/** 把地图纵向进度（0..1）换算成倍率。见 ACT_INNER_STEP 的说明。 */
export const innerScale = (progress) => {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  return 1 + ACT_INNER_STEP * (p - 0.5) * 2;      // 0 → 0.80, 0.5 → 1.00, 1 → 1.20
};

/** 敌人强度的层级缩放。基础曲线在 data/enemies.js 的 actScale()，
    这里再叠加**难度选项**的"每层额外增幅"（enemyHpPerAct / enemyAtkPerAct）
    与**层内进度增幅**（innerScale），并补一个兜底（act 缺失/非法时按第 1 层算）。
    第 1 层不吃难度里的"每层额外增幅"（n=0）—— 否则它会变成"开局就变强"。 */
const enemyScale = (act, mods = {}, progress = 0.5) => {
  const base = actScale(act || 1);
  const n = Math.max(0, (act | 0) - 1);          // 第 1 层不吃难度里的"每层额外增幅"
  const inner = innerScale(progress);
  return {
    hp: base.hp * inner * (1 + (mods.enemyHpPerAct || 0) * n),
    atk: base.atk * inner * (1 + (mods.enemyAtkPerAct || 0) * n),
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
  /* ⚠️ desc 是 **HTML**，强调要用 `<b>`，不能写 markdown 的 `**…**`。
     这里曾经写成 `**每一段**`，而气泡是用 innerHTML 渲染的 —— 玩家看到的是
     字面的两个星号（"每层使受到的**每一段**伤害 +1"）。三条受影响：易伤/虚弱/脆弱。
     测试 AH 之外另有一条断言（AJ9）盯着 ST 表里不许再出现 markdown 星号。 */
  vulnerable: { pri: 88, name: '易伤', icon: '✸', desc: '每层使受到的<b>每一段</b>伤害 +1，自身回合结束时 -1', color: '#ff5c8a' },
  weak: { pri: 86, name: '虚弱', icon: '↓', desc: '每层使<b>每一次</b>造成的伤害 -1（分段招式每段都扣，每段至少留 1），回合结束 -1', color: '#c07bff' },
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
  frost: { pri: 91, name: '冰霜', icon: '❄', sprite: 'icon_frost', color: '#8ee6ff', desc: '集满后转化为 <b>1</b> 层冰冻（小怪 <b>4</b> 层、精英 <b>7</b> 层、Boss <b>9</b> 层）。不会自然衰减' },
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
           desc: `每层使受到的<b>每一段</b>伤害 +${FRAIL_PCT}%，最多 ${FRAIL_MAX_STACKS} 层，自身回合结束时 -1` },
  artifact: { pri: 55, name: '抵挡', icon: '◈', desc: '免疫下 N 次减益', buff: true, color: '#ffcc52' },
  /* ============ 「太子」职业的三个专属状态（2026-10-17）============
     王朝路线：威望 5 层 → 太子；太子 + 威望 6 层 → 登基。
     三者都是 `buff: true`：它们是**自己攒的进度**，不该被「抵挡」吃掉，
     也不该被任何"清除减益"的效果碰。转化逻辑见 checkRoyalPath()。 */
  prestige: { pri: 87, name: '威望', icon: '♛', color: '#ffd76a', buff: true,
              desc: '攒够 <b>5</b> 层转化为「太子」（清空后重新开始）。' },
  crownprince: { pri: 93, name: '太子', icon: '♚', color: '#ffe9a8', buff: true,
                 desc: '获得时立刻得到 <b>20</b> 点虚血。再攒 <b>6</b> 层威望即「登基」。' },
  throne: { pri: 94, name: '登基', icon: '♔', color: '#fff3c4', buff: true,
            desc: '每打出 <b>1</b> 张牌获得 <b>1</b> 点虚血；打出费用 <b>≥3</b> 的牌后随机获得 1 层力量/敏捷/真理' },
  /* 「死神」的核心机制（2026-10-17）。债务是**血线刀**：怪物回合开始时，
     若它的当前生命 ≤ 债务层数，直接终结它。
     ⚠️ 它**不是**伤害也不是减益 —— 不挡护甲、不吃易伤、不会被「抵挡」抵消，
        也不会随回合衰减（攒到就一直在）。见 settleDebt()。 */
  debt: { pri: 96, name: '债务', icon: '☠', color: '#c8c8d2',
          desc: '它回合开始时，若生命 <b>≤</b> 债务层数则被<b>直接终结</b>（不衰减、不挡护甲）' },
};

/** 战斗内怪物数量硬上限。再多战场就挤不下意图栏了（实测 8 只是能全部看清的上限）。
    放在 spawn() 这个唯一入口上，任何召唤路径都绕不过去。 */
export const MAX_ENEMIES = 8;

/** 王朝路线本身的三个状态。它们**不参与**「所有增益 +1 层」这类群体加成 ——
 *  否则终结牌会把自己往上叠，形成循环强化。 */
export const ROYAL_PROGRESS = new Set(['prestige', 'crownprince', 'throne']);

export class Battle {
  constructor(encounter, opts = {}) {
    this.kind = opts.kind || 'battle';            // battle / elite / boss
    this.act = G.act;
    /* 层内进度（0 = 地图起点，1 = Boss 前一行）。默认 0.5 = 不做偏移，
       所以"手工 new Battle() 的测试/工具"行为与旧版完全一致，
       只有真正从地图进入的战斗才带进度（main.js 的 startBattle）。 */
    this.progress = opts.progress != null ? opts.progress : 0.5;
    this.rng = G.rng;
    this.view = opts.view || {};
    this.turn = 0;
    this.over = false;
    this.result = null;
    this.log = [];
    this.uid = 0;

    const m = relicMods();
    this.mods = m;

    const p = { hp: G.hp, maxHp: G.maxHp, block: 0, vhp: 0, st: {}, isPlayer: true, name: '你' };
    this.player = p;

    this.enemies = [];
    for (const id of encounter) this.spawn(id);

    // 牌堆
    this.draw = this.rng.shuffle(G.deck.map(e => hydrate({ ...e })));
    // 牌组张数（"薄牌组"类遗物要用；放在这里就不用让 relics.js 去 import G，避免循环依赖）
    this.deckSize = G.deck.length;
    this.hand = []; this.discard = []; this.exhaustPile = [];
    this.energy = 0; this.energyMax = 3;
    this.cardsPlayedThisTurn = 0;
    // 本轮意图是否已经掷过（rollIntents 的幂等标志，见 rollIntents 注释）
    this.intentRolled = false;

    // 从存档恢复：直接套用快照，不要重新随机
    this.restoreFailed = false;
    /* 本场战斗的计数器必须一起恢复（2026-10-17 修）。
       它们以前**不在快照里**，读档续战会静默归零：
         · potionUsed/Count —— 炼金口袋按瓶数结算战后金币，续战就少给钱
         · killCount        —— 磨砺之心「每 3 杀 +1 力量」的进度凭空清空
         · cardsThisBattle  —— 血契吊坠「每 3 张抽 1」的进度同理
         · cardsThisTurn    —— 连击护腕按"本回合第 3 张"触发，续战后计数错位
       这些字段不算"战斗结果"，但都影响同一场战斗的继续结算，属于必须如实还原的状态。 */
    this.potionUsed = false;
    this.potionUsedCount = 0;
    this.killCount = 0;
    this.cardsThisBattle = 0;
    this.cardsThisTurn = 0;
    // 死神：「终末清算」的前提是**本场用过死神领域**，所以要单独记一笔
    this.deathDomainUsed = false;
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
      /* 层内进度要进快照：漏了它，读档续战会按 0.5 重算倍率，
         地图前半段开的局读回来会**莫名其妙变强**（或后半段变弱）。 */
      progress: this.progress,
      turn: this.turn,
      energy: this.energy,
      energyMax: this.energyMax,
      player: { hp: this.player.hp, maxHp: this.player.maxHp, block: this.player.block, vhp: this.player.vhp || 0, st: { ...this.player.st } },
      enemies: this.enemies.map(e => ({
        defId: e.defId, hp: e.hp, maxHp: e.maxHp, block: e.block, vhp: e.vhp || 0, st: { ...e.st },
        turn: e.turn, moveId: e.moveId, dead: !!e.dead, attacked: e.attacked || 0,
        /* `splitDone` 必须存：否则"虚空裂片已经裂过一次"这件事会在读档后丢失，
           而玩家**随时可能切后台**（手机端每次切走都会落盘）。那样一个已经裂开的
           裂片读回来会再裂一次 —— 场上凭空多两只、还是永久性的。 */
        splitDone: !!e.splitDone,
        // 存下标而不是 uid：uid 每次读档都会重新分配，存 uid 对不上
        summonedBy: e.summonedBy ? this.enemies.findIndex(x => x.uid === e.summonedBy) : -1,
      })),
      draw: this.draw.map(c), hand: this.hand.map(c),
      discard: this.discard.map(c), exhaust: this.exhaustPile.map(c),
      // 本场战斗的计数器（见构造函数里的说明）。缺了它们，读档续战会丢进度。
      potionUsed: !!this.potionUsed,
      potionUsedCount: this.potionUsedCount || 0,
      killCount: this.killCount || 0,
      cardsThisBattle: this.cardsThisBattle || 0,
      cardsThisTurn: this.cardsThisTurn || 0,
      // 死神：「终末清算」的判定条件依赖"本场用过死神领域"，也要跟着存档走
      deathDomainUsed: !!this.deathDomainUsed,
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
    this.progress = s.progress != null ? s.progress : 0.5;
    this.energy = s.energy || 0;
    this.energyMax = s.energyMax || 3;
    Object.assign(this.player, {
      hp: s.player.hp, maxHp: s.player.maxHp, block: s.player.block || 0, st: { ...(s.player.st || {}) },
      // 虚血必须跟着快照走：它是一层**实打实的减伤缓冲**，丢了就等于读档白掉血
      // （老快照没有这个字段时按 0 处理，与"那会儿还没有虚血"一致）。
      vhp: s.player.vhp || 0,
    });
    {
      // 先按快照顺序把敌人重建出来（uid 会重新分配）
      /* ⚠️ 缩放必须带上 `this.mods` —— 这是 2026-10-17 修的一个真 bug：
         这里原来写的是 `enemyScale(this.act)`（不带难度修正），而 spawn() 是
         `enemyScale(this.act, this.mods)`。于是开了难度「凶性渐长」（每层额外 +8% 攻击）
         的局，**只要中途关页面再回来，敌人攻击倍率就掉回裸曲线** ——
         玩家白捡便宜，而且界面预告会跟着一起变小，看起来"很正常"，极难发现。
         测试（AI 段）直接比对"读档后的 atkMult"与"同层新开一场的 atkMult"。 */
      const sc = enemyScale(this.act, this.mods, this.progress);
      this.enemies = s.enemies.map(e => {
        const d = ENEMIES[e.defId];
        if (!d) return null;
        return {
          uid: 'e' + (++this.uid), defId: e.defId, def: d, name: d.name, sprite: d.sprite,
          hp: e.hp, maxHp: e.maxHp, block: e.block || 0, vhp: e.vhp || 0, st: { ...(e.st || {}) },
          turn: e.turn || 0, moveId: e.moveId || null, body: d.body || 1,
          // 层级攻击倍率必须一起恢复：漏了它，读档续战会突然变回未缩放的原始伤害，
          // 而且界面预告会跟着一起变小（看起来"正常"，实则玩家白捡便宜）。
          atkMult: sc.atk,
          elite: !!d.elite, boss: !!d.boss, dead: !!e.dead,
          // 一起恢复：漏了它，读档续战会把已经打过的 Boss 当成"还没出过手"，
          // 白送一次减伤。
          attacked: e.attacked || 0,
          // 「分裂」已经触发过就不能再触发（见 serialize 里的说明）
          splitDone: !!e.splitDone,
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
    // 计数器（缺字段的老快照按 0 处理，行为与"没存过"一致，不会误伤）
    this.potionUsed = !!s.potionUsed;
    this.potionUsedCount = s.potionUsedCount || 0;
    this.killCount = s.killCount || 0;
    this.cardsThisBattle = s.cardsThisBattle || 0;
    this.cardsThisTurn = s.cardsThisTurn || 0;
    this.deathDomainUsed = !!s.deathDomainUsed;
    // 「死神领域」的加成不是可叠层状态，而是本场一次性开关：读档时要按它恢复，
    // 否则续战会"忘了领域已经展开"，施加债务又少 2 层。
    if (this.deathDomainUsed && this.mods.debtBonus == null) this.mods.debtBonus = 2;
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
    // 按**当前层**缩放：同一张敌人表被 4 层复用，数值随层数走高（每层 +25% 生命、+17% 攻击，见 enemies.js 的 ACT_*_STEP）。
    // 难度选项可以在基础曲线上再加"每层额外 +hp%/+atk%"。
    // 关键：倍率只作用在"敌人自己的属性"上 —— 生命、以及招式里的 dmg。
    // 玩家卡牌给的易伤/虚弱在 calcDamage() 里照常生效，所以界面预告的伤害
    // （intentOf 也会乘同一份 atk）和敌人真打出来的数字始终一致。
    const sc = enemyScale(this.act, this.mods, this.progress);
    const raw = this.rng.int(d.hp[0], d.hp[1]);
    // Boss 额外血量（难度"庞大的阴影"）。召唤物不算 —— 它不该吃 Boss 加成。
    const bossHpX = (d.boss && !summoner) ? (this.mods.bossHpMult || 1) : 1;
    const hp = Math.max(1, Math.round(raw * sc.hp * bossHpX));
    const e = {
      uid: 'e' + (++this.uid), defId: id, def: d, name: d.name, sprite: d.sprite,
      hp, maxHp: hp, block: 0, vhp: 0, st: {}, turn: 0, moveId: null, body: d.body || 1,
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
    /* 登基之后**本场战斗不再获得威望**（产品口径）。
       必须在写入之前拦：写成"加完再删"会让 checkRoyalPath 误判一次。 */
    if (k === 'prestige' && n > 0 && e.isPlayer && this.get(e, 'throne') > 0) {
      this.pushLog('已经登基，威望不再累积');
      return 0;
    }
    e.st[k] = (e.st[k] || 0) + n;
    if (e.st[k] <= 0) delete e.st[k];
    // 冰霜集满 → 消耗**全部**层数，转化成 1 层冰冻。
    // 阈值随目标而异：小怪 4 / 精英 6 / Boss 8（见 freezeThreshold）。
    // 多出来的层数直接丢弃（"消耗所有层数"）。
    if (k === 'frost' && e.st.frost >= this.freezeThreshold(e)) {
      delete e.st.frost;
      this.add(e, 'freeze', 1);
      this.pushLog(`${e.name} 被冻住了！`);
    }
    /* 太子 / 登基：**获得时**立刻给 20 点虚血。
       放在 add() 里而不是卡牌 fx 里 —— 这样"任何来源的太子都发钱"
       （卡牌、遗物、将来别的机制），不会漏掉某一条路径。 */
    if (n > 0 && e.isPlayer && (k === 'crownprince' || k === 'throne')) {
      this.gainVhp(20);
    }
    if (e.isPlayer && (k === 'prestige' || k === 'crownprince')) this.checkRoyalPath(e);
    /* 债务：`debtBonus`（死神领域）让"施加债务"这个动作额外多 N 层。
       放在 add() 里而不是每张牌各写一遍 —— 遗物/卡牌两条来源都自动享受加成，
       而且只对**主动施加**（n > 0）生效，清空/衰减不受影响。 */
    if (k === 'debt' && n > 0 && !e.isPlayer && this.mods.debtBonus && !this._debtBonusApplied) {
      // 防止递归：这次补加的层数不再触发加成
      this._debtBonusApplied = true;
      const extra = this.mods.debtBonus;
      e.st.debt = (e.st.debt || 0) + extra;
      this.pushLog(`「死神领域」额外施加 ${extra} 层债务`);
      this._debtBonusApplied = false;
    }
    return n;
  }

  /* ================= 「太子」职业的王朝路线 =================
     威望 5 层 → 清空威望、得 1 层太子（+20 虚血）
     太子 + 威望 6 层 → 清空两者、得 1 层登基（+20 虚血，此后不再涨威望）

     ⚠️ 口径按产品原文：**清空**，溢出的层数直接丢弃
     （例：已有 4 层威望、再打一张 +4 层 → 8 层，转化后归零，丢 3 层）。
     这不是 bug，是"攒够就兑现"的语义；写在这里免得后来的人当成算式错误去"修"。
     幂等：每次 add 之后调一次，条件不满足就什么都不做；递归深度最多 2 层
     （太子 → 再检查登基，而那时威望已是 0）。 */
  checkRoyalPath(e) {
    if (!this.mods.royalPath || !e || !e.isPlayer) return;
    if (this.get(e, 'throne') > 0) return;                 // 已登基，不再变化
    const pres = this.get(e, 'prestige');
    // ① 攒到 5 层 → 太子
    if (this.get(e, 'crownprince') === 0) {
      if (pres < 5) return;
      if (pres > 5) this.pushLog(`威望溢出 ${pres - 5} 层（转化只认 5 层）`);
      delete e.st.prestige;
      this.view.onStatus?.(e);
      this.pushLog('威望已成 —— 获得「太子」');
      this.add(e, 'crownprince', 1);                       // 递归：发 20 虚血
      return;
    }
    // ② 太子 + 6 层 → 登基
    if (pres < 6) return;
    if (pres > 6) this.pushLog(`威望溢出 ${pres - 6} 层（转化只认 6 层）`);
    delete e.st.prestige;
    delete e.st.crownprince;
    this.view.onStatus?.(e);
    this.pushLog('太子登基！此后本场不再获得威望');
    this.add(e, 'throne', 1);
  }

  /** 债务结算：怪物**回合开始时**（排在中毒/点燃/流血之后，优先级最低）检查
   *  「当前生命 ≤ 债务层数」→ 直接终结。
   *
   *  为什么放在 DoT 之后：产品的原话是"结算顺序最低，先结算中毒/流血等"。
   *  这个顺序是有意义的 —— 中毒把血打到债务线以下，债务就当场收人；
   *  反过来先判债务，那口毒就白下了。
   *
   *  返回被终结的怪物数组（可能为空）。UI 用 `view.onDebtExecute(list)` 播特效，
   *  多个同时被终结时只暗屏一次、刀光同时放。 */
  async settleDebt(only = null) {
    const pool = only ? [only] : this.aliveEnemies();
    const victims = [];
    for (const e of pool) {
      const d = this.get(e, 'debt');
      if (d <= 0 || e.hp <= 0 || e.dead) continue;
      if (e.hp > d) continue;
      this.pushLog(`${e.name} 的债务到期（生命 ${e.hp} ≤ 债务 ${d}）—— 终结`);
      victims.push(e);
    }
    if (!victims.length) return victims;
    this.view.onDebtExecute?.(victims);
    await this.view.step?.(600);          // 让暗屏 + 刀光播完
    for (const e of victims) {
      if (e.dead) continue;
      // 走 kill()：统计、召唤物连带溃散、胜负判定都自动覆盖
      await this.kill(e);
    }
    this.view.sync?.();
    return victims;
  }

  /** 是否已经"有了名分"（太子或登基）。储君之刃这类牌的 `ifRoyal` 用它判定。 */
  royalReady() {
    return this.get(this.player, 'crownprince') > 0 || this.get(this.player, 'throne') > 0;
  }

  /** 获得虚血。虚血是**独立于护甲的第二层缓冲**：   *   · 不受回合结束清甲影响（playerTurn 只清 block）
   *   · 不吃「敏捷」「壁垒」「护盾加成」等任何作用于护甲的规则
   *   · 受伤时结算顺序：护甲 → 虚血 → 生命
   *   · 本场战斗内累积、无上限；战斗结束随战斗实例消失（不进 G，不跨战斗） */
  gainVhp(n, target = null) {
    if (!n) return 0;
    const p = target || this.player;
    p.vhp = Math.max(0, (p.vhp || 0) + n);
    this.view.onVhp?.(p, n);
    return n;
  }

  /** 冻住一个目标需要几层冰霜。
   *
   *  2026-10-13 第二次提高（产品用寒冰法师"无脑"通了 108 分）：
   *    · 小怪 4 层（不变）
   *    · 精英 6 → **7** 层
   *    · Boss 8 → **9** 层
   *    · 玩家仍 4 层（产品没提玩家侧）
   *
   *  ⚠️ "是不是精英"用的是**战斗类型**（`this.kind === 'elite'`），不是怪物自己的
   *  `e.elite` 标记。原因是这两者在本项目里**并不一致**（真实数据冲突，不是我的假设）：
   *    · `guard_elite`（精英守卫）出现在第 2 层的 `elite` 表里，但 def 上**没有** `elite: true`
   *    · `gargoyle`（石像鬼）带着 `elite: true`，却又出现在第 3/4 层的 `strong`（普通）表里
   *  战斗类型才是权威信号 —— 奖励界面、`G.stats.elites`、地图节点全都按它判定。
   *  用 `e.elite` 会让精英守卫（精英关）按小怪算、石像鬼（普通关）按精英算，两边都错。 */
  freezeThreshold(e) {
    if (e && e.isPlayer) return 4;
    if (e && e.boss) return 9;
    if (this.kind === 'elite') return 7;
    return 4;
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

  calcDamage(base, atk, def, opts = {}) {
    // 顺序是语义的一部分，而且现在**三项都是固定值加减**：
    //   ① 加力量  ② 减虚弱（扣完至少留 1）  ③ 加易伤（每层 +1）
    // 最后才乘"倍率"类的修正（Boss 首击减伤）。
    // 虚弱与易伤刻意对称：一个每层 -1、一个每层 +1，都是**每段各算一次**。
    let d = base + this.get(atk, 'strength');
    /* 「多段的力量收益封顶」（2026-10-13，产品拍板削弱多段怪的统治力）。
       问题：`calcDamage` 是**每段**各调一次，所以 N 段招式会把力量吃 N 倍
       —— Boss 的「终极宣告 +5 力量」让 3 段招式每回合多打 15 点，单段只多 5 点。
       这就是"多段统治"的真正根源，压总伤害只能压住起点，压不住这个乘数。

       处理：多段（hits ≥ 2）招式里，力量最多按 **2 段**计。
       具体做法是第 3 段及以后把力量加成抹掉（`opts.hitIndex` 由调用方传入）。
       ⚠️ 不影响玩家侧：玩家走 playCard → resolve() 那条路不传 hitIndex，
          行为完全不变（产品只要求削**怪物**）。
       ⚠️ 段数在本次改动里也统一降到了 ≤2（3 段改 2 段），
          所以这条规则的现实效果是"以后有人再加 3 段招式也吃不到 3 倍力量"。 */
    /* ⚠️ hitIndex 是 **0-based**：第 1 段 = 0、第 2 段 = 1、第 3 段 = 2。
       所以判断必须是 `>=`，写成 `>` 会让第 3 段照样吃满力量（我第一版就是这么写的，
       被 AG3 那条测试当场抓到：10+5 应该变 10，实测还是 15）。 */
    const POWER_STACK_CAP = 2;
    if (opts.hitIndex != null && opts.hitIndex >= POWER_STACK_CAP) {
      d = base;                       // 第 3 段起：不带力量加成
    }
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
    let dmg = opts.raw ? base : this.calcDamage(base, atk, target, { hitIndex: opts.hitIndex });
    /* 「破甲」：玩家打出的攻击可以先削掉目标一部分护甲（新遗物「破甲钉」）——
       它绕开了 `calcDamage`，因为那一步只放大/缩小伤害数字，而护甲是在
       `damage()` 里按 `min(block, dmg)` 抵消的。放在这里 = 三种牌（单体/群体/多段）
       自动全部生效，不必在每张牌的 fx 里各写一遍。 */
    if (this.mods.pierce && atk === this.player && !target.isPlayer && target.block > 0) {
      const cut = Math.min(target.block, this.mods.pierce);
      target.block -= cut;
      this.view.sync?.();
    }
    const blocked = Math.min(target.block, dmg);
    target.block -= blocked;
    /* 虚血：**第二层缓冲**，结算顺序 护甲 → 虚血 → 生命（产品口径）。
       它绕开了 `calcBlock()` 与所有护甲相关的规则：「敏捷」不加它、
       「壁垒」不影响它（本来就不会被清）、「护盾加成」不放大它。
       对外的 `blocked` 把两层缓冲合在一起报（对玩家来说都是"没掉血"），
       但会额外回调一次 `onVhp` 让界面能单独画出虚血的变化。 */
    let rest = dmg - blocked;
    let vhpAbsorbed = 0;
    if (rest > 0 && (target.vhp || 0) > 0) {
      vhpAbsorbed = Math.min(target.vhp, rest);
      target.vhp -= vhpAbsorbed;
      rest -= vhpAbsorbed;
      if (vhpAbsorbed > 0) this.view.onVhp?.(target, -vhpAbsorbed);
    }
    const real = rest;
    if (real > 0) {
      target.hp -= real;
      if (target.isPlayer) { G.stats.dmgTaken += real; } else { G.stats.dmgDealt += real; }
    }
    this.view.onDamage?.(target, real, blocked + vhpAbsorbed, dmg);
    await this.view.step?.();
    /* 「受伤」钩子（`onDamaged`）—— 遗物文档里**早就写了这个名字，但引擎从没调过**，
       等于一个声明了却无法生效的能力（和 `ifBlock` 那次是同一类问题）。
       2026-10-13 补上：只在**玩家真的掉了血**时触发（被完全挡住不算"受伤"，
       否则高护甲反而变成触发回血/反伤的机器）。
       传 `real`（实际掉血）而不是 `dmg`（含被挡部分）。 */
    if (real > 0 && target.isPlayer && this.player.hp > 0) {
      for (const [, hook] of relicHooks('onDamaged')) { await hook(this, real); }
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
    // 「分裂」：血量降到一半时裂成 2 个分身（2026-10-13 第 4 层新怪「虚空裂片」）。
    // 放在伤害结算之后：如果这一击直接打死了就不分裂 —— 否则"高爆发/斩杀"
    // 反而会被分裂惩罚，跟设计意图（惩罚纯单点、奖励铺场）正好相反。
    if (!target.isPlayer) await this.maybeSplit(target);
    return real;
  }

  /** 分裂型敌人：`def.split = { n, hpPct }`。
      只在**首次**跨过 50% 血量时触发一次（`e.splitDone` 标记），
      否则每挨一次打都分裂，场上会瞬间爆满。 */
  async maybeSplit(e) {
    const cfg = e.def && e.def.split;
    if (!cfg || e.splitDone || e.dead || this.over) return;
    if (e.hp > e.maxHp * 0.5 || e.hp <= 0) return;
    e.splitDone = true;
    const n = cfg.n || 2;
    const made = [];
    for (let i = 0; i < n; i++) {
      const child = this.spawn(e.defId, e);       // 记为"由它召唤"，它死了分身跟着消失
      if (!child) break;
      const hp = Math.max(1, Math.round(e.maxHp * (cfg.hpPct || 0.4)));
      child.hp = hp;
      child.maxHp = hp;
      child.splitDone = true;                     // 分身不再分裂（否则指数爆炸）
      made.push(child);
      this.view.onSummon?.(child);
    }
    if (made.length) {
      this.pushLog(`${e.name} 裂成了 ${made.length} 个裂片！`);
      this.view.sync?.();
      await this.view.step?.(220);
    }
  }

  /** 直接扣血（无视护甲）：中毒 / 生命消耗 / 敌人自伤都走这一条路径。
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

  /** 获得护甲。
   *  `opts.fromCard` —— 这块护盾是不是**卡牌**给的（2026-10-17 加，
   *  供骑士初始遗物「燃烧之血」的 `cardBlockMult` 用）。
   *
   *  为什么必须区分来源：遗物给的护盾（`startBlock`、钉刺长靴、静滞护符…）
   *  和药水给的护盾都不是"从卡牌中获得"。若不分来源，`cardBlockMult` 就变成
   *  "所有护盾 +25%"，比设计意图强得多，而且拿着它的人会开始囤防御遗物。
   *  药水走的是同一个 `resolve()`，靠 `ctx.card` 为 null 区分（见 resolve 里传参）。 */
  async gainBlock(e, n, opts = {}) {
    if (e.dead || n <= 0) return;
    let b = this.calcBlock(n, e);
    if (opts.fromCard && this.mods.cardBlockMult) {
      // 「向上取整」是产品口径：7 点 ×1.25 = 8.75 → 9，不会出现 8.75 点护甲。
      b = Math.ceil(b * this.mods.cardBlockMult);
    }
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
    for (const [id, hook, def] of relicHooks('kill')) await hook(this, e, def);
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
          /* 王朝进度加伤（`ifRoyal`）：「储君之刃」用它。
             条件 = 已立储（太子）或已登基 —— 两者都算"有了名分"。 */
          if (f.ifRoyal != null && this.royalReady()) hit += this.num(f.ifRoyal, card);
          if (f.ifVulnerable != null && target && this.get(target, 'vulnerable') > 0) {
            hit += this.num(f.ifVulnerable, card);
          }
          if (f.ifFrozen != null && target && this.get(target, 'freeze') > 0) {
            hit += this.num(f.ifFrozen, card);
          }
          /* 残血加伤（`ifLowHp`）：生命**低于一半**时再加一份。
             这条以前**只写在卡牌数据里、引擎从没读过** —— 「殉道」的卡面写着
             "若你生命低于一半，改为造成双倍"，实际永远只打基础伤害（卡面撒谎）。
             判定用 `hp * 2 < maxHp`（严格低于一半），和卡面文案一致。 */
          if (f.ifLowHp != null && this.player.hp * 2 < this.player.maxHp) {
            hit += this.num(f.ifLowHp, card);
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
          await this.gainBlock(this.player, v, { fromCard: !!ctx.card });
          break;
        case 'blockFromBlock':
          await this.gainBlock(this.player, this.player.block * (this.num(f.mult, card) || 1), { fromCard: !!ctx.card });
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
        /* 虚血（太子职业）：直接加一层**独立于护甲**的缓冲，见 gainVhp()。 */
        case 'vhp': await this.gainVhp(v); break;
        /* 债务（死神职业）：给目标挂 N 层，到它回合开始时按血线裁决。 */
        case 'debt': {
          const t = target && !target.dead ? target : this.aliveEnemies()[0];
          if (t) {
            this.add(t, 'debt', v);
            this.view.onStatus?.(t);
            this.pushLog(`${t.name} 背上了 ${v} 层债务`);
            await this.view.step?.();
          }
          break;
        }
        /* 死神领域：本场战斗**施加债务时额外 +N 层**（一次性开关牌）。
           用实例字段而不是堆叠状态：它是张能力牌（打出即进消耗堆），
           一场只会生效一次，没必要做成可叠层的状态。 */
        case 'deathDomain':
          this.mods.debtBonus = v;
          this.deathDomainUsed = true;
          this.pushLog(`「死神领域」展开：此后施加债务额外 +${v} 层`);
          await this.view.step?.();
          break;
        /* 终结牌「终末清算」：对全体各造成"其债务层数"的伤害，
           无视护甲与虚血（产品口径）。能致死则播终结特效。 */
        case 'debtSweep': {
          const foes = this.aliveEnemies();
          const mortals = [];
          for (const t of foes) {
            const d = this.get(t, 'debt');
            if (d <= 0) continue;
            // 无视护甲/虚血：直接扣血，但仍走 loseHp 让统计口径统一
            const lethal = d >= t.hp;
            await this.loseHp(t, d, { isDot: true });
            this.pushLog(`清算 ${t.name} 的 ${d} 层债务`);
            if (lethal && t.dead) mortals.push(t);
          }
          if (mortals.length) {
            this.view.onDebtExecute?.(mortals, true);
            await this.view.step?.(600);
          }
          await this.view.sync?.();
          break;
        }
        /* 自身**所有增益** +v 层（太子终结牌「太·登基」用）。
           只加 ST 表里标了 `buff: true` 的状态，并且**排除王朝进度本身**
           （威望/太子/登基）—— 否则这张牌会把自己往上叠一层，那是循环强化。
           先复制 key 列表再遍历：add() 会写回 st，边遍历边改会漏项。 */
        case 'buffUp': {
          const keys = Object.keys(this.player.st || {});
          let n2 = 0;
          for (const k of keys) {
            if (!ST[k]?.buff || ROYAL_PROGRESS.has(k)) continue;
            this.add(this.player, k, v); n2++;
          }
          this.view.onStatus?.(this.player);
          this.pushLog(`王朝加冕：${n2} 项增益 +${v} 层`);
          await this.view.step?.();
          break;
        }
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
        /* **指定目标**的增益（2026-10-17，「互补双怪」用）。
           `f.id` 是目标敌人的 defId。与 buffAll 的区别：只加给那一种，
           所以"守碑人 + 无名剑士"里守碑人只喂剑士，不会连带喂自己或别的小怪。
           找不到目标时安静跳过（那一半被打死之后本就无处可喂）。 */
        case 'buffOne': {
          const t = this.aliveEnemies().find(x => x.defId === f.id);
          if (t) { this.add(t, f.k, v); this.view.onStatus?.(t); }
          break;
        }
        case 'debuff': this.applyDebuff(this.player, f.k, v); this.view.onStatus?.(this.player); break;
        case 'healSelf': await this.heal(enemy, v); break;
        /* 敌人给自己加**虚血**（第 2 层 Boss「空洞守望者」）。
           虚血是"护甲之后、生命之前"的第二层缓冲，且**不会被回合结束清空** ——
           所以给敌人加虚血的效果就是"你的输出必须打穿它"，见 gainVhp 的说明。
           `gainVhp` 现在支持传任意目标（以前只给玩家）。 */
        case 'vhp': await this.gainVhp(v, enemy); break;
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
        /* 「能量掠夺」（2026-10-13 第 3 层新怪「窃魂灯」）：
           直接扣玩家**当前**能量。它惩罚的是"攒着能量不打"这种打法，
           所以扣的是能量本身，不是下回合上限（那是「能量枯竭」）。
           下限 0：不会把能量扣成负数。 */
        case 'drainEnergy': {
          const take = Math.min(this.energy, f.n || 1);
          if (take > 0) {
            this.energy -= take;
            this.pushLog(`${enemy.name} 夺走了你 ${take} 点能量`);
            this.view.onEnergy?.();
          } else {
            this.pushLog(`${enemy.name} 想夺走你的能量，但你已经没有能量了`);
          }
          break;
        }
        /* 「护甲溶解」（2026-10-13 第 4 层精英「深渊之喉」）：
           按百分比吞掉玩家**当前护甲**（默认一半）。它惩罚的是"纯防御拖回合" ——
           叠再多甲也会被吃掉一半，逼你必须同时输出。
           放在出招**之前**结算（见敌人在 enemyTurn 里的调用顺序），
           所以那一击是真的打在你的"残甲"上。 */
        case 'eatBlock': {
          const pct = f.pct != null ? f.pct : 50;
          const eaten = Math.min(this.player.block, Math.ceil(this.player.block * pct / 100));
          if (eaten > 0) {
            this.player.block -= eaten;
            this.pushLog(`${enemy.name} 吞噬了你 ${eaten} 点护甲`);
            this.view.onBlock?.(this.player, -eaten);
            this.view.sync?.();
          } else {
            this.pushLog(`${enemy.name} 想吞噬你的护甲，但你身上没有护甲`);
          }
          break;
        }
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
  /** 这张牌现在能不能打。
   *  除了能量，还要过两道额外关（都是**终结牌**用的）：
   *    · `cond(B)`        —— 条件门（例："场上有敌人处于冰冻"）
   *    · `targetFilter`   —— 这张牌只允许打在某类目标上（例：只能打冻结目标）
   *  两个都放在 canPlay 里，是为了让**界面和引擎用同一把尺子**：
   *  界面置灰的依据就是这里，不然会出现"看起来能打、点下去没反应"。 */
  canPlay(c) {
    if (this.over || c.unplayable) return false;
    const cost = this.cardCost(c);
    if (this.energy < cost) return false;
    if (c.cond && !c.cond(this)) return false;
    // 有目标限制时，必须存在至少一个合法目标
    if (c.targetFilter && !this.validTargets(c).length) return false;
    return true;
  }

  /** 这张牌当前**可以选**的目标（没有 targetFilter 时就是所有活着的敌人）。
   *  `target: 'self'` 的牌没有敌人目标概念，返回空数组。 */
  validTargets(c) {
    if (!c || c.target === 'self') return [];
    return this.aliveEnemies().filter(e => !c.targetFilter || c.targetFilter(e, this));
  }

  /** 这张牌要花多少能量。
   *  **终结牌（`costN`）花掉你当前的全部能量** —— 这正是它的设计：它是"这一回合的
   *  一切"，所以费用写成 N。不能简单地把它当 3 费：能量饱和叠起来之后它会更贵，
   *  而玩家为此放弃的是那一回合**所有**别的出牌机会。 */
  cardCost(c) {
    if (c.costN) return Math.max(0, this.energy);
    return Math.max(0, c.cost ?? 0);
  }

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
    // 有目标限制时，把目标夹到**合法目标**上 —— 界面在单选情况下会把
    // aliveEnemies()[0] 直接传进来，那可能是不可选的那只（例如要求"冻结目标"，
    // 而第一只没被冻）。夹一下才能保证"能打出来"和"打到谁"是同一套判据。
    if (card.targetFilter) {
      const ok = this.validTargets(card);
      if (!ok.length) return false;
      if (!target || !ok.includes(target)) target = ok[0];
    }
    /* 实际支付额必须在**扣费之前**算好。
       终结牌是 `costN`（吃掉当前全部能量），`cardCost()` 读的是 `this.energy` ——
       扣完再读就变成 0 了。「影刃」要判断"这张牌是不是费用 ≥1"，
       用扣费后的读数会让终结牌永远按 0 费算，于是不触发。 */
    const paidCost = this.cardCost(card);
    this.energy -= paidCost;
    this.hand.splice(i, 1);
    this.cardsPlayedThisTurn++;
    G.stats.cardsPlayed++;
    this.view.onPlay?.(card, target);
    await this.view.step?.(120);

    await this.resolve(card.fx || [], { card, target: target || this.aliveEnemies()[0], melee: card.type === 'attack' });

    /* 「死神」的债务由**卡牌上的 `debt` 字段**携带，不是引擎统一发。
       理由（产品口径）：债务按 1.5 点/层定价，必须能逐张牌精确配平；
       若做成"每打一张牌自动 +1"，强度和出牌频率就绑在一起，低费连招牌会失控。
       触发条件与「影刃」一致：**对怪生效的牌**（单体或群攻），按命中的敌人生效。
       `debtSystem` 未开启（没带死债账簿）时整段跳过 —— 避免别的职业拿到带 debt 的牌就白嫖。 */
    if (!this.over && this.mods.debtSystem && card.debt) {
      const isAoe = card.target === 'all';
      const foes = (isAoe ? this.aliveEnemies() : [target || this.aliveEnemies()[0]]).filter(t => t && !t.dead);
      for (const t of foes) {
        this.add(t, 'debt', this.num(card.debt, card));
        this.pushLog(`${t.name} 的债务 +${this.num(card.debt, card)}`);
      }
      this.view.onStatus?.(foes[0]);
    }

    /* 「登基」的两条效果（2026-10-17，太子职业）：
         · 每打出**一张**牌 → 获得 1 点虚血
         · 打出**费用 ≥3** 的牌之后 → 从 力量/敏捷/真理 里随机得 1 层
       顺序刻意放在 fx **之后**：这张牌自己的加伤按打出前的状态算，
       不会因为"打完自己顺手涨了力量"而回头改判（那会让卡面与实际不符）。
       用 `paidCost` 而不是卡面 `cost`：终结牌是"吃掉全部能量"，
       它到底算不算 ≥3 费取决于当时有多少能量。 */
    if (!this.over && this.get(this.player, 'throne') > 0) {
      this.gainVhp(1);
      if (paidCost >= 3) {
        const pick = this.rng.pick(['strength', 'dexterity', 'truth']);
        this.add(this.player, pick, 1);
        this.view.onStatus?.(this.player);
        this.pushLog(`登基之威：获得 1 层${ST[pick].name}`);
      }
    }

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
    /* 刺客遗物「影刃」（2026-10-17 产品改版）：
       **打出费用 ≥1 的攻击牌、命中敌人后**，对该敌人施加 N 层易伤。
       以前的版本是"战斗开始时给所有敌人 2 层" —— 那是白送的起手优势；
       新版要求你**先付出一张攻击牌**，逐次累积，兑现"先铺易伤、最后一击"的职业定位。

       几个口径（都写在这里，免得下次改的时候猜）：
         · **费用 ≥1**：用 `paidCost`（出牌前刚算好的实际支付额），不是卡面 `cost`。
           终结牌是 `costN`（吃掉当前全部能量），它到底算不算"≥1 费"取决于当时能量；
           用 paidCost 才能与"你实际付了多少"一致。
         · **在伤害之后结算**（和 bleedOnAttack 一样）：所以这一层易伤**不会**给本张牌加伤，
           符合卡面「命中后施加」的说法。
         · 被护甲完全挡住也算"命中"，照样挂 —— 它是"碰到"，不是"造成伤害"。
         · 群体攻击（`target === 'all'`）**每个被打到的敌人各挂 1 层**，不是只给主目标。 */
    if (!this.over && this.mods.vulnOnAttack && card.type === 'attack' && paidCost >= 1) {
      const nv = this.mods.vulnOnAttack;
      const isAoe = card.target === 'all';
      const foes = (isAoe ? this.aliveEnemies() : [target || this.aliveEnemies()[0]]).filter(t => t && !t.dead);
      for (const t of foes) {
        this.applyDebuff(t, 'vulnerable', nv);
        this.pushLog(`${t.name} 被「影刃」盯上：易伤 +${nv}`);
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

    for (const [id, hook, def] of relicHooks('cardPlayed')) await hook(this, card, def);
    // 增益「战意沸腾」：打出**能力卡**后获得 1 层力量（走 powerPlayed 钩子）。
    // 用 card.type === 'power' 判断，因为"能力"是卡牌类型，与效果怎么实现无关。
    if (card.type === 'power') for (const [, hook] of relicHooks('powerPlayed')) await hook(this, card);

    /* 出牌之后的去处。
       ⚠️ 2026-10-13 产品改动：**能力牌（type 'power'）每场战斗只能生效一次**，
       打出后直接进「消耗堆」，本场不会再被抽到。
       原因：能力牌原来是进弃牌堆的，于是「壁垒」这类牌会被**反复抽到并重复生效**
       （实测：打完壁垒又能再抽一张壁垒）。改成一次性之后，想同时吃多张能力牌的效果，
       只能往卡组里塞更多张 —— 这正是产品要的构筑取舍。

       为什么复用 `exhaustPile` 而不是新建一个"已生效区"：
       · `exhaustPile` 的语义已经是"**本场战斗**移除，战斗结束回到卡组"
         （每场战斗构造时 `this.exhaustPile = []`，牌组始终是 `G.deck` 的拷贝）
       · 它已经有存档序列化、界面计数、"点开看是哪几张"——新建一个区这些全都要重写一遍
       所以"消耗"这个词在这里依然准确：这张牌本场已经消耗掉了。 */
    if (card.exhaust || card.type === 'power') {
      this.exhaustPile.push(card);
      this.view.onExhaust?.(card);
      if (card.type === 'power') this.pushLog(`「${card.name}」已生效，本场不会再抽到`);
      /* 「消耗」钩子（2026-10-13 新增，供新遗物「回收者」用）。
         注意它**包含能力牌**：能力牌现在也是进消耗堆的（见上面的说明），
         所以"每次有牌进入消耗堆"就是这里，语义只有一处定义。 */
      for (const [, hook] of relicHooks('exhausted')) await hook(this, card);
    } else this.discard.push(card);
    this.view.onEnergy?.();
    this.view.sync?.();
    this.view.afterAction?.();     // 让界面立刻存一次档（别被节流吃掉）
    if (this.checkOver()) return true;
    return true;
  }

  async usePotion(potion, target) {
    // 炼金师遗物：本场用药的**瓶数**（结算时按瓶数给钱）。
    // 以前这里只记一个布尔 `potionUsed`，而遗物描述写的是"每使用过 1 瓶药水…"
    // —— 喝 1 瓶和喝 5 瓶给的是一样的钱，文案与行为不一致（2026-10-13 修）。
    this.potionUsed = true;
    this.potionUsedCount = (this.potionUsedCount || 0) + 1;
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
    /* 开局增益型状态（2026-10-13 新增，供新遗物用）：
       `startArtifact`（抵挡）/ `startRegen`（再生）/ `startBlockNext`（备战）——
       它们和力量/敏捷/荆棘是同一类"开局上状态"的效果，只是状态本身是后加的，
       以前没有对应的 mod 键，遗物想给它们只能写 battleStart 钩子。 */
    if (m.startArtifact) this.add(this.player, 'artifact', m.startArtifact);
    if (m.startRegen) this.add(this.player, 'regen', m.startRegen);
    if (m.startBlockNext) this.add(this.player, 'block_next', m.startBlockNext);
    if (m.startPoisonAll) for (const e of this.aliveEnemies()) this.applyDebuff(e, 'poison', m.startPoisonAll);
    if (m.startDebuffAll) for (const e of this.aliveEnemies()) for (const [k, v] of Object.entries(m.startDebuffAll)) this.applyDebuff(e, k, v);
    for (const [id, hook, def] of relicHooks('battleStart')) await hook(this, def);
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

    for (const [id, hook, def] of relicHooks('turnStart')) await hook(this, def);
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
    for (const [id, hook, def] of relicHooks('turnEnd')) await hook(this, def);
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
      // 壁垒：护甲不清空；否则每轮开头清空（与玩家侧同一条规则）
      if (!this.get(e, 'barricade')) e.block = 0;

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

      /* 债务结算 —— 产品明确要求**优先级最低**（先结算中毒/点燃/流血这些 DoT）。
         顺序有意义：那口毒把血打到债务线以下，这里就当场收人；
         反过来先判债务，这口毒就白下了。
         流血是"行动之后"结算的，所以这里排在它之前没问题（它本来就晚）。 */
      if (this.get(e, 'debt') > 0) {
        const killed = await this.settleDebt(e);            // 只判它自己
        if (killed.some(v => v.uid === e.uid)) continue;   // 它已被终结，跳过行动
        if (e.dead || e.hp <= 0) continue;
        if (this.over) return;
      }

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

      /* `preFx`：在**加甲/出招之前**结算的效果。
         为什么需要它（而不是全塞进 fx）：`fx` 是在 dmg **之后**跑的，
         而「深渊之喉」的"先吞掉你一半护甲，再打你"必须在伤害之前生效 ——
         否则那一击打的是"满甲"，吞噬就只是把残余护甲清掉，惩罚意义全无。 */
      if (def.preFx) await this.resolveEnemyFx(def.preFx, e);
      if (def.blk) await this.gainBlock(e, def.blk);
      if (def.dmg) {
        const hits = def.hits || 1;
        // 基础伤害先过层级缩放，再由 damage() 里的 calcDamage 处理力量/虚弱/易伤。
        // 与 intentOf() 走的是同一条公式。
        const base = defDamage(def, e);
        for (let i = 0; i < hits; i++) {
          if (this.player.hp <= 0) break;
          // `hitIndex` 让 calcDamage 知道这是第几段 —— 第 3 段起不再吃力量加成，
          // 否则 N 段招式会把力量吃 N 倍（多段统治的根源，见 calcDamage 的注释）。
          await this.damage(this.player, base, e.name, { attacker: e, melee: true, hitIndex: i });
        }
        // 记下"这个敌人已经打过人了"。必须放在挥出**之后**：
        // intentOf() 是在出招前调的，那时 attacked 还是 0，看到的仍是减伤后的数值。
        e.attacked = (e.attacked || 0) + 1;
      }
      if (def.selfDamage) await this.loseHp(e, def.selfDamage, { credit: 'none' });
      if (def.fx) await this.resolveEnemyFx(def.fx, e);
      /* 敌人的 `afterAct`：**它这一轮行动结束之后**结算一次（与招式无关）。
         目前只有第 2 层 Boss「空洞守望者」用它给自己加 2 点虚血 ——
         放在这里而不是某个招式 fx 里，是因为产品要求"**回合结束后**获得"，
         不管这轮它在加甲、召唤还是纯减益，都照拿。
         时机刻意在 tickEnd 之前、enemyActed 钩子之前：
         这一轮它自己受到的 DoT 已经算过，下一轮玩家的输出会先撞上这层新虚血。 */
      if (e.def.afterAct && !e.dead) {
        const aa = e.def.afterAct;
        if (aa.vhp) {
          await this.gainVhp(aa.vhp, e);
          this.pushLog(`${e.name} 的虚影凝实：虚血 +${aa.vhp}`);
        }
        this.view.sync?.();
      }
      this.tickEnd(e);
      // 流血：**行动之后**才结算（和中毒/灼烧的"行动前"刻意错开）
      if (!e.dead) await this.settleBleed(e);
      if (e.dead || e.hp <= 0) { this.view.sync?.(); if (this.checkOver()) return; continue; }
      // 难度「暴怒」：每个敌人**行动之后**获得力量与敏捷（走 enemyActed 钩子）。
      // 放在 tickEnd 之后 = 这一击按旧数值结算，成长从下一轮才体现 ——
      // 否则玩家看到的意图预告会和实际打出来的伤害对不上。
      if (!e.dead) for (const [, hook] of relicHooks('enemyActed')) await hook(this, e);
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
    const out = { intent: def.intent, name: def.name, dmg: 0, hits: def.hits || 1, blk: 0, notes: [] };
    // 护甲也必须走 calcBlock —— 原来直接取 def.blk，于是怪物身上有「敏捷」时
    // 预告显示原始值、实际却多加了敏捷层数（**预告撒谎**，和伤害那边是同一类 bug）。
    if (def.blk) out.blk = this.calcBlock(def.blk, e);
    // 和 enemyTurn 用**完全同一套**计算：先按层缩放基础伤害，再交给 calcDamage
    // 处理力量/虚弱/易伤。以前这里是手抄一遍公式，改一处忘另一处就会"预告撒谎"。
    if (def.dmg) out.dmg = this.calcDamage(defDamage(def, e), e, this.player);
    /* 招式里"不在数字上体现"的额外机制必须**写进预告**，否则玩家只能靠挨打学会
       （「深渊之喉」吞护甲、「窃魂灯」吸能量都属于这一类 —— 它们的名字里没有任何提示）。
       这里直接从 def 的 preFx / fx 推导，不另建一套描述表：
       多一份手写文案就多一次"改了机制忘了改文案"。 */
    for (const f of [...(def.preFx || []), ...(def.fx || [])]) {
      if (f.t === 'eatBlock') out.notes.push(`出招前先吞噬你 <b>${f.pct != null ? f.pct : 50}%</b> 护甲`);
      else if (f.t === 'drainEnergy') out.notes.push(`夺走你 <b>${f.n || 1}</b> 点能量`);
      else if (f.t === 'summon') out.notes.push('召唤援军');
      else if (f.t === 'buffOne') {
        const tgt = (this.enemies || []).find(x => x.defId === f.id);
        out.notes.push(`给<b>${tgt ? tgt.name : '同伴'}</b> +${f.v || 0} 层${(ST[f.k] || {}).name || f.k}`);
      }
      else if (f.t === 'vhp') out.notes.push(`给自己 <b>${f.v || 0}</b> 点虚血（不清空、先抵伤害）`);
    }
    /* 被动型成长也要写进预告 —— 否则玩家只会觉得"它怎么越打越肉"。
       `afterAct` 是"每轮行动结束后"结算的，不属于任何一招，所以单独补一条。 */
    if (e.def.afterAct?.vhp) out.notes.push(`每轮行动后获得 <b>${e.def.afterAct.vhp}</b> 点虚血`);
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
      // 炼金师遗物：本场用过药水就额外给金币 —— **按瓶数算**。
      // 文案说的是"每使用 1 瓶额外获得 N 金币"，所以要乘瓶数（见 usePotion）。
      if (m.potionBattleGold && this.potionUsed) {
        const n = this.potionUsedCount || 1;
        gainGold(m.potionBattleGold * n);
        this.pushLog(`药剂回收 +${m.potionBattleGold * n} 金币（${n} 瓶）`);
      }
      for (const [id, hook, def] of relicHooks('battleWin')) await hook(this, def);
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

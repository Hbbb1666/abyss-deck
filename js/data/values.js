/**
 * 卡牌价值表（**唯一真源**）
 * =====================================================================
 * 卡牌的"价值"是给每张牌打的一个粗略分数：伤害 / 护甲 / 状态层数 / 抽牌…
 * 各自折算成点数，加起来与**它那一档的预算**比较（见 BUDGET）。
 *
 * 为什么要有这张表：卡牌数量上百，靠"感觉"调数值必然失控
 * （要么某张牌明显超模，要么同费同类的牌强弱差好几倍）。
 * 有了表，每张牌都能算出"该是多少"，改数值也不再是拍脑袋。
 *
 * ⚠️ 这里必须是**唯一真源**：以前这份权重在 `tools/test.mjs` 里另抄了一份，
 * 两边一改就漂移（测试按旧权重判、牌按新权重配）。现在测试也 import 这里。
 *
 * 口径（产品给定，2026-10-13 最终版）：
 *   1 伤害 = 1 护甲 = 1 点
 *   状态层数一律**按层计价**；部分状态在特定职业身上价值不同（见 BY_CLASS）
 *   全体效果 ×ALL_MULT
 * ---------------------------------------------------------------------
 */

/** 全体效果（dmgAll / debuffAll）的价值倍率 */
export const ALL_MULT = 1.3;

/** 通用权重（不区分职业） */
export const VAL = {
  dmg: 1,
  block: 1,
  heal: 1,            // 回血：1 点生命 = 1 点（和护甲同价）
  gold: 0.5,          // **1 金币 = 0.5 点**（产品口径，2026-10-13；原为 0.12）
  energy: 3,          // 能量很贵：1 能量 ≈ 3 点价值
  draw: 5,            // 抽 1 张牌 = 5 点（产品口径）
  // ---- 减益（按层）----
  /* 2026-10-13 第三版：**中毒 2.5 → 1.5**（产品要求）。
     它是三种 DoT 里**衰减最快**的（每回合 -2），层数掉得比谁都快，
     所以"1 层中毒"的累计伤害本来就低于 1 层流血/点燃 —— 定得比它们便宜是对的。
     ⚠️ 流血/点燃仍保持 2.5（产品这次只点了中毒）。这三者现在不再同价，
     是**有意为之**：中毒衰减最快 → 最便宜。 */
  poison: 1.5,
  bleed: 2.5,
  burn: 2.5,          // 点燃
  weak: 3,
  truth: 5,           // 真理：每层让多段牌多打一次，很强
  dexterity: 3.5,     // 敏捷：每次获得护甲 +N
  thorns: 3,          // 荆棘：反弹
  frost: 4.5,         // 冰霜：**只允许出现在 ≥2 费的寒冰法师专属牌上**（见 FROST_MIN_COST）
  // ---- 每回合型 / 开关型 ----
  energy_cap: 6.5,    // 能量饱和：每回合能量上限 +N
  extra_draw: 6.5,    // 洞察：每回合额外抽 N 张
  artifact: 6,        // 抵挡：免疫下 N 次减益
  barricade: 6,       // 壁垒：护甲不再消失（一次性开关）
  /* ---- 「太子」职业（2026-10-17）----
     威望：产品定价 **4 点/层**。它是"通往太子/登基的门票"，
       本身当回合没有任何战力 —— 4 点相当于"一层的价格里有一半是为未来付的"。
     虚血：**1.5 点/点**。比护甲（1 点）贵，因为它**不清除**、能跨回合吃伤害，
       相当于"当场的临时生命"；但比回血便宜一点 —— 回血进了血条就是永久的。
     太子 / 登基：**不参与计价**（同冰冻）。它们是"攒够就自动发生"的阶段奖励，
       硬定价会让终结牌与相关卡牌的门禁乱报。 */
  prestige: 4,
  vhp: 1.5,
  /* 债务（死神）：产品定 **1.5 点/层**。
     注意它和"伤害 1 点 = 1"的关系：1 层债务比 1 点伤害**贵**，
     因为债务不清空、不挡护甲、只要压到血线就必杀。 */
  debt: 1.5,
};

/** 冰霜只允许出现在这个费用及以上的牌上（产品硬约束） */
export const FROST_MIN_COST = 2;

/**
 * 分职业覆盖：同一个状态在不同职业身上价值不同。
 * 理由都是"这个职业能把它放大"：
 *   · 力量 在奥术法师身上 6 点 —— 他的多段攻击会被力量**逐段**加成，滚雪球
 *   · 易伤 在奥术法师 5 点（多段吃满）、在暗影刺客 3.5 点（他铺得太容易，边际价值低）
 *   · 再生 在圣骑士 3.5 点（他是回血流，再生是主轴，相对便宜）
 *   · 脆弱 在奥术法师 5 点
 */
export const BY_CLASS = {
  strength: { base: 4, arcanist: 6 },
  vulnerable: { base: 4, arcanist: 5, assassin: 3.5 },
  regen: { base: 4, paladin: 3.5 },
  frail: { base: 4, arcanist: 5 },
};

/**
 * "放大器"型状态：本身不造成伤害，只是让**别的牌**更强。
 * 计价 = base（拥有它）+ per × N（每层额外加多少）。
 *   淬毒：施加中毒时额外 +N 层 → 6 + 2.5N
 *   血涌：施加流血时额外 +N 层 → 6 + 2.5N
 *   强化：每回合开始获得 N 层力量 → 6 + 2.5N
 *   备战：下回合获得 N 点护甲 → 2 + 1N
 */
export const PER_STACK = {
  poison_plus: { base: 6, per: 2.5 },
  bleed_plus: { base: 6, per: 2.5 },
  ritual: { base: 6, per: 2.5 },
  block_next: { base: 2, per: 1 },
};

/**
 * 特殊状态：**不参与价值体系**。
 * 它们的效果无法折成"点数"去和伤害比较（冰冻是剥夺一次行动，
 * 能量枯竭是按层扣下回合能量），硬定价只会让门禁乱报。
 */
export const SPECIAL = new Set(['drained', 'freeze', 'crownprince', 'throne']);

/** 每一档（费用 × 稀有度）的预算。'1-basic' 沿用普通档 —— 基础牌就是普通强度。
 *
 * 2026-10-13 产品调整：**二费卡上限 +1、三费卡上限 +2**。
 * 理由：1 费档（5~7 点）能塞下的东西太少，而 3 费档原来相对 2 费只高 7 点，
 * 与"多花 1 费"的代价不成比例 —— 提费换来的强度不够，玩家就不愿意打高费牌。
 * 调整后 2 费 / 3 费的性价比更平滑（12→13、19→21、26→28）。 */
export const BUDGET = {
  '1-basic': 5, '1-common': 5, '1-uncommon': 6, '1-rare': 7,
  '2-common': 13, '2-uncommon': 15, '2-rare': 17,
  '3-common': 21, '3-uncommon': 25, '3-rare': 28,
};

/** 「终结牌」的价值上限。
 *
 * 终结牌的**费用是 N**（吃掉你当时**全部**能量），所以它不能按普通牌那样
 * 比"几费档的预算" —— 它真正贵的不是 3 点能量，而是"这一回合你别的什么都打不了"。
 * 产品给的参考值是 40，就用它当这一类的预算线。
 *
 * ⚠️ 这是**参考值不是硬上限**：价值模型算不出"吃掉全部能量"的代价，
 * 也算不出条件有多难达成，而这两件事恰恰是终结牌强度的主要来源。
 * 所以个别条件特别苛刻的牌会显式写上自己的 `finisherTarget`（见 cards.js），
 * 把"这张牌应该值多少"摆在数据里，而不是悄悄放宽整类的判定。 */
export const FINISHER_VALUE = 40;

/** 取某张牌的预算（费用按 1 起算，费用 0 的牌按 1 费算） */
export function budgetOf(card) {
  // 终结牌：用自己的目标值（条件越苛刻，目标值越高），没写就用参考值 40
  if (card.finisher) return card.finisherTarget ?? FINISHER_VALUE;
  const cost = Math.max(1, Math.min(3, card.cost | 0));
  const rar = card.rarity === 'basic' ? 'common' : card.rarity;
  return BUDGET[`${cost}-${rar}`] ?? 5;
}

/** 按职业取某个状态的单层价值 */
export function statusValue(key, cls) {
  const ov = BY_CLASS[key];
  if (ov) return ov[cls] ?? ov.base;
  if (key in VAL) return VAL[key];
  const ps = PER_STACK[key];
  if (ps) return ps.base;          // 只有 base 的部分；per 部分由 valueOf 按层数补
  return null;                     // 特殊状态：不计价
}

/**
 * 这些效果的价值模型**算不准**（开关型 / 每回合型 / 条件型），
 * 不参与"超预算"判定 —— 硬算会误伤（详见 test.mjs 的 MODEL_BLIND 注释）。
 */
export const MODEL_BLIND = new Set([
  'dmgBlock', 'dmgPoison', 'dmgBleed', 'dmgPerHand', 'dmgPerEnergyMax',
  'dmgPerPlayed', 'blockFromBlock', 'detonate',
  /* 「死神」的两个 2026-10-17 新增效果，同样算不准：
       deathDomain —— 一次性开关，真实价值取决于"之后还剩几张带 debt 的牌"
       debtSweep   —— 终结牌，伤害等于场上每个敌人的债务层数（0 到几十都可能）
     硬给一个数字只会让门禁乱报（实测：不列进来时这两张各欠 28 / 40 点）。 */
  'deathDomain', 'debtSweep',
]);

/** 这张牌是否参与预算判定 */
export function isModelBlind(card) {
  return (card.fx || []).some(f => MODEL_BLIND.has(f.t));
}

/**
 * 算一张牌的价值。
 * ⚠️ 必须是**一条完整的 else-if 链** —— 中间插一个裸 `if` 会把链截断，
 * 后面的分支就全挂在它下面、条件不成立时被静默跳过（加新效果时踩过）。
 */
export function valueOf(card) {
  const cls = card.cls;
  let v = 0;
  const n = k => (typeof card[k] === 'number' ? card[k] : 0);
  /**
   * 读一个 fx 的数值：
   *   `v: 'blk'`  → 取卡牌字段（随升级同步）
   *   `v: 3`      → 直接用这个**字面数字**
   * ⚠️ 以前只写了"取字段"这一半，于是 `discard(1)` / `ritual(1)` 这类字面量
   * 被读成 0 —— 弃牌的代价白丢，放大器的层数也白丢（狂战士的强化层数算成 0）。
   */
  const fv = f => (typeof f.v === 'number' ? f.v : n(f.v));
  /** 单层价值；特殊状态返回 0（不进价值体系） */
  const sv = key => statusValue(key, cls) ?? 0;

  for (const f of (card.fx || [])) {
    if (f.t === 'dmg') v += n('dmg') * (card.hits || 1) * VAL.dmg;
    else if (f.t === 'dmgAll') v += n('dmg') * (card.hits || 1) * VAL.dmg * ALL_MULT;
    else if (f.t === 'dmgBlock') v += 8 * VAL.dmg;
    else if (f.t === 'dmgPoison') v += 12 * VAL.dmg;
    else if (f.t === 'dmgBleed') v += 12 * VAL.dmg;
    else if (f.t === 'dmgPerHand') v += 8 * VAL.dmg;                 // 按 8 张手牌估
    else if (f.t === 'dmgPerEnergyMax') v += 3 * n('per') * VAL.dmg; // 按基础 3 能量估
    else if (f.t === 'dmgPerPlayed') v += 4 * n('per') * VAL.dmg;    // 按一回合 4 张估
    else if (f.t === 'block') v += n('blk') * VAL.block;
    else if (f.t === 'blockFromBlock') v += 5 * n('mult') * VAL.block;  // 必须计 mult：×1/×2 曾同分
    else if (f.t === 'draw') v += n('draw') * VAL.draw;
    else if (f.t === 'energy') v += n('nrg') * VAL.energy;
    else if (f.t === 'heal') v += n('heal') * VAL.heal;
    else if (f.t === 'gold') v += fv(f) * VAL.gold;
    else if (f.t === 'discard') v += fv(f) * -0.8;                    // 弃牌是代价
    else if (f.t === 'loseHp') v += fv(f) * -0.9;                     // 自伤是代价
    /* 「太子」的两个专属效果（2026-10-17）：
         vhp     —— 虚血，1 点 = 1.5（不清除，比护甲贵）
         buffUp  —— "自身所有增益 +v 层"：按**当时已持有**的增益计价，
                    静态算不出来（取决于场上状态），所以按"至少 2 项 × 1 层"保守估。
                    与 dmgBlock 同类，属于模型算不准的效果。 */
    else if (f.t === 'vhp') v += fv(f) * VAL.vhp;
    else if (f.t === 'buffUp') v += 2 * fv(f) * 4;
    /* 债务是**卡牌上的字段**（不是 fx 条目），所以计价必须在 fx 循环之外补一笔，
       见下面 "整张卡的属性" 那段。 */
    else if (f.t === 'debtSweep') v += 0;      // 终结牌：收益取决于场上债务，静态算不准
    // ---- 增益 ----
    else if (f.t === 'buff' && f.k === 'strength') v += n('str') * sv('strength');
    else if (f.t === 'buff' && f.k === 'dexterity') v += n('dex') * sv('dexterity');
    // 真理在牌里是**给自己上 buff**（`buff:truth`），不是给敌人的 debuff ——
    // 漏掉这一条会让整个奥术法师被系统性低估（洞察/求真/万物归一全算成 0 分）。
    else if (f.t === 'buff' && f.k === 'truth') v += n('tru') * sv('truth');
    else if (f.t === 'buff' && f.k === 'thorns') v += n('thn') * sv('thorns');
    else if (f.t === 'buff' && f.k === 'energy_cap') v += n('cap') * sv('energy_cap');
    else if (f.t === 'buff' && f.k === 'extra_draw') v += n('draw') * sv('extra_draw');
    else if (f.t === 'buff' && f.k === 'artifact') v += fv(f) * sv('artifact');
    else if (f.t === 'buff' && f.k === 'barricade') v += sv('barricade');
    else if (f.t === 'buff' && f.k === 'regen') v += n('hl') * sv('regen');
    // 放大器型：base + per × N
    else if (f.t === 'buff' && PER_STACK[f.k]) {
      const ps = PER_STACK[f.k];
      v += ps.base + ps.per * fv(f);
    }
    // 特殊状态：不计价
    else if (f.t === 'buff' && SPECIAL.has(f.k)) v += 0;
    // ---- 减益 ----
    else if (f.t === 'debuff' && f.k === 'vulnerable') v += fv(f) * sv('vulnerable');
    else if (f.t === 'debuff' && f.k === 'weak') v += fv(f) * sv('weak');
    else if (f.t === 'debuff' && f.k === 'poison') v += fv(f) * sv('poison');
    else if (f.t === 'debuff' && f.k === 'burn') v += fv(f) * sv('burn');
    else if (f.t === 'debuff' && f.k === 'bleed') v += fv(f) * sv('bleed');
    else if (f.t === 'debuff' && f.k === 'frost') v += fv(f) * sv('frost');
    else if (f.t === 'debuff' && f.k === 'truth') v += fv(f) * sv('truth');
    // 威望（太子职业）：1 层 4 点，见 VAL.prestige 的说明
    else if (f.t === 'buff' && f.k === 'prestige') v += fv(f) * sv('prestige');
    else if (f.t === 'debuff' && SPECIAL.has(f.k)) v += 0;
    else if (f.t === 'debuffAll' && f.k === 'weak') v += fv(f) * sv('weak') * ALL_MULT;
    else if (f.t === 'debuffAll' && f.k === 'poison') v += fv(f) * sv('poison') * ALL_MULT;
    else if (f.t === 'debuffAll' && f.k === 'burn') v += fv(f) * sv('burn') * ALL_MULT;
    else if (f.t === 'debuffAll' && f.k === 'bleed') v += fv(f) * sv('bleed') * ALL_MULT;
    else if (f.t === 'debuffAll' && f.k === 'vulnerable') v += fv(f) * sv('vulnerable') * ALL_MULT;
    else if (f.t === 'debuffAll' && f.k === 'frost') v += fv(f) * sv('frost') * ALL_MULT;
    else if (f.t === 'debuffAll' && SPECIAL.has(f.k)) v += 0;
  }
  // 这两个是**整张卡**的属性，必须在 fx 循环外 —— 放进去会按 fx 条数重复计分
  if (card.exhaust) v -= 1.5;
  /* 债务同样是**整张卡**的属性（`debt: N` 字段，不是 fx 条目）。
     它必须在这里计一次，否则所有死神牌都会被系统性低估 —— 它们把相当一部分
     强度放在债务上，直接伤害本来就压低了。 */
  if (typeof card.debt === 'number' && card.debt > 0) {
    // 群攻牌的债务也是打给全体的，按 ALL_MULT 放大（与 dmgAll / debuffAll 口径一致）
    const isAoe = (card.fx || []).some(f => f.t === 'dmgAll' || f.t === 'debuffAll');
    v += card.debt * VAL.debt * (isAoe ? ALL_MULT : 1);
  }
  // 斩杀有条件：只有打完落在血量阈值内才触发，给太多分会让门禁误伤
  if (card.exec) v += 1.5;
  // ifFrozen / ifVulnerable / ifBlock / ifLowHp 等条件加伤按 0.6 折
  // ⚠️ `ifLowHp` 长期**漏在这条链之外**：卡牌数据里写了它（殉道："血量低于一半时双倍"），
  // 价值表却不认 → 那张牌的真实上限被系统性低估（门禁报 15/15，实际能打 30）。
  if ((card.fx || []).some(f => f.ifFrozen != null)) v += n('bonus') * 0.6;
  if ((card.fx || []).some(f => f.ifVulnerable != null)) v += n('bonus') * 0.6;
  if ((card.fx || []).some(f => f.ifBlock != null)) v += n('bonus') * 0.6;
  if ((card.fx || []).some(f => f.ifLowHp != null)) {
    // 条件加伤的额度写在该 fx 的 `v` 字段指向的卡牌字段上（例如 v:'dmg' → 再加一份 dmg）
    const f = (card.fx || []).find(x => x.ifLowHp != null);
    if (f) v += n(f.ifLowHp) * 0.6;
  }
  return v;
}

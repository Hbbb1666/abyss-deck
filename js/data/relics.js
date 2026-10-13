/**
 * 遗物数据
 * ---------------------------------------------------------------
 * mods  —— 静态修正，开局/进战斗时读取
 *   maxHp          最大生命 +N
 *   potionSlots    药水槽 +N
 *   energyPerTurn  每回合 +N 能量
 *   drawPerTurn    每回合 +N 抽牌
 *   startBlock     战斗开始获得 N 护甲
 *   startStrength / startDexterity / startThorns / startPoison(给敌人)
 *   shopDiscount   商店折扣 0~1
 *   cardChoice     卡牌奖励多 N 个选项
 *   battleGold     战斗结束 +N 金币
 *   healAfterBattle 战斗结束回 N 血
 * hooks —— 事件钩子（B = 战斗上下文）
 *   battleStart(B) / turnStart(B) / turnEnd(B) / cardPlayed(B, card)
 *   kill(B, enemy) / battleWin(B) / onDamaged(B, dmg)
 * ---------------------------------------------------------------
 */

export const RELICS = {
  burning_blood: {
    name: '燃烧之血', sprite: 'potion_red', rarity: 'starter',
    // 2026-10-13 削弱：6 → **4**（产品要求）。
    // 骑士是"永远可选"的新手职业，同时也是护盾流 —— 6 点战后回血让他在第 1 层
    // 几乎不掉血，整层没有"要不要打这一场"的取舍。4 点仍能缓过来，但要开始算了。
    desc: '战斗结束后回复 <b>4</b> 点生命。', mods: { healAfterBattle: 4 },
  },
  mana_crystal: {
    name: '燃火水晶', sprite: 'potion_blue', rarity: 'starter',
    // 火焰法师唯一的起始遗物（起始遗物 + 职业特性合并成一件）。
    // 触发条件是**技能牌**且对敌人生效（单体 target:'enemy' 或群体 target:'all'）。
    desc: '战斗第一回合额外获得 <b>1</b> 点能量；你打出的技能牌会给受影响的敌人施加 <b>1</b> 层点燃。',
    mods: { firstTurnEnergy: 1, burnOnSkill: 1 },
  },
  truth_core: {
    name: '真理之核', sprite: 'key_purple', rarity: 'starter',
    desc: '你每有 <b>1</b> 层真理，<b>多段</b>攻击/技能牌就额外多打 <b>1</b> 次。',
    mods: { hitsPerTruth: 1 },
  },
  holy_oath: {
    name: '圣誓', sprite: 'key_gold', rarity: 'starter',
    desc: '单次造成超过 <b>7</b> 点伤害后，你回复 <b>1</b> 点生命。',
    mods: { healOnBigHit: 1 },
  },
  alchemy_pouch: {
    name: '炼金口袋', sprite: 'potion_green', rarity: 'starter',
    // 2026-10-13 削弱：每瓶 20 → **10**（产品要求）。
    // 注意这里真的是**按瓶数**结算的（喝 3 瓶给 30）—— 以前引擎只记了个布尔，
    // 喝 1 瓶和喝 5 瓶给一样的钱，描述与行为不一致，这次一并修掉了。
    desc: '药水槽 <b>+2</b>；战斗中每使用 <b>1</b> 瓶药水，战斗结束时额外获得 <b>10</b> 金币。',
    mods: { potionSlots: 2, potionBattleGold: 10 },
  },
  frost_core: {
    name: '寒霜核心', sprite: 'key_blue', rarity: 'starter',
    desc: '你打出的技能牌会给受影响的敌人施加 <b>1</b> 层冰霜。',
    mods: { frostOnSkill: 1 },
  },
  shadow_mark: {
    name: '影刃', sprite: 'key_purple', rarity: 'starter',
    // 2026-10-13 产品要求：由 1 层提到 **2 层**（刺客要"先铺易伤"，1 层不够起手）。
    // 注意手机端那份累积补丁是在旧基线上做的、会把它退回 1 层，合并时按产品口径落回 2。
    desc: '战斗开始时对所有敌人施加 <b>2</b> 层易伤。', mods: { startDebuffAll: { vulnerable: 2 } },
  },
  venom_fang: {
    name: '血牙', sprite: 'key_green', rarity: 'starter',
    // 游侠的设计核心改成"流血"：攻击牌自带 1 层流血，靠持续掉血滚雪球。
    desc: '你打出的<b>攻击牌</b>会为目标附加 <b>1</b> 层流血。',
    mods: { bleedOnAttack: 1 },
  },
  iron_belt: {
    name: '铁腰带', sprite: 'bars', rarity: 'common',
    desc: '战斗开始时获得 <b>6</b> 点护甲。', mods: { startBlock: 6 },
  },
  lucky_coin: {
    name: '幸运币', sprite: 'key_gold', rarity: 'common',
    desc: '战斗结束后额外获得 <b>8</b> 金币。', mods: { battleGold: 8 },
  },
  whetstone: {
    name: '磨刀石', sprite: 'anvil', rarity: 'common',
    desc: '战斗开始时获得 <b>1</b> 层力量。', mods: { startStrength: 1 },
  },
  feather: {
    name: '轻盈羽毛', sprite: 'coil', rarity: 'common',
    desc: '战斗开始时获得 <b>1</b> 层敏捷。', mods: { startDexterity: 1 },
  },
  snake_ring: {
    name: '蛇之戒指', sprite: 'key_green', rarity: 'common',
    desc: '战斗第一回合额外抽 <b>1</b> 张牌。', mods: { firstTurnDraw: 1 },
  },
  blood_vial: {
    name: '血瓶', sprite: 'potion_red', rarity: 'common',
    desc: '战斗开始时回复 <b>3</b> 点生命。', mods: { startHeal: 3 },
  },
  spiked_bracer: {
    name: '尖刺护腕', sprite: 'crabdemon', rarity: 'common',
    desc: '战斗开始时获得 <b>3</b> 层荆棘。', mods: { startThorns: 3 },
  },
  venom_sac: {
    name: '毒囊', sprite: 'potion_green', rarity: 'uncommon',
    desc: '战斗开始时对所有敌人施加 <b>2</b> 层中毒。', mods: { startPoisonAll: 2 },
  },
  amulet: {
    name: '生命护符', sprite: 'key_purple', rarity: 'uncommon',
    desc: '最大生命 <b>+10</b>。', mods: { maxHp: 10 },
  },
  potion_belt: {
    name: '药水腰带', sprite: 'box', rarity: 'uncommon',
    desc: '药水槽 <b>+2</b>。', mods: { potionSlots: 2 },
  },
  merchant_badge: {
    name: '商人徽章', sprite: 'crate', rarity: 'uncommon',
    desc: '商店物品价格 <b>降低 30%</b>。', mods: { shopDiscount: 0.3 },
  },
  lucky_dice: {
    name: '命运之骰', sprite: 'key_bone', rarity: 'uncommon',
    desc: '卡牌奖励多出 <b>1</b> 个选项。', mods: { cardChoice: 1 },
  },
  greedy_heart: {
    name: '贪婪之心', sprite: 'chest_gold', rarity: 'uncommon',
    desc: '战斗结束后额外获得 <b>15</b> 金币，但最大生命 <b>-3</b>。', mods: { battleGold: 15, maxHp: -3 },
  },
  hourglass: {
    name: '时光沙漏', sprite: 'coil', rarity: 'uncommon',
    desc: '每 <b>3</b> 回合结束时，对所有敌人造成 <b>6</b> 点伤害。',
    hooks: { turnEnd(B) { if (B.turn % 3 === 0) B.damageAllEnemies(6, '时光沙漏'); } },
  },
  thorn_heart: {
    name: '荆棘之心', sprite: 'gravestone', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>5</b> 层荆棘，最大生命 <b>-2</b>。', mods: { startThorns: 5, maxHp: -2 },
  },
  energy_core: {
    name: '能量核心', sprite: 'portal', rarity: 'rare',
    desc: '每回合 <b>+1</b> 能量，但每回合少抽 <b>1</b> 张牌。', mods: { energyPerTurn: 1, drawPerTurn: -1 },
  },
  scholar_notes: {
    name: '学者笔记', sprite: 'coil', rarity: 'rare',
    desc: '每回合额外抽 <b>1</b> 张牌。', mods: { drawPerTurn: 1 },
  },
  turtle_shell: {
    name: '龟甲', sprite: 'portcullis', rarity: 'rare',
    desc: '战斗开始时获得 <b>4</b> 点护甲。', mods: { startBlock: 4 },
  },
  war_horn: {
    name: '战争号角', sprite: 'key_red', rarity: 'rare',
    desc: '战斗开始时获得 <b>1</b> 层力量，但最大生命 <b>-4</b>。', mods: { startStrength: 1, maxHp: -4 },
  },
  obsidian_heart: {
    name: '黑曜石之心', sprite: 'boss_demon', rarity: 'rare',
    desc: '战斗开始时对所有敌人施加 <b>3</b> 层易伤和 <b>3</b> 层虚弱。',
    mods: { startDebuffAll: { vulnerable: 3, weak: 3 } },
  },
  philosopher_stone: {
    name: '贤者之石', sprite: 'arcane_orb', rarity: 'rare',
    desc: '每回合 <b>+1</b> 能量，最大生命 <b>-5</b>。', mods: { energyPerTurn: 1, maxHp: -5 },
  },
  crown: {
    name: '王者之冠', sprite: 'chest_gem', rarity: 'boss',
    desc: '每回合 <b>+1</b> 能量，抽牌 <b>+1</b>。', mods: { energyPerTurn: 1, drawPerTurn: 1 },
  },
  demon_eye: {
    name: '恶魔之眼', sprite: 'boss_demon', rarity: 'boss',
    desc: '战斗开始时获得 <b>3</b> 层力量，但每场战斗开始失去 <b>3</b> 点生命。',
    mods: { startStrength: 3, startLoseHp: 3 },
  },
  abyss_seal: {
    name: '深渊封印', sprite: 'portal', rarity: 'boss',
    desc: '战斗第一回合额外抽 <b>1</b> 张牌，并获得 <b>3</b> 点护甲。', mods: { firstTurnDraw: 1, startBlock: 3 },
  },
  immortal_heart: {
    name: '不朽之心', sprite: 'boss_gargoyle', rarity: 'boss',
    desc: '最大生命 <b>+25</b>，但药水槽 <b>-1</b>。', mods: { maxHp: 25, potionSlots: -1 },
  },

  /* ============ 新增遗物 ============
     定值前提：**和同类普通遗物对照**，不做出"更强的同名件"。
     参照物：铁腰带 = 开局 6 护甲（普通）· 尖刺护腕 = 开局 3 荆棘（普通）
             血瓶 3 血 · 幸运币 8 金 · 磨刀石 1 力量 · 蛇之戒指 首回合多抽 1
             学者笔记 = 每回合多抽 1（稀有）
     所以下面每一件的效果都**换了维度**或**带了代价**，
     而不是把上面某件普通遗物的数字直接调大。 */
  brass_knuckles: {
    name: '黄铜指虎', sprite: 'hammer', rarity: 'common',
    desc: '战斗第一回合额外获得 <b>2</b> 点力量。',
    hooks: { battleStart(B) { B.add(B.player, 'strength', 2); } },
  },
  sun_visor: {
    name: '日冕护目镜', sprite: 'key_blue', rarity: 'common',
    desc: '战斗开始时获得 <b>8</b> 点护甲，但每回合少抽 <b>1</b> 张牌。',
    mods: { startBlock: 8, drawPerTurn: -1 },
  },
  thorned_boots: {
    name: '钉刺长靴', sprite: 'crabdemon', rarity: 'common',
    desc: '每当一个敌人被击败，获得 <b>3</b> 点护甲。',
    hooks: { kill(B) { B.gainBlock(B.player, 3); } },
  },
  lucky_clover: {
    name: '四叶草', sprite: 'key_green', rarity: 'uncommon',
    desc: '战斗结束后额外获得 <b>12</b> 金币。', mods: { battleGold: 12 },
  },
  silver_anvil: {
    name: '银砧', sprite: 'anvil', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>2</b> 点敏捷，但最大生命 <b>-3</b>。',
    mods: { startDexterity: 2, maxHp: -3 },
  },
  warding_charm: {
    name: '守护符', sprite: 'key_purple', rarity: 'uncommon',
    desc: '最大生命 <b>+14</b>。', mods: { maxHp: 14 },
  },
  bottled_lightning: {
    name: '瓶中闪电', sprite: 'potion_blue', rarity: 'rare',
    desc: '战斗第 <b>4</b> 回合开始时，获得 <b>2</b> 点能量并抽 <b>1</b> 张牌。',
    hooks: { turnStart(B) { if (B.turn === 4) { B.energy += 2; B.view?.onEnergy?.(); B.drawCards(1); } } },
  },
  vault_key: {
    name: '金库钥匙', sprite: 'key_gold', rarity: 'rare',
    desc: '商店物品价格 <b>降低 40%</b>。', mods: { shopDiscount: 0.4 },
  },
};

for (const [id, r] of Object.entries(RELICS)) { r.id = id; r.mods = r.mods || {}; }

export const RELIC_RARITY_LABEL = {
  starter: '初始', common: '普通', uncommon: '罕见', rare: '稀有', boss: 'Boss', shop: '商店', event: '事件',
};

/** 可按稀有度抽的遗物池 */
export function relicPool(rarities) {
  return Object.values(RELICS).filter(r => rarities.includes(r.rarity));
}

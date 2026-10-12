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
    desc: '战斗结束后回复 <b>6</b> 点生命。', mods: { healAfterBattle: 6 },
  },
  mana_crystal: {
    name: '法力水晶', sprite: 'potion_blue', rarity: 'starter',
    desc: '战斗第一回合额外获得 <b>1</b> 点能量。', mods: { firstTurnEnergy: 1 },
  },
  venom_fang: {
    name: '毒牙', sprite: 'key_green', rarity: 'starter',
    desc: '战斗开始时对所有敌人施加 <b>1</b> 层中毒。', mods: { startPoisonAll: 1 },
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
    desc: '战斗结束后额外获得 <b>15</b> 金币，但最大生命 <b>-6</b>。', mods: { battleGold: 15, maxHp: -6 },
  },
  hourglass: {
    name: '时光沙漏', sprite: 'coil', rarity: 'uncommon',
    desc: '每 <b>3</b> 回合结束时，对所有敌人造成 <b>6</b> 点伤害。',
    hooks: { turnEnd(B) { if (B.turn % 3 === 0) B.damageAllEnemies(6, '时光沙漏'); } },
  },
  thorn_heart: {
    name: '荆棘之心', sprite: 'gravestone', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>5</b> 层荆棘，最大生命 <b>-4</b>。', mods: { startThorns: 5, maxHp: -4 },
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
    desc: '战斗开始时获得 <b>1</b> 层力量，但最大生命 <b>-8</b>。', mods: { startStrength: 1, maxHp: -8 },
  },
  obsidian_heart: {
    name: '黑曜石之心', sprite: 'boss_demon', rarity: 'rare',
    desc: '战斗开始时对所有敌人施加 <b>3</b> 层易伤和 <b>3</b> 层虚弱。',
    mods: { startDebuffAll: { vulnerable: 3, weak: 3 } },
  },
  philosopher_stone: {
    name: '贤者之石', sprite: 'arcane_orb', rarity: 'rare',
    desc: '每回合 <b>+1</b> 能量，最大生命 <b>-10</b>。', mods: { energyPerTurn: 1, maxHp: -10 },
  },
  crown: {
    name: '王者之冠', sprite: 'chest_gem', rarity: 'boss',
    desc: '每回合 <b>+1</b> 能量，抽牌 <b>+1</b>。', mods: { energyPerTurn: 1, drawPerTurn: 1 },
  },
  demon_eye: {
    name: '恶魔之眼', sprite: 'boss_demon', rarity: 'boss',
    desc: '战斗开始时获得 <b>3</b> 层力量，但每场战斗开始失去 <b>5</b> 点生命。',
    mods: { startStrength: 3, startLoseHp: 5 },
  },
  abyss_seal: {
    name: '深渊封印', sprite: 'portal', rarity: 'boss',
    desc: '战斗第一回合额外抽 <b>1</b> 张牌，并获得 <b>3</b> 点护甲。', mods: { firstTurnDraw: 1, startBlock: 3 },
  },
  immortal_heart: {
    name: '不朽之心', sprite: 'boss_gargoyle', rarity: 'boss',
    desc: '最大生命 <b>+25</b>，但药水槽 <b>-2</b>。', mods: { maxHp: 25, potionSlots: -2 },
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

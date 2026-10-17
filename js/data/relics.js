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
    name: '燃烧之血', sprite: 'r_blood', rarity: 'starter',
    // 2026-10-13 削弱：6 → **4**（产品要求）。
    // 骑士是"永远可选"的新手职业，同时也是护盾流 —— 6 点战后回血让他在第 1 层
    // 几乎不掉血，整层没有"要不要打这一场"的取舍。4 点仍能缓过来，但要开始算了。
    desc: '战斗结束后回复 <b>4</b> 点生命。', mods: { healAfterBattle: 4 },
  },
  mana_crystal: {
    name: '燃火水晶', sprite: 'r_crystal_fire', rarity: 'starter',
    // 火焰法师唯一的起始遗物（起始遗物 + 职业特性合并成一件）。
    // 触发条件是**技能牌**且对敌人生效（单体 target:'enemy' 或群体 target:'all'）。
    desc: '战斗第一回合额外获得 <b>1</b> 点能量；你打出的技能牌会给受影响的敌人施加 <b>1</b> 层点燃。',
    mods: { firstTurnEnergy: 1, burnOnSkill: 1 },
  },
  truth_core: {
    name: '真理之核', sprite: 'r_truth_core', rarity: 'starter',
    desc: '你每有 <b>1</b> 层真理，<b>多段</b>攻击/技能牌就额外多打 <b>1</b> 次。',
    mods: { hitsPerTruth: 1 },
  },
  holy_oath: {
    name: '圣誓', sprite: 'r_oath', rarity: 'starter',
    desc: '单次造成超过 <b>7</b> 点伤害后，你回复 <b>1</b> 点生命。',
    mods: { healOnBigHit: 1 },
  },
  alchemy_pouch: {
    name: '炼金口袋', sprite: 'r_pouch', rarity: 'starter',
    // 2026-10-13 削弱：每瓶 20 → **10**（产品要求）。
    // 注意这里真的是**按瓶数**结算的（喝 3 瓶给 30）—— 以前引擎只记了个布尔，
    // 喝 1 瓶和喝 5 瓶给一样的钱，描述与行为不一致，这次一并修掉了。
    desc: '药水槽 <b>+2</b>；战斗中每使用 <b>1</b> 瓶药水，战斗结束时额外获得 <b>10</b> 金币。',
    mods: { potionSlots: 2, potionBattleGold: 10 },
  },
  frost_core: {
    name: '寒霜核心', sprite: 'r_frost_core', rarity: 'starter',
    desc: '你打出的技能牌会给受影响的敌人施加 <b>1</b> 层冰霜。',
    mods: { frostOnSkill: 1 },
  },
  shadow_mark: {
    name: '影刃', sprite: 'sword_dagger', rarity: 'starter',
    // 2026-10-13 产品要求：由 1 层提到 **2 层**（刺客要"先铺易伤"，1 层不够起手）。
    // 注意手机端那份累积补丁是在旧基线上做的、会把它退回 1 层，合并时按产品口径落回 2。
    desc: '战斗开始时对所有敌人施加 <b>2</b> 层易伤。', mods: { startDebuffAll: { vulnerable: 2 } },
  },
  venom_fang: {
    name: '血牙', sprite: 'r_fang', rarity: 'starter',
    // 游侠的设计核心改成"流血"：攻击牌自带 1 层流血，靠持续掉血滚雪球。
    desc: '你打出的<b>攻击牌</b>会为目标附加 <b>1</b> 层流血。',
    mods: { bleedOnAttack: 1 },
  },
  iron_belt: {
    name: '铁腰带', sprite: 'bars', rarity: 'common',
    desc: '战斗开始时获得 <b>6</b> 点护甲。', mods: { startBlock: 6 },
  },
  lucky_coin: {
    name: '幸运币', sprite: 'r_coin', rarity: 'common',
    desc: '战斗结束后额外获得 <b>8</b> 金币。', mods: { battleGold: 8 },
  },
  whetstone: {
    name: '磨刀石', sprite: 'r_whetstone', rarity: 'common',
    desc: '战斗开始时获得 <b>1</b> 层力量。', mods: { startStrength: 1 },
  },
  feather: {
    name: '轻盈羽毛', sprite: 'r_feather', rarity: 'common',
    desc: '战斗开始时获得 <b>1</b> 层敏捷。', mods: { startDexterity: 1 },
  },
  snake_ring: {
    name: '蛇之戒指', sprite: 'r_ring', rarity: 'common',
    desc: '战斗第一回合额外抽 <b>1</b> 张牌。', mods: { firstTurnDraw: 1 },
  },
  blood_vial: {
    name: '血瓶', sprite: 'r_vial_red', rarity: 'common',
    desc: '战斗开始时回复 <b>3</b> 点生命。', mods: { startHeal: 3 },
  },
  spiked_bracer: {
    name: '尖刺护腕', sprite: 'r_bracer_spike', rarity: 'common',
    desc: '战斗开始时获得 <b>3</b> 层荆棘。', mods: { startThorns: 3 },
  },
  venom_sac: {
    name: '毒囊', sprite: 'r_venom_sac', rarity: 'uncommon',
    desc: '战斗开始时对所有敌人施加 <b>2</b> 层中毒。', mods: { startPoisonAll: 2 },
  },
  amulet: {
    name: '生命护符', sprite: 'r_amulet', rarity: 'uncommon',
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
    name: '时光沙漏', sprite: 'r_hourglass', rarity: 'uncommon',
    desc: '每 <b>3</b> 回合结束时，对所有敌人造成 <b>6</b> 点伤害。',
    hooks: { turnEnd(B) { if (B.turn % 3 === 0) B.damageAllEnemies(6, '时光沙漏'); } },
  },
  thorn_heart: {
    name: '荆棘之心', sprite: 'gravestone', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>5</b> 层荆棘，最大生命 <b>-2</b>。', mods: { startThorns: 5, maxHp: -2 },
  },
  energy_core: {
    name: '能量核心', sprite: 'r_energy_core', rarity: 'rare',
    desc: '每回合 <b>+1</b> 能量，但每回合少抽 <b>1</b> 张牌。', mods: { energyPerTurn: 1, drawPerTurn: -1 },
  },
  scholar_notes: {
    name: '学者笔记', sprite: 'r_notes', rarity: 'rare',
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
    name: '黑曜石之心', sprite: 'r_obsidian', rarity: 'rare',
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
    name: '恶魔之眼', sprite: 'r_demon_eye', rarity: 'boss',
    desc: '战斗开始时获得 <b>3</b> 层力量，但每场战斗开始失去 <b>3</b> 点生命。',
    mods: { startStrength: 3, startLoseHp: 3 },
  },
  abyss_seal: {
    name: '深渊封印', sprite: 'r_seal', rarity: 'boss',
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
    name: '日冕护目镜', sprite: 'r_visor', rarity: 'common',
    desc: '战斗开始时获得 <b>8</b> 点护甲，但每回合少抽 <b>1</b> 张牌。',
    mods: { startBlock: 8, drawPerTurn: -1 },
  },
  thorned_boots: {
    name: '钉刺长靴', sprite: 'r_boots', rarity: 'common',
    desc: '每当一个敌人被击败，获得 <b>3</b> 点护甲。',
    hooks: { kill(B) { B.gainBlock(B.player, 3); } },
  },
  lucky_clover: {
    name: '四叶草', sprite: 'r_clover', rarity: 'uncommon',
    desc: '战斗结束后额外获得 <b>12</b> 金币。', mods: { battleGold: 12 },
  },
  silver_anvil: {
    name: '银砧', sprite: 'r_anvil_silver', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>2</b> 点敏捷，但最大生命 <b>-3</b>。',
    mods: { startDexterity: 2, maxHp: -3 },
  },
  warding_charm: {
    name: '守护符', sprite: 'r_ward', rarity: 'uncommon',
    desc: '最大生命 <b>+14</b>。', mods: { maxHp: 14 },
  },
  bottled_lightning: {
    name: '瓶中闪电', sprite: 'r_lightning_jar', rarity: 'rare',
    desc: '战斗第 <b>4</b> 回合开始时，获得 <b>2</b> 点能量并抽 <b>1</b> 张牌。',
    hooks: { turnStart(B) { if (B.turn === 4) { B.energy += 2; B.view?.onEnergy?.(); B.drawCards(1); } } },
  },
  vault_key: {
    name: '金库钥匙', sprite: 'key_gold', rarity: 'rare',
    desc: '商店物品价格 <b>降低 40%</b>。', mods: { shopDiscount: 0.4 },
  },

  /* ============ 第三批新增遗物（2026-10-13，共 16 件）============
     设计原则（和上一批一致，这次守得更紧）：
       · **不做出"更强的同名件"** —— 每件的触发方式都必须是现有遗物没覆盖的维度
         （受伤反应 / 消耗反应 / 击杀累积 / 本回合出牌计数 / 牌组厚度 …）
       · 带代价的件一律在 desc 里写出来，价格和收益成对出现
       · 全部只用引擎**真的会读**的键（`mods.*` 与 9 个钩子），不写"声明了却没人调"的效果
     ⚠️ 为此这一批顺手补了引擎缺的东西（见 battle.js）：
        `onDamaged` 钩子（文档里写了但**从没被调用过**）、`exhausted` 钩子、
        `startArtifact` / `startRegen` / `startBlockNext` 三个开局状态键、`pierce`（破甲）。 */

  /* --- 受伤反应：现有遗物里完全没有这一维度 --- */
  vengeance_thorn: {
    name: '复仇之刺', sprite: 'r_vengeance', rarity: 'uncommon',
    desc: '每当你在一次结算中受到 <b>10</b> 点以上伤害，对所有敌人造成 <b>3</b> 点伤害。',
    hooks: { onDamaged(B, real) { if (real >= 10) B.damageAllEnemies(3, '复仇之刺'); } },
  },

  /* --- 消耗反应 --- */
  recycler: {
    name: '回收者', sprite: 'r_recycler', rarity: 'uncommon',
    desc: '每当一张牌被 <b>消耗</b>（含能力牌生效），抽 <b>1</b> 张牌。',
    hooks: { exhausted(B) { B.drawCards(1); } },
  },

  /* --- 击杀累积：越打越强，但只在**本场战斗**内滚 --- */
  whetstone_heart: {
    name: '磨砺之心', sprite: 'r_whetstone_heart', rarity: 'rare',
    desc: '本场战斗中每击败 <b>3</b> 个敌人，获得 <b>1</b> 层力量。',
    hooks: {
      kill(B) {
        B.killCount = (B.killCount || 0) + 1;
        if (B.killCount % 3 === 0) B.add(B.player, 'strength', 1);
      },
    },
  },
  butcher_blade: {
    name: '屠夫屠刀', sprite: 'r_butcher', rarity: 'common',
    desc: '每当你击败一个敌人，回复 <b>2</b> 点生命。',
    hooks: { kill(B) { B.heal(B.player, 2); } },
  },

  /* --- 本回合出牌计数 --- */
  blood_pendant: {
    name: '血契吊坠', sprite: 'r_pendant', rarity: 'uncommon',
    desc: '本场战斗中，你每打出 <b>3</b> 张牌就抽 <b>1</b> 张牌。',
    hooks: {
      cardPlayed(B) {
        B.cardsThisBattle = (B.cardsThisBattle || 0) + 1;
        if (B.cardsThisBattle % 3 === 0) B.drawCards(1);
      },
    },
  },
  combo_bracer: {
    name: '连击护腕', sprite: 'r_bracer', rarity: 'rare',
    desc: '你每回合打出的第 <b>3</b> 张牌，让你获得 <b>2</b> 层力量（每回合一次）。',
    hooks: {
      cardPlayed(B) {
        B.cardsThisTurn = (B.cardsThisTurn || 0) + 1;
        if (B.cardsThisTurn === 3) B.add(B.player, 'strength', 2);
      },
      turnStart(B) { B.cardsThisTurn = 0; },
    },
  },

  /* --- 破甲：绕开"叠甲"这种解法 --- */
  armor_piercer: {
    name: '破甲钉', sprite: 'r_piercer', rarity: 'rare',
    desc: '你的攻击先削减目标 <b>3</b> 点护甲，再结算伤害（多段牌每段都算）。',
    mods: { pierce: 3 },
  },

  /* --- 开局上"后加的状态"：以前遗物想给这些状态只能写钩子 --- */
  mirror_shield: {
    name: '镜面盾', sprite: 'r_mirror', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>2</b> 层「抵挡」（免疫接下来 2 次减益）。',
    mods: { startArtifact: 2 },
  },
  styx_water: {
    name: '冥河之水', sprite: 'r_styx', rarity: 'uncommon',
    desc: '战斗开始时获得 <b>2</b> 层「再生」（每回合回复 2 点生命）。',
    mods: { startRegen: 2 },
  },
  bramble_amulet: {
    name: '棘藤护符', sprite: 'r_bramble', rarity: 'common',
    desc: '战斗开始时获得 <b>4</b> 层「备战」（下回合额外 4 点护甲，可叠加）。',
    mods: { startBlockNext: 4 },
  },

  /* --- 牌组厚度（构筑取舍）：薄牌组更强，但必须靠删牌去换 --- */
  lone_wolf: {
    name: '孤狼徽章', sprite: 'r_lonewolf', rarity: 'uncommon',
    desc: '当你的牌组**不超过 12 张**时，每回合开始额外抽 <b>1</b> 张牌。',
    // 用 `B.deckSize`（战斗构造时快照的牌组张数），**不 import G** ——
    // relics.js 被 state.js 导入，反过来再 import G 就是循环依赖。
    hooks: {
      turnStart(B) { if (B.deckSize <= 12) B.drawCards(1); },
    },
  },

  /* --- 时间点型 --- */
  stasis_charm: {
    name: '静滞护符', sprite: 'r_stasis', rarity: 'common',
    desc: '每回合结束时，若你没有护甲，获得 <b>5</b> 点护甲。',
    hooks: {
      turnEnd(B) { if (B.player.block === 0 && B.player.hp > 0) B.gainBlock(B.player, 5); },
    },
  },
  flame_flask: {
    name: '烈焰之瓶', sprite: 'icon_burn', rarity: 'common',
    desc: '战斗开始时对所有敌人施加 <b>2</b> 层点燃。',
    mods: { startDebuffAll: { burn: 2 } },
  },
  apprentice_seal: {
    name: '学徒印记', sprite: 'r_apprentice', rarity: 'rare',
    desc: '每当你打出<b>能力牌</b>，抽 <b>2</b> 张牌。',
    hooks: { powerPlayed(B) { B.drawCards(2); } },
  },

  /* --- 有代价的组合 --- */
  sacrifice_mask: {
    name: '献祭面具', sprite: 'r_mask', rarity: 'rare',
    desc: '战斗开始时失去 <b>4</b> 点生命，但第一回合额外获得 <b>2</b> 点能量。',
    mods: { startLoseHp: 4, firstTurnEnergy: 2 },
  },
  greedy_scale: {
    name: '贪婪天平', sprite: 'r_scale', rarity: 'uncommon',
    desc: '战斗结束后额外获得 <b>18</b> 金币，但每场战斗开始失去 <b>2</b> 点生命。',
    mods: { battleGold: 18, startLoseHp: 2 },
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

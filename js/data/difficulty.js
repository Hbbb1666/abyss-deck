/**
 * 难度系统
 * =====================================================================
 * 通关一次后解锁。开局前玩家可以自选若干条**难度规则**与**增益**，
 * 每条难度规则 +9 分、每条增益 −4 分，最终分数就是这一局的分值（0 分 = 标准难度）。
 *
 * 设计要点：**难度规则与增益复用遗物那一套 `mods` / `hooks` 机制**。
 * 这样战斗、地图、商店、营火不需要知道"难度"的存在 ——
 * `relicMods()` 把遗物与难度一起汇总，各处照旧读同一个键就行。
 * 新增一条规则时，若它的效果需要引擎侧配合，去对应文件加一个 mod 键即可。
 *
 * mods 键的读取位置（加新键时照这个表找地方）：
 *   core/battle.js    —— 战斗内（敌人缩放、起手状态、每回合）
 *   ui/scene-rooms.js —— 商店 / 营火（价格、治疗量、服务项）
 *   core/map.js       —— 地图生成（节点权重）
 *   main.js           —— 房间路由（营火替换成事件）
 * =====================================================================
 */

/** 每条难度规则的分数（正数 = 更难） */
export const DIFF_POINTS = 9;
/** 每条增益的分数（负数 = 更容易） */
export const BOON_POINTS = -4;

/* =====================================================================
   难度规则（+9 每条）
   ===================================================================== */
export const DIFFICULTY = [
  {
    id: 'd_hp_per_act',
    name: '厚重皮囊',
    desc: '怪物血量每层额外增幅 <b>15%</b>。',
    mods: { enemyHpPerAct: 0.15 },
  },
  {
    id: 'd_rest_heal_half',
    name: '冷掉的余烬',
    desc: '营火恢复的生命值降低 <b>50%</b>。',
    mods: { restHealMult: 0.5 },
  },
  {
    id: 'd_shop_price_up',
    name: '奸商',
    desc: '商人所有商品涨价 <b>25%</b>，且每个商店最多只能移除 <b>1</b> 次卡牌。',
    mods: { shopPriceMult: 1.25, shopRemoveLimit: 1 },
  },
  {
    id: 'd_atk_per_act',
    name: '凶性渐长',
    desc: '怪物攻击力每层额外增幅 <b>8%</b>。',
    mods: { enemyAtkPerAct: 0.08 },
  },
  {
    id: 'd_boss_hp',
    name: '庞大的阴影',
    desc: 'Boss 血量额外提升 <b>35%</b>。',
    mods: { bossHpMult: 1.35 },
  },
  {
    id: 'd_elite_weight',
    name: '危机四伏',
    desc: '精英战斗的地图节点权重<b>提高</b>。',
    mods: { eliteWeightUp: 1 },
  },
  {
    id: 'd_enemy_scale_each_turn',
    name: '暴怒',
    desc: '所有怪物在战斗中<b>每轮行动后</b>获得 <b>1</b> 层敏捷。',
    hooks: {
      enemyActed(B, e) {
        if (e.dead) return;
        B.add(e, 'dexterity', 1);
      },
    },
  },
  {
    id: 'd_potion_slots_down',
    name: '药水禁令',
    desc: '初始药水槽 <b>-2</b>，商人<b>不再出售药水</b>。',
    mods: { potionSlots: -2, shopNoPotion: 1 },
  },
  {
    id: 'd_rest_to_event',
    name: '无处歇脚',
    desc: '所有营火节点替换为<b>事件</b>节点。',
    mods: { restAsEvent: 1 },
  },
  {
    id: 'd_curse_on_shop',
    name: '诅咒缠身',
    desc: '进入商人节点后，往自身卡组里塞进一张<b>诅咒卡</b>。',
    mods: { curseOnShop: 1 },
  },
  {
    id: 'd_maxhp_down',
    name: '脆弱躯壳',
    desc: '初始最大生命值 <b>-7</b>。',
    mods: { maxHp: -7 },
  },
  {
    id: 'd_gold_down',
    name: '囊中羞涩',
    desc: '获得的金币减少 <b>30%</b>（花钱不打折）。',
    mods: { goldMult: 0.7 },
  },
  {
    id: 'd_first_energy_down',
    name: '起步迟缓',
    desc: '每场战斗的<b>第一回合</b>费用 <b>-1</b>。',
    mods: { firstTurnEnergy: -1 },
  },
];

/* =====================================================================
   增益（−4 每条）
   ===================================================================== */
export const BOONS = [
  {
    id: 'b_maxhp6',
    name: '强健体魄',
    desc: '初始生命上限 <b>+6</b>。',
    mods: { maxHp: 6 },
  },
  {
    id: 'b_first_energy',
    name: '先手优势',
    desc: '战斗的第一回合多获得 <b>1</b> 点费用。',
    mods: { firstTurnEnergy: 1 },
  },
  {
    id: 'b_power_strength',
    name: '战意沸腾',
    desc: '战斗中使用<b>能力卡</b>后获得 <b>1</b> 层力量。',
    hooks: {
      powerPlayed(B) { B.add(B.player, 'strength', 1); },
    },
  },
  {
    id: 'b_shop_half_card',
    name: '熟人折扣',
    desc: '商人的卡牌售货栏中会有一个 <b>5 折</b>出售的卡牌。',
    mods: { shopHalfCard: 1 },
  },
  {
    id: 'b_elite_boss_maxhp',
    name: '愈战愈勇',
    desc: '经历<b>精英战斗</b>和<b>Boss 战斗</b>后提升 <b>1</b> 点生命上限。',
    hooks: {
      battleWin(B) {
        if (B.kind === 'elite' || B.kind === 'boss') B.gainMaxHpRun?.(1);
      },
    },
  },
  {
    id: 'b_rest_hp_relic',
    name: '血之献祭',
    desc: '营火处添加「消耗 <b>5</b> 点生命值换取随机遗物」的选项。',
    mods: { restHpForRelic: 1 },
  },
  {
    id: 'b_extra_relic',
    name: '旧日传承',
    desc: '初始额外获得 <b>1</b> 个遗物。',
    mods: { startExtraRelic: 1 },
  },
  {
    id: 'b_gold40',
    name: '盘缠充足',
    desc: '初始金币 <b>+40</b>。',
    mods: { bonusGold: 40 },
  },
  {
    id: 'b_start_potion',
    name: '随身药剂',
    desc: '初始获得 <b>1</b> 瓶随机药水。',
    mods: { startPotion: 1 },
  },
  {
    id: 'b_summon_weak3',
    name: '虚弱召唤',
    desc: '被召唤出来的怪物将获得 <b>3</b> 层虚弱。',
    // 用 mod 而不是钩子：数值化的修正能被测试直接断言，
    // 而且 spawn() 里在敌人入列时apply一次，语义最清晰。
    mods: { summonWeak: 3 },
  },
];

/** 全部条目（难度 + 增益），按 id 查 */
export const ALL_PICKS = [...DIFFICULTY, ...BOONS];
const BY_ID = new Map(ALL_PICKS.map(x => [x.id, x]));

export const pickById = id => BY_ID.get(id);
export const isDifficulty = id => DIFFICULTY.some(x => x.id === id);
export const isBoon = id => BOONS.some(x => x.id === id);

/** 一次最多能选几条。
 *
 *  2026-10-13 产品改为**无限制**（原来是 10 条）。
 *  实际可选项一共只有 `DIFFICULTY + BOONS` 条，所以"无限制"就是"能全选"。
 *  保留这个常量而不是删掉：`validatePicks` 与界面都读它，
 *  删了要改好几处；将来想加回限制也只需要改这一个数字。 */
export const MAX_PICKS = Infinity;

/**
 * 一组选择的总分。0 分代表标准难度。
 * 未知 id 按 0 分计（老存档里可能有已经删掉的条目）。
 */
export function scoreOf(ids = []) {
  let s = 0;
  for (const id of ids) {
    const p = BY_ID.get(id);
    if (p) s += isDifficulty(id) ? DIFF_POINTS : BOON_POINTS;
  }
  return s;
}

/** 把一组选择拆成 { difficulty: [...], boons: [...] }（id 数组） */
export function splitPicks(ids = []) {
  return {
    difficulty: ids.filter(isDifficulty),
    boons: ids.filter(isBoon),
  };
}

/** 分值的文字描述（用于结算与选难度界面） */
export function scoreLabel(score) {
  if (score <= -20) return '轻松';
  if (score < 0) return '偏易';
  if (score === 0) return '标准';
  if (score <= 18) return '进阶';
  if (score <= 36) return '困难';
  if (score <= 54) return '极难';
  return '噩梦';
}

/** 校验一组选择是否合法（不超上限、id 都存在、不重复） */
export function validatePicks(ids = []) {
  const errs = [];
  if (ids.length > MAX_PICKS) errs.push(`最多只能选 ${MAX_PICKS} 条（当前 ${ids.length} 条）`);
  if (new Set(ids).size !== ids.length) errs.push('同一条规则不能重复选');
  for (const id of ids) if (!BY_ID.has(id)) errs.push(`未知条目：${id}`);
  return errs;
}

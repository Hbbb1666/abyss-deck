/**
 * 卡牌数据
 * ---------------------------------------------------------------
 * 效果 DSL（fx 数组，按顺序结算）：
 *   {t:'dmg',       v, hits?}   对目标造成伤害（hits 默认 1，多段、每段单独结算）
 *   {t:'dmgAll',    v, hits?}   对全体敌人造成伤害（hits 同上）
 *   {t:'dmgBlock',  bonus?}     造成 当前护甲 + bonus 的伤害
 *   {t:'dmgPoison', mult?}      造成 (目标中毒层数 × mult) 的伤害
 *   {t:'dmgPerHand',v}          对目标造成 (手牌数 × v) 的伤害
 *   {t:'block',     v}          获得护甲
 *   {t:'blockFromBlock', mult?} 获得 (当前护甲 × mult) 的护甲
 *   {t:'draw',      v}          抽牌
 *   {t:'energy',    v}          获得能量
 *   {t:'heal',      v}          回复生命
 *   {t:'loseHp',    v}          失去生命（无视护甲）
 *   {t:'buff',      k, v}       自身获得增益
 *   {t:'debuff',    k, v}       目标获得减益
 *   {t:'debuffAll', k, v}       全体获得减益
 *   {t:'gold',      v}          获得金币
 *   {t:'addCard',   id, to, n?} 塞牌给自己：to = hand / discard / draw
 *   {t:'discard',   v}          弃掉自己手牌里的 v 张（**代价**，会让玩家选牌）
 *
 *   v 可以是数字，也可以是卡牌字段名字符串（随升级同步变化）
 *
 * 敌人招式用的是**另一套**解析器（battle.js 的 resolveEnemyFx），支持：
 *   buff / buffAll / debuff / healSelf / block / summon / addCard
 * 两边不通用 —— 别把玩家的 t 写进敌人 moves。
 *
 * 注：上面这份清单是被测试盯着的（tools/test.mjs 会校验 fx 里引用的字符串
 *     必须是卡上真实存在的字段）。新增 t 时请同时更新本注释和引擎的 resolve()。
 * ---------------------------------------------------------------
 * type: attack / skill / power / curse / status
 * rarity: basic / common / uncommon / rare / special
 * cls: basic / knight / mage / rogue / neutral / curse / status
 */

export const CARDS = {
  /* ============ 基础牌 ============ */
  strike: {
    name: '打击', cls: 'basic', type: 'attack', rarity: 'basic', cost: 1, target: 'enemy',
    art: 'sword_short', dmg: 6, up: { dmg: 9 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  defend: {
    name: '防御', cls: 'basic', type: 'skill', rarity: 'basic', cost: 1, target: 'self',
    art: 'portcullis', blk: 5, up: { blk: 8 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },

  /* ============ 骑士 ============ */
  heavy_blow: {
    name: '重击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_broad', dmg: 8, up: { dmg: 11 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  iron_wall: {
    name: '铁壁', cls: 'knight', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'bars', blk: 12, up: { blk: 16 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  shield_bash: {
    name: '盾击', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'hammer', bonus: 0, up: { bonus: 5 },
    text: c => `造成等同于你<b>护甲</b>的伤害${c.bonus ? ` + <b>${c.bonus}</b>` : ''}。`,
    fx: [{ t: 'dmgBlock', bonus: 'bonus' }],
  },
  cleave: {
    name: '旋风斩', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'all',
    art: 'axe', dmg: 6, up: { dmg: 9 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  crush: {
    name: '碎骨', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 12, vul: 3, up: { dmg: 16, vul: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
  },
  battle_cry: {
    name: '战吼', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'poleaxe', str: 2, up: { str: 3 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },
  thorns_armor: {
    name: '荆棘之甲', cls: 'knight', type: 'power', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'gravestone', thn: 3, up: { thn: 5 },
    text: c => `获得 <b>${c.thn}</b> 层荆棘（受到攻击时反弹伤害）。`,
    fx: [{ t: 'buff', k: 'thorns', v: 'thn' }],
  },
  pommel_strike: {
    name: '剑柄打击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_short', dmg: 9, draw: 1, up: { dmg: 10, draw: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }],
  },
  twin_strike: {
    name: '二连击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_long', dmg: 5, hits: 2, up: { dmg: 7 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  iron_blood: {
    name: '铁血', cls: 'knight', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'potion_red', heal: 5, exhaust: true, up: { heal: 8 },
    text: c => `回复 <b>${c.heal}</b> 点生命。<i>消耗</i>`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  perfect_guard: {
    name: '完美格挡', cls: 'knight', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'portcullis', blk: 8, draw: 1, up: { blk: 11 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  undying: {
    name: '不屈', cls: 'knight', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'stone_platform', blk: 3, up: { blk: 5 },
    text: c => `每回合开始时获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'buff', k: 'undying', v: 'blk' }],
  },
  thunderclap: {
    name: '雷霆一击', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'poleaxe', dmg: 6, weak: 1, up: { dmg: 9, weak: 2 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  barricade: {
    name: '壁垒', cls: 'knight', type: 'power', rarity: 'rare', cost: 3, target: 'self',
    art: 'gate', up: { cost: 2 },
    text: () => `护甲在回合结束时<b>不再消失</b>。`,
    fx: [{ t: 'buff', k: 'barricade', v: 1 }],
  },
  berserk: {
    name: '狂战士', cls: 'knight', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'crabdemon', nrg: 1, selfdmg: 3, up: { selfdmg: 2 },
    text: c => `每回合开始时获得 <b>${c.nrg}</b> 点能量，并失去 <b>${c.selfdmg}</b> 点生命。`,
    fx: [{ t: 'buff', k: 'berserk', v: 'nrg' }, { t: 'buff', k: 'berserk_dmg', v: 'selfdmg' }],
  },
  shield_wall: {
    name: '盾墙', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 3, target: 'self',
    art: 'bars', blk: 15, draw: 1, up: { blk: 20 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  riposte: {
    name: '反击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_long', dmg: 7, bonus: 5, up: { dmg: 9, bonus: 7 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若你有护甲，额外造成 <b>${c.bonus}</b> 点。`,
    fx: [{ t: 'dmg', v: 'dmg', ifBlock: 'bonus' }],
  },
  earthshatter: {
    name: '地裂斩', cls: 'knight', type: 'attack', rarity: 'rare', cost: 2, target: 'all',
    art: 'boss_stone', dmg: 12, vul: 2, up: { dmg: 16, vul: 3 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'vulnerable', v: 'vul' }],
  },
  fortify: {
    name: '固守', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'stone_platform', mult: 2, up: { mult: 3 },
    text: c => `获得等同于你当前护甲 <b>×${c.mult}</b> 的护甲。`,
    fx: [{ t: 'blockFromBlock', mult: 'mult' }],
  },

  /* ============ 法师 ============ */
  fireball: {
    name: '火球术', cls: 'mage', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'potion_red', dmg: 7, up: { dmg: 10 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  ice_shard: {
    name: '冰锥', cls: 'mage', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 5, weak: 1, up: { dmg: 8, weak: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  magic_missile: {
    name: '奥术飞弹', cls: 'mage', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 3, hits: 3, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  chain_lightning: {
    name: '闪电链', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'key_bone', dmg: 8, up: { dmg: 11 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  frost_nova: {
    name: '霜之新星', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'all',
    art: 'portal', weak: 2, up: { weak: 3 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  arcane_shield: {
    name: '奥术护盾', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'portcullis', blk: 8, up: { blk: 11 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  burning: {
    name: '燃烧', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'torch', poi: 4, up: { poi: 6 },
    text: c => `施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuff', k: 'poison', v: 'poi' }],
  },
  mana_surge: {
    name: '法力涌动', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 0, target: 'self',
    art: 'potion_blue', nrg: 2, exhaust: true, up: { nrg: 3 },
    text: c => `获得 <b>${c.nrg}</b> 点能量。<i>消耗</i>`,
    fx: [{ t: 'energy', v: 'nrg' }],
  },
  time_warp: {
    name: '时间扭曲', cls: 'mage', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'coil', draw: 3, up: { draw: 4 },
    text: c => `抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'draw', v: 'draw' }],
  },
  elemental_mastery: {
    name: '元素精通', cls: 'mage', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'gargoyle', str: 1, up: { str: 2 },
    text: c => `每回合开始时获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'ritual', v: 'str' }],
  },
  meteor: {
    name: '陨石', cls: 'mage', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'boss_demon', dmg: 20, vul: 3, up: { dmg: 26 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
  },
  ice_barrier: {
    name: '寒冰屏障', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 3, target: 'self',
    art: 'door', blk: 12, draw: 1, up: { blk: 16 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  hex: {
    name: '痛苦诅咒', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'grave_cross', vul: 3, weak: 3, up: { vul: 4, weak: 4 },
    text: c => `施加 <b>${c.vul}</b> 层易伤和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  soul_drain: {
    name: '灵魂汲取', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', dmg: 10, heal: 5, up: { dmg: 14, heal: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  mirror_image: {
    name: '镜影', cls: 'mage', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'portal', blk: 4, up: { blk: 6 },
    text: c => `每回合开始时获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'buff', k: 'undying', v: 'blk' }],
  },
  arcane_intellect: {
    name: '奥术智慧', cls: 'mage', type: 'power', rarity: 'rare', cost: 1, target: 'self',
    art: 'coil', draw: 1, up: { cost: 0 },
    text: c => `每回合开始时额外抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'buff', k: 'extra_draw', v: 'draw' }],
  },
  arcane_barrage: {
    name: '奥术弹幕', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'key_purple', dmg: 4, per: 3, up: { dmg: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，每有一张手牌就多攻击一次。`,
    fx: [{ t: 'dmgPerHand', v: 'dmg' }],
  },

  /* ============ 游侠 ============ */
  poison_blade: {
    name: '毒刃', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 5, poi: 3, up: { dmg: 7, poi: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'poison', v: 'poi' }],
  },
  backstab: {
    name: '背刺', cls: 'rogue', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_dagger', dmg: 11, exhaust: true, up: { dmg: 15 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。<i>消耗</i>`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  blade_dance: {
    name: '刀舞', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_short', dmg: 4, hits: 2, up: { dmg: 6 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  dagger_throw: {
    name: '飞刀', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 6, draw: 1, up: { dmg: 9 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌，然后弃 1 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }, { t: 'discard', v: 1 }],
  },
  shadow_strike: {
    name: '影袭', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'sword_long', dmg: 14, up: { dmg: 18 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  dodge: {
    name: '闪避', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'door_wood', blk: 6, draw: 1, up: { blk: 9 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  smoke_bomb: {
    name: '烟雾弹', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'all',
    art: 'box', blk: 6, weak: 2, up: { blk: 9, weak: 3 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，对<b>所有</b>敌人施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  deadly_poison: {
    name: '剧毒', cls: 'rogue', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', poi: 7, up: { poi: 10 },
    text: c => `施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuff', k: 'poison', v: 'poi' }],
  },
  combo: {
    name: '连击', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'coil', draw: 2, nrg: 1, up: { draw: 3 },
    text: c => `抽 <b>${c.draw}</b> 张牌，获得 <b>${c.nrg}</b> 点能量。`,
    fx: [{ t: 'draw', v: 'draw' }, { t: 'energy', v: 'nrg' }],
  },
  shadow_clone: {
    name: '影分身', cls: 'rogue', type: 'power', rarity: 'rare', cost: 3, target: 'self',
    art: 'ghost', draw: 1, up: { cost: 2 },
    text: c => `每回合开始时额外抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'buff', k: 'extra_draw', v: 'draw' }],
  },
  deadly_strike: {
    name: '致命一击', cls: 'rogue', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy',
    art: 'sword_broad', mult: 3, up: { mult: 4 },
    text: c => `造成 <b>中毒层数 × ${c.mult}</b> 的伤害。`,
    fx: [{ t: 'dmgPoison', mult: 'mult' }],
  },
  swift_step: {
    name: '疾风步', cls: 'rogue', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'box', blk: 8, exhaust: true, up: { blk: 12 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。<i>消耗</i>`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  thousand_poison: {
    name: '千毒', cls: 'rogue', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'spider', poison_plus: 2, up: { poison_plus: 3 },
    text: c => `每当你施加中毒时，额外施加 <b>${c.poison_plus}</b> 层。`,
    fx: [{ t: 'buff', k: 'poison_plus', v: 'poison_plus' }],
  },
  loot: {
    name: '掠夺', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'chest_gold', gold: 15, exhaust: true, up: { gold: 25 },
    text: c => `获得 <b>${c.gold}</b> 金币。<i>消耗</i>`,
    fx: [{ t: 'gold', v: 'gold' }],
  },
  venom_dart: {
    name: '毒镖', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'key_green', dmg: 4, poi: 2, weak: 2, up: { dmg: 6, poi: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'poison', v: 'poi' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  assassinate: {
    name: '暗杀', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 10, exec: 25, up: { dmg: 14 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若敌人生命低于 <b>${c.exec}%</b>，直接斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', execute: 'exec' }],
  },

  /* ============ 中性 ============ */
  bandage: {
    name: '绷带', cls: 'neutral', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'potion_empty', heal: 4, exhaust: true, up: { heal: 7 },
    text: c => `回复 <b>${c.heal}</b> 点生命。<i>消耗</i>`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  quick_slash: {
    name: '快速斩击', cls: 'neutral', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_short', dmg: 3, up: { dmg: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  adrenaline: {
    name: '肾上腺素', cls: 'neutral', type: 'skill', rarity: 'uncommon', cost: 0, target: 'self',
    art: 'potion_red', nrg: 1, draw: 1, exhaust: true, up: { draw: 2 },
    text: c => `获得 <b>${c.nrg}</b> 点能量，抽 <b>${c.draw}</b> 张牌。<i>消耗</i>`,
    fx: [{ t: 'energy', v: 'nrg' }, { t: 'draw', v: 'draw' }],
  },
  panic_button: {
    name: '应急按钮', cls: 'neutral', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'anvil', blk: 10, exhaust: true, up: { blk: 14 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。<i>消耗</i>`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  good_instincts: {
    name: '直觉', cls: 'neutral', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'coil', draw: 2, exhaust: true, up: { draw: 3 },
    text: c => `抽 <b>${c.draw}</b> 张牌。<i>消耗</i>`,
    fx: [{ t: 'draw', v: 'draw' }],
  },
  war_stomp: {
    name: '战踏', cls: 'neutral', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'boss_stone', dmg: 9, up: { dmg: 13 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },

  /* ============ 诅咒 / 状态 ============ */
  curse_wound: {
    name: '伤口', cls: 'curse', type: 'curse', rarity: 'special', cost: -1, target: 'none',
    art: 'grave_cross', unplayable: true,
    text: () => `<i>不能被打出。</i>`,
    fx: [],
  },
  curse_pain: {
    name: '剧痛', cls: 'curse', type: 'curse', rarity: 'special', cost: -1, target: 'none',
    art: 'crabdemon', unplayable: true, endDmg: 2,
    text: c => `<i>不能被打出。</i>回合结束时受到 <b>${c.endDmg}</b> 点伤害。`,
    fx: [],
  },
  curse_regret: {
    name: '悔恨', cls: 'curse', type: 'curse', rarity: 'special', cost: -1, target: 'none',
    art: 'ghost', unplayable: true,
    text: () => `<i>不能被打出。</i>回合结束时每有一张手牌就受到 <b>1</b> 点伤害。`,
    fx: [],
  },
  status_dazed: {
    name: '眩晕', cls: 'status', type: 'status', rarity: 'special', cost: -1, target: 'none',
    art: 'gargoyle', unplayable: true, exhaust: true,
    text: () => `<i>不能被打出。消耗。</i>`,
    fx: [],
  },
  status_burn: {
    name: '灼烧', cls: 'status', type: 'status', rarity: 'special', cost: -1, target: 'none',
    art: 'torch', unplayable: true, endDmg: 2,
    text: c => `<i>不能被打出。</i>回合结束时受到 <b>${c.endDmg}</b> 点伤害。`,
    fx: [],
  },
};

// 注入 id
for (const [id, c] of Object.entries(CARDS)) c.id = id;

/** 稀有度展示配置 */
export const RARITY = {
  basic: { label: '基础', frame: 'common', color: '#c8c8d2' },
  common: { label: '普通', frame: 'common', color: '#c8c8d2' },
  uncommon: { label: '罕见', frame: 'uncommon', color: '#60a8ff' },
  rare: { label: '稀有', frame: 'rare', color: '#ffcc52' },
  special: { label: '特殊', frame: 'special', color: '#ba6eff' },
};

export const TYPE_LABEL = { attack: '攻击', skill: '技能', power: '能力', curse: '诅咒', status: '状态' };

/** 生成一张卡实例（带升级标记） */
export function makeCard(id, upgraded = false) {
  const base = CARDS[id];
  if (!base) throw new Error('未知卡牌: ' + id);
  const c = { ...base };
  if (upgraded && base.up) Object.assign(c, base.up);
  c.upgraded = upgraded;
  c.uid = id + (upgraded ? '+' : '') + '#' + (makeCard._n = (makeCard._n || 0) + 1);
  return c;
}

/** 该卡是否可以升级 */
export const canUpgrade = id => !!CARDS[id]?.up;
/** 可出现在奖励池的卡（按职业） */
export function rewardPool(cls, rarities = ['common', 'uncommon', 'rare']) {
  return Object.values(CARDS).filter(c =>
    rarities.includes(c.rarity) &&
    (c.cls === cls || c.cls === 'neutral') &&
    c.type !== 'curse' && c.type !== 'status');
}

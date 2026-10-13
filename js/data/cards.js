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
    art: 'sword_short', dmg: 5, up: { dmg: 8 },
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
    name: '重击', cls: 'knight', type: 'attack', rarity: 'common', cost: 2, target: 'enemy',
    art: 'sword_broad', dmg: 13, up: { dmg: 16 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  iron_wall: {
    name: '铁壁', cls: 'knight', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'bars', blk: 13, up: { blk: 17 },
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
    art: 'axe', dmg: 4, up: { dmg: 6 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  crush: {
    name: '碎骨', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 11, vul: 1, up: { dmg: 13, vul: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
  },
  battle_cry: {
    name: '战吼', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'poleaxe', str: 1, up: { str: 2 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },
  thorns_armor: {
    name: '荆棘之甲', cls: 'knight', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'gravestone', thn: 2, up: { thn: 3 },
    text: c => `获得 <b>${c.thn}</b> 层荆棘（受到攻击时反弹伤害）。`,
    fx: [{ t: 'buff', k: 'thorns', v: 'thn' }],
  },
  pommel_strike: {
    name: '剑柄打击', cls: 'knight', type: 'attack', rarity: 'common', cost: 2, target: 'enemy',
    art: 'sword_short', dmg: 8, draw: 1, up: { dmg: 9, draw: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }],
  },
  twin_strike: {
    name: '二连击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_long', dmg: 2, hits: 2, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  iron_blood: {
    name: '铁血', cls: 'knight', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'potion_red', heal: 6, exhaust: true, up: { heal: 8 },
    text: c => `回复 <b>${c.heal}</b> 点生命。<i>消耗</i>`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  perfect_guard: {
    name: '完美格挡', cls: 'knight', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'portcullis', blk: 8, draw: 1, up: { blk: 9 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  undying: {
    // 「不屈」原效果是"每回合开始获得 N 点护甲"（状态 undying）。
    // 2026-10-13 undying 被删除（与「敏捷」实质重复），本卡改为**敏捷**：
    // 敏捷是"每次获得护甲都 +N"，比"每回合开头一次性给 N 点"更贴合护盾流。
    name: '不屈', cls: 'knight', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'stone_platform', dex: 2, up: { dex: 3 },
    text: c => `获得 <b>${c.dex}</b> 点敏捷（每次获得护甲时额外 +${c.dex}）。`,
    fx: [{ t: 'buff', k: 'dexterity', v: 'dex' }],
  },
  thunderclap: {
    name: '雷霆一击', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'poleaxe', dmg: 8, weak: 1, up: { dmg: 10, weak: 2 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  barricade: {
    name: '壁垒', cls: 'knight', type: 'power', rarity: 'rare', cost: 1, target: 'self',
    art: 'gate', up: { cost: 2 },
    text: () => `护甲在回合结束时<b>不再消失</b>。`,
    fx: [{ t: 'buff', k: 'barricade', v: 1 }],
  },
  berserk: {
    // 「狂战士」原效果是"每回合开始 +1 能量，并失去 N 点生命"（状态 berserk / berserk_dmg）。
    // 2026-10-13 这两个状态都被删除（产品要求），本卡**整体重做**为成长型力量牌：
    // 先给一笔可观的即时力量，再每回合继续叠 —— 名字里的"狂"体现在越打越强。
    // 价值：力量 2 = 8，强化 1 = 6 + 2.5×1 = 8.5 → 合计 16.5 / 2费金预算 16（+0.5）
    name: '狂战士', cls: 'knight', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'crabdemon', str: 2, up: { str: 3 },
    text: c => `获得 <b>${c.str}</b> 层力量；每回合开始时再获得 <b>1</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }, { t: 'buff', k: 'ritual', v: 1 }],
  },
  shield_wall: {
    name: '盾墙', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 3, target: 'self',
    art: 'bars', blk: 18, draw: 1, up: { blk: 24 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  riposte: {
    name: '反击', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_long', dmg: 2, bonus: 5, up: { dmg: 3, bonus: 7 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若你有护甲，额外造成 <b>${c.bonus}</b> 点。`,
    fx: [{ t: 'dmg', v: 'dmg', ifBlock: 'bonus' }],
  },
  earthshatter: {
    name: '地裂斩', cls: 'knight', type: 'attack', rarity: 'rare', cost: 2, target: 'all',
    art: 'boss_stone', dmg: 9, vul: 1, up: { dmg: 10, vul: 2 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'vulnerable', v: 'vul' }],
  },
  fortify: {
    name: '固守', cls: 'knight', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'stone_platform', mult: 1, up: { mult: 2 },
    text: c => `获得等同于你当前护甲 <b>×${c.mult}</b> 的护甲。`,
    fx: [{ t: 'blockFromBlock', mult: 'mult' }],
  },

  /* ============ 法师 ============ */
  fireball: {
    name: '火球术', cls: 'mage', type: 'attack', rarity: 'common', cost: 2, target: 'enemy',
    art: 'potion_red', dmg: 11, poi: 1, up: { dmg: 14, poi: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层点燃。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'burn', v: 'poi' }],
  },
  ice_shard: {
    name: '火矢', cls: 'mage', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 2, weak: 1, up: { dmg: 2, weak: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  magic_missile: {
    name: '火星飞溅', cls: 'mage', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 2, hits: 3, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  chain_lightning: {
    name: '烈焰连锁', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'key_bone', dmg: 11, up: { dmg: 15 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  frost_nova: {
    name: '热浪', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'all',
    art: 'portal', weak: 1, up: { weak: 2 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  arcane_shield: {
    name: '火焰护盾', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'portcullis', blk: 5, up: { blk: 7 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  burning: {
    name: '燃烧', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'torch', poi: 2, up: { poi: 3 },
    text: c => `施加 <b>${c.poi}</b> 层点燃。`,
    fx: [{ t: 'debuff', k: 'burn', v: 'poi' }],
  },
  mana_surge: {
    name: '燃能涌动', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 0, target: 'self',
    art: 'potion_blue', nrg: 2, exhaust: true, up: { nrg: 3 },
    text: c => `获得 <b>${c.nrg}</b> 点能量。<i>消耗</i>`,
    fx: [{ t: 'energy', v: 'nrg' }],
  },
  time_warp: {
    name: '烈焰急涌', cls: 'mage', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'coil', draw: 3, up: { draw: 4 },
    text: c => `抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'draw', v: 'draw' }],
  },
  elemental_mastery: {
    name: '火焰精通', cls: 'mage', type: 'power', rarity: 'rare', cost: 1, target: 'self',
    art: 'gargoyle', str: 1, up: { str: 2 },
    text: c => `每回合开始时获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'ritual', v: 'str' }],
  },
  meteor: {
    name: '陨石', cls: 'mage', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'boss_demon', dmg: 8, poi: 3, up: { dmg: 12, poi: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层点燃，然后引爆。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'burn', v: 'poi' }, { t: 'detonate' }],
  },
  ice_barrier: {
    name: '熔岩壁垒', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 3, target: 'self',
    art: 'door', blk: 18, draw: 1, up: { blk: 24 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  hex: {
    name: '焦灼诅咒', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'grave_cross', vul: 3, weak: 1, up: { vul: 4, weak: 2 },
    text: c => `施加 <b>${c.vul}</b> 层易伤和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  soul_drain: {
    name: '焚魂汲取', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', dmg: 10, heal: 5, up: { dmg: 13, heal: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  mirror_image: {
    // 「余烬分身」原来是"每回合开始获得 N 点护甲"（undying，已删除）。
    // 改写为**荆棘** —— 分身身上带着余烬，谁打它谁被烫，主题比原来的纯加甲更贴名字。
    // 价值：荆棘 2 = 6 / 1费蓝预算 6（±0）
    name: '余烬分身', cls: 'mage', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'portal', thn: 2, up: { thn: 3 },
    text: c => `获得 <b>${c.thn}</b> 点荆棘（被近战攻击时反弹伤害）。`,
    fx: [{ t: 'buff', k: 'thorns', v: 'thn' }],
  },
  arcane_intellect: {
    name: '燃魂通晓', cls: 'mage', type: 'power', rarity: 'rare', cost: 1, target: 'self',
    art: 'coil', draw: 1, up: { cost: 0 },
    text: c => `每回合开始时额外抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'buff', k: 'extra_draw', v: 'draw' }],
  },
  arcane_barrage: {
    name: '万火齐发', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'key_purple', dmg: 2, per: 3, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，每有一张手牌就多攻击一次。`,
    fx: [{ t: 'dmgPerHand', v: 'dmg' }],
  },

  /* ============ 游侠 ============ */
  poison_blade: {
    name: '血刃', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 2, poi: 1, up: { dmg: 4, poi: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'bleed', v: 'poi' }],
  },
  backstab: {
    name: '背刺', cls: 'rogue', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_dagger', dmg: 6, exhaust: true, up: { dmg: 7 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。<i>消耗</i>`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  blade_dance: {
    name: '刀舞', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_short', dmg: 2, hits: 2, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  dagger_throw: {
    // 游侠的招牌"打一下、抽一张、弃一张"。抽牌涨价后（2→5 点）要重新配平：
    // 伤害压到 2 点，让 2 + 5(抽) − 0.8(弃) = 6.2 落在 1 费普通档（5）附近。
    // 这一张是**故意保住的过牌轴** —— 游侠的身份就是"低费快过牌"，
    // 不能因为抽牌变贵就把这条轴整条砍掉（那样职业定位就名存实亡了）。
    name: '飞刀', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 2, draw: 1, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌，然后弃 1 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }, { t: 'discard', v: 1 }],
  },
  shadow_strike: {
    name: '影袭', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'sword_long', dmg: 15, up: { dmg: 18 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  dodge: {
    // 游侠的第二张过牌：1 费抽 1 张（抽牌 5 点 = 1 费普通档上限，正好卡满）。
    // 升级给「费用 0」——0 费抽 1 张同样是 5 点，正好是 0/1 费档的上限。
    name: '闪避', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'door_wood', draw: 1, blk: 2, up: { cost: 0 },
    text: c => `抽 <b>${c.draw}</b> 张牌，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'draw', v: 'draw' }, { t: 'block', v: 'blk' }],
  },
  smoke_bomb: {
    name: '烟雾弹', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'all',
    art: 'box', blk: 1, weak: 1, up: { blk: 2, weak: 2 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，对<b>所有</b>敌人施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  deadly_poison: {
    name: '大出血', cls: 'rogue', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', poi: 6, up: { poi: 7 },
    text: c => `施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'debuff', k: 'bleed', v: 'poi' }],
  },
  combo: {
    name: '连击', cls: 'rogue', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'coil', draw: 2, nrg: 1, up: { nrg: 2 },
    text: c => `抽 <b>${c.draw}</b> 张牌，获得 <b>${c.nrg}</b> 点能量。`,
    fx: [{ t: 'draw', v: 'draw' }, { t: 'energy', v: 'nrg' }],
  },
  shadow_clone: {
    name: '影分身', cls: 'rogue', type: 'power', rarity: 'rare', cost: 1, target: 'self',
    art: 'ghost', draw: 1, up: { cost: 2 },
    text: c => `每回合开始时额外抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'buff', k: 'extra_draw', v: 'draw' }],
  },
  deadly_strike: {
    name: '致命一击', cls: 'rogue', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy',
    art: 'sword_broad', mult: 2, up: { mult: 3 },
    text: c => `造成 <b>流血层数 × ${c.mult}</b> 的伤害。`,
    fx: [{ t: 'dmgBleed', mult: 'mult' }],
  },
  swift_step: {
    name: '疾风步', cls: 'rogue', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'box', blk: 6, exhaust: true, up: { blk: 8 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。<i>消耗</i>`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  thousand_poison: {
    name: '血涌', cls: 'rogue', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'spider', poison_plus: 4, up: { poison_plus: 5 },
    text: c => `每当你施加流血时，额外施加 <b>${c.poison_plus}</b> 层。`,
    fx: [{ t: 'buff', k: 'bleed_plus', v: 'poison_plus' }],
  },
  loot: {
    name: '掠夺', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'chest_gold', gold: 13, exhaust: true, up: { gold: 18 },
    text: c => `获得 <b>${c.gold}</b> 金币。<i>消耗</i>`,
    fx: [{ t: 'gold', v: 'gold' }],
  },
  venom_dart: {
    name: '血镖', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'key_green', dmg: 3, poi: 1, weak: 1, up: { dmg: 6, poi: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'bleed', v: 'poi' }],
  },
  assassinate: {
    name: '暗杀', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 4, exec: 25, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若敌人生命低于 <b>${c.exec}%</b>，直接斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', execute: 'exec' }],
  },


  /* ============ 骑士 · 补充 ============ */
  iron_vow: {
    // 「铁誓」原来是 每回合+2 护甲（undying）+ 每回合+1 力量（仪式）。undying 删除后改为**敏捷**。
    // 价值：敏捷 2 = 7，强化 1 = 6 + 2.5 = 8.5 → 15.5 / 2费金预算 16（-0.5）
    // 注：「强化」是原「仪式」改名后的状态，效果不变（每回合开始 +N 层力量）。
    name: '铁誓', cls: 'knight', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'stone_platform', dex: 2, str: 1, up: { dex: 3 },
    text: c => `获得 <b>${c.dex}</b> 点敏捷；每回合开始时获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'dexterity', v: 'dex' }, { t: 'buff', k: 'ritual', v: 'str' }],
  },
  gravity_slam: {
    name: '重力猛击', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'hammer', dmg: 7, blk: 6, up: { dmg: 9, blk: 10 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，你获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'block', v: 'blk' }],
  },
  guardian_angel: {
    name: '守护天使', cls: 'knight', type: 'skill', rarity: 'rare', cost: 2, target: 'self',
    art: 'grave_cross', heal: 10, blk: 7, up: { heal: 12, blk: 11 },
    text: c => `回复 <b>${c.heal}</b> 点生命，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'heal', v: 'heal' }, { t: 'block', v: 'blk' }],
  },
  titan_strength: {
    name: '巨力', cls: 'knight', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'poleaxe', str: 4, up: { str: 5 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },

  /* ============ 法师 · 补充 ============ */
  thunderstorm: {
    name: '烈焰风暴', cls: 'mage', type: 'attack', rarity: 'rare', cost: 3, target: 'all',
    art: 'key_bone', dmg: 8, up: { dmg: 11 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，然后引爆。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'detonate', all: true }],
  },
  frost_armor: {
    name: '熔岩之肤', cls: 'mage', type: 'skill', rarity: 'uncommon', cost: 1, target: 'all',
    art: 'door', blk: 2, weak: 1, up: { blk: 2, weak: 2 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，对<b>所有</b>敌人施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  void_bolt: {
    name: '引火烧身', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'key_purple', dmg: 9, selfdmg: 3, up: { dmg: 12 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，你失去 <b>${c.selfdmg}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'loseHp', v: 'selfdmg' }],
  },
  mind_spike: {
    name: '火星迸射', cls: 'mage', type: 'attack', rarity: 'common', cost: 2, target: 'enemy',
    art: 'key_blue', dmg: 8, draw: 1, up: { dmg: 9, draw: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }],
  },

  /* ============ 游侠 · 补充 ============ */
  blade_rain: {
    name: '刃雨', cls: 'rogue', type: 'attack', rarity: 'rare', cost: 2, target: 'all',
    art: 'sword_dagger', dmg: 10, poi: 1, up: { dmg: 13 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'bleed', v: 'poi' }],
  },
  toxic_cloud: {
    name: '血雾', cls: 'rogue', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'potion_green', poi: 4, up: { poi: 5 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'debuffAll', k: 'bleed', v: 'poi' }],
  },
  pickpocket: {
    // 1 费蓝档预算 6 点：12 金币（0.5 点/枚 = 6）。原来还带"抽 1 张"（5 点），
    // 那会让它到 11 点 —— 抽牌涨价后 1 费档放不下，所以去掉抽牌。
    name: '扒窃', cls: 'rogue', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'key_gold', gain: 12, up: { gain: 18 },
    text: c => `获得 <b>${c.gain}</b> 金币。`,
    fx: [{ t: 'gold', v: 'gain' }],
  },
  caltrops: {
    name: '铁蒺藜', cls: 'rogue', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'spider', blk: 2, thn: 1, up: { blk: 2, thn: 2 },
    text: c => `获得 <b>${c.blk}</b> 点护甲和 <b>${c.thn}</b> 层荆棘。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'thorns', v: 'thn' }],
  },

  /* ============ 暗影刺客 ============
     职业定位：**易伤铺场 + 多段小伤害 + 斩杀**。
     和游侠（中毒）、骑士（护甲/力量）刻意分开：
     刺客的伤害靠"先把敌人的易伤铺厚，再用廉价多段把它放大"，最后用处决收尾。 */
  shadow_stab: {
    name: '影刺', cls: 'assassin', type: 'attack', rarity: 'basic', cost: 0, target: 'enemy',
    art: 'sword_dagger', dmg: 3, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  shadow_step: {
    name: '暗影步', cls: 'assassin', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'door_wood', blk: 8, draw: 1, up: { blk: 9 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  twin_fang: {
    name: '双牙', cls: 'assassin', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 2, hits: 2, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  rend: {
    name: '撕裂', cls: 'assassin', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_short', dmg: 1, vul: 1, up: { dmg: 2, vul: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
  },
  nightfall: {
    name: '夜幕', cls: 'assassin', type: 'skill', rarity: 'common', cost: 1, target: 'all',
    art: 'portal', vul: 1, up: { vul: 2 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'debuffAll', k: 'vulnerable', v: 'vul' }],
  },
  lethal_thrust: {
    name: '致命突刺', cls: 'assassin', type: 'attack', rarity: 'common', cost: 2, target: 'enemy',
    art: 'sword_long', dmg: 13, up: { dmg: 16 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  shadow_flurry: {
    name: '影舞', cls: 'assassin', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 1, hits: 4, up: { dmg: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  lurk: {
    name: '潜伏', cls: 'assassin', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'ghost', str: 1, up: { str: 2 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },
  blood_reap: {
    name: '血色收割', cls: 'assassin', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'potion_red', dmg: 3, heal: 3, up: { dmg: 4, heal: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  vanish: {
    name: '隐匿', cls: 'assassin', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'box', blk: 1, next: 4, up: { blk: 2, next: 6 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  mark: {
    // 0 费普通档预算 5 点；单独 1 层易伤（刺客 3.5）达不到，
    // 所以补 1 层虚弱凑满（3.5 + 3 = 6.5，留 1.5 余量）。
    name: '猎杀标记', cls: 'assassin', type: 'skill', rarity: 'common', cost: 0, target: 'enemy',
    art: 'key_red', vul: 1, weak: 1, exhaust: true, up: { vul: 2, weak: 2 },
    text: c => `施加 <b>${c.vul}</b> 层易伤和 <b>${c.weak}</b> 层虚弱。<i>消耗</i>`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  throat_slit: {
    name: '割喉', cls: 'assassin', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 3, bonus: 6, up: { dmg: 4, bonus: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若目标已<b>易伤</b>，额外 <b>${c.bonus}</b> 点。`,
    fx: [{ t: 'dmg', v: 'dmg', ifVulnerable: 'bonus' }],
  },
  dark_pact: {
    name: '暗影契约', cls: 'assassin', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'portal', selfdmg: 5, nrg: 3, up: { selfdmg: 3 },
    text: c => `失去 <b>${c.selfdmg}</b> 点生命，获得 <b>${c.nrg}</b> 点能量。`,
    fx: [{ t: 'loseHp', v: 'selfdmg' }, { t: 'energy', v: 'nrg' }],
  },
  chain_execution: {
    name: '连环处决', cls: 'assassin', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'sword_broad', dmg: 4, hits: 3, exec: 20, up: { dmg: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次；生命低于 <b>${c.exec}%</b> 则斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits', execute: 'exec' }],
  },
  assassins_mark: {
    name: '刺客印记', cls: 'assassin', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'grave_cross', vul: 3, draw: 1, up: { vul: 4, draw: 2 },
    text: c => `施加 <b>${c.vul}</b> 层易伤，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'draw', v: 'draw' }],
  },
  blade_flurry: {
    name: '乱刃', cls: 'assassin', type: 'attack', rarity: 'uncommon', cost: 1, target: 'all',
    art: 'axe', dmg: 5, up: { dmg: 8 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  shadow_veil: {
    // 「影纱」原来是"每回合开始获得 N 点护甲"（undying，已删除）→ 改为**敏捷**。
    // 刺客是敏捷流的指定职业之一（产品口径）。
    // 价值：敏捷 4 = 14 / 2费蓝预算 14（±0）
    name: '影纱', cls: 'assassin', type: 'power', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'portal', dex: 4, up: { dex: 5, cost: 1 },
    text: c => `获得 <b>${c.dex}</b> 点敏捷（每次获得护甲时额外 +${c.dex}）。`,
    fx: [{ t: 'buff', k: 'dexterity', v: 'dex' }],
  },
  bloodlust: {
    name: '嗜血', cls: 'assassin', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'crabdemon', str: 4, up: { str: 5 },
    text: c => `每回合开始时获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'ritual', v: 'str' }],
  },
  execute: {
    name: '处决', cls: 'assassin', type: 'attack', rarity: 'rare', cost: 2, target: 'enemy',
    art: 'sword_broad', dmg: 15, exec: 35, up: { dmg: 20, exec: 40 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。生命低于 <b>${c.exec}%</b> 则直接斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', execute: 'exec' }],
  },
  final_cut: {
    name: '终末之刃', cls: 'assassin', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'sword_long', dmg: 23, exec: 40, up: { dmg: 30, exec: 45 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。生命低于 <b>${c.exec}%</b> 则直接斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', execute: 'exec' }],
  },
  mist_form: {
    name: '雾化', cls: 'assassin', type: 'skill', rarity: 'rare', cost: 1, target: 'self',
    art: 'ghost', blk: 4, draw: 1, up: { blk: 5, draw: 2 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  deathmark: {
    name: '死亡印记', cls: 'assassin', type: 'skill', rarity: 'rare', cost: 1, target: 'enemy',
    art: 'key_purple', vul: 1, weak: 1, up: { vul: 2, weak: 2 },
    text: c => `施加 <b>${c.vul}</b> 层易伤和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },


  /* ============ 骑士 · 护盾流 ============
     构筑方向：**护盾流高容错**。核心是"把护甲堆厚 → 用护甲换伤害 → 不让护甲消失"。
     这个职业的每一张牌要么产生护甲，要么把护甲变成别的资源。 */
  stone_wall: {
    name: '石墙', cls: 'knight', type: 'skill', rarity: 'common', cost: 3, target: 'self',
    art: 'stone_platform', blk: 19, up: { blk: 25 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  vanguard: {
    name: '先锋', cls: 'knight', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_broad', dmg: 2, blk: 3, up: { dmg: 3, blk: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'block', v: 'blk' }],
  },
  bulwark_slam: {
    name: '壁垒冲撞', cls: 'knight', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 9, blk: 6, up: { dmg: 9, blk: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'block', v: 'blk' }],
  },
  last_bastion: {
    // 「最后堡垒」原来是"每回合开始获得 5 点护甲"（undying，已删除）。
    // 改成**敏捷 + 大护甲**的一次性收官牌，保留"越到后面越硬"的定位。
    // 价值：敏捷 4 = 14，护甲 12 = 12 → 26 / 3费金预算 26（±0）
    name: '最后堡垒', cls: 'knight', type: 'power', rarity: 'rare', cost: 3, target: 'self',
    art: 'portcullis', dex: 4, blk: 12, up: { blk: 16 },
    text: c => `获得 <b>${c.dex}</b> 点敏捷，以及 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'buff', k: 'dexterity', v: 'dex' }, { t: 'block', v: 'blk' }],
  },

  /* ============ 法师 · 法力增幅 ============
     构筑方向：**费用上限高、单发法术伤害高**。
     「法力增幅」是本职业独有的持久状态 —— 它提高的是**每回合能量上限**，
     所以法师的强度曲线是"先投资增幅，之后每回合都能多打一张大法术"。 */
  arcane_engine: {
    name: '烈焰引擎', cls: 'mage', type: 'power', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'arcane_orb', cap: 1, up: { cost: 1 },
    text: c => `每回合能量上限 <b>+${c.cap}</b>。`,
    fx: [{ t: 'buff', k: 'energy_cap', v: 'cap' }],
  },
  mana_font: {
    name: '熔火之心', cls: 'mage', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'key_blue', nrg: 2, up: { nrg: 3 },
    text: c => `本回合获得 <b>${c.nrg}</b> 点能量。`,
    fx: [{ t: 'energy', v: 'nrg' }],
  },
  disintegrate: {
    name: '焚世射线', cls: 'mage', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'key_purple', dmg: 12, up: { dmg: 16 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，然后引爆。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'detonate' }],
  },
  mana_burst: {
    name: '烈焰爆发', cls: 'mage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'arcane_orb', per: 4, up: { per: 5 },
    text: c => `造成等同于<b>能量上限×${c.per}</b>的伤害。`,
    fx: [{ t: 'dmgPerEnergyMax', v: 'per' }],
  },

  /* ============ 游侠 · 低费快过牌 ============
     构筑方向：**0~1 费为主 + 大量抽牌**。一回合连打五六张，
     靠"过牌速度"而不是单卡质量取胜；中毒是快速铺场之后的收尾手段。 */
  quick_thinking: {
    name: '急智', cls: 'rogue', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'key_green', draw: 1, up: { draw: 2 },
    text: c => `抽 <b>${c.draw}</b> 张牌，然后弃 <b>1</b> 张牌。`,
    fx: [{ t: 'draw', v: 'draw' }, { t: 'discard', v: 1 }],
  },
  feint: {
    name: '佯攻', cls: 'rogue', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_dagger', dmg: 1, draw: 1, up: { dmg: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'draw', v: 'draw' }],
  },
  flurry_strike: {
    // 同上：保住 1 费。原来靠"抽 1 张"补强度，现在改成带 1 层流血 ——
    // 更贴游侠的流血流，也把"多段"这件事留在了低费段。
    name: '乱影', cls: 'rogue', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'sword_dagger', dmg: 1, hits: 3, poi: 1, up: { dmg: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'debuff', k: 'bleed', v: 'poi' }],
  },
  hundred_cuts: {
    name: '百裂斩', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'sword_broad', per: 2, up: { per: 3 },
    text: c => `造成 <b>本回合已打出牌数×${c.per}</b> 的伤害。`,
    fx: [{ t: 'dmgPerPlayed', v: 'per' }],
  },
  envenom_blade: {
    // 2026-10-13：抽牌在价值表里值 5 点，0 费蓝卡（预算 6）装不下"伤害+流血+抽牌"，
    // 于是去掉抽牌、保留"低费叠流血"这个身份。文案与 fx 必须同步改 ——
    // 只删字段不删 fx 会让测试抓到"引用了不存在的字段"（这次就抓到了）。
    name: '淬血之刃', cls: 'rogue', type: 'attack', rarity: 'uncommon', cost: 0, target: 'enemy',
    art: 'potion_green', dmg: 2, poi: 2, up: { dmg: 3, poi: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层流血。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'bleed', v: 'poi' }],
  },

  /* ============ 暗影刺客 · 叠易伤叠攻击 ============
     构筑方向：**先把易伤叠厚、再把力量叠起来，最后用一发巨伤收命**。
     前几回合看着很弱（都在铺垫），铺完之后的单次攻击能直接清掉 Boss 半管血。 */
  annihilate: {
    name: '湮灭', cls: 'assassin', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'sword_broad', dmg: 28, exhaust: true, up: { dmg: 35 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。<i>消耗</i>`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  shadow_arsenal: {
    name: '暗影武库', cls: 'assassin', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'axe', str: 4, up: { str: 5 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },
  expose: {
    name: '破绽', cls: 'assassin', type: 'skill', rarity: 'common', cost: 2, target: 'enemy',
    art: 'key_red', vul: 2, draw: 1, up: { vul: 3 },
    text: c => `施加 <b>${c.vul}</b> 层易伤，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'debuff', k: 'vulnerable', v: 'vul' }, { t: 'draw', v: 'draw' }],
  },
  bleed_out: {
    name: '放血', cls: 'assassin', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_short', dmg: 1, vul: 1, up: { dmg: 2, vul: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.vul}</b> 层易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
  },


  /* ============ 火焰法师 · 基础牌 ============
     普攻改成**技能牌**：这样它才能触发「技能牌挂点燃」的职业特性。
     类型是技能、效果是造成伤害 —— 引擎不限制"技能不能打伤害"。 */
  fire_bolt: {
    name: '火焰弹', cls: 'mage', type: 'skill', rarity: 'basic', cost: 1, target: 'enemy',
    art: 'torch', dmg: 5, up: { dmg: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },

  /* ============ 寒冰法师 ============
     构筑方向：**冰霜充能 → 冻住 → 跳过它的行动**。
     冰霜不会自然衰减，集满（小怪 4 层 / 精英 7 层 / Boss 9 层）就变成 1 层冰冻。
     所以这个职业的核心不是"打多少伤害"，而是"让对面少行动几次"。
     一张牌能不能上冰霜，取决于它是不是**对敌人生效的技能牌**（职业特性决定的）。 */
  snowball: {
    name: '扔雪球', cls: 'icemage', type: 'skill', rarity: 'basic', cost: 1, target: 'enemy',
    art: 'snowball', dmg: 5, up: { dmg: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  frost_bolt: {
    // 2026-10-13：冰霜有**硬约束**（只允许出现在 ≥2 费的寒冰法师牌上，因为 1 层冰霜
    // 值 4.5 点，1 费档装不下），所以本卡由 1 费提到 2 费并把伤害补足预算。
    name: '寒冰箭', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'key_blue', dmg: 10, fro: 1, up: { dmg: 12 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.fro}</b> 层冰霜。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'frost', v: 'fro' }],
  },
  ice_wall: {
    name: '冰墙', cls: 'icemage', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'stone_platform', blk: 13, up: { blk: 17 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  chill: {
    name: '刺骨', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'ghost', fro: 2, draw: 1, up: { fro: 3 },
    text: c => `施加 <b>${c.fro}</b> 层冰霜，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'debuff', k: 'frost', v: 'fro' }, { t: 'draw', v: 'draw' }],
  },
  ice_lance: {
    name: '冰枪', cls: 'icemage', type: 'skill', rarity: 'common', cost: 2, target: 'enemy',
    art: 'sword_long', dmg: 13, up: { dmg: 16 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  snow_veil: {
    name: '雪幕', cls: 'icemage', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'door', blk: 8, draw: 1, up: { blk: 9 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'draw', v: 'draw' }],
  },
  blizzard: {
    name: '暴风雪', cls: 'icemage', type: 'skill', rarity: 'common', cost: 2, target: 'all',
    art: 'coil', dmg: 10, up: { dmg: 12 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  frostbite: {
    name: '冻伤', cls: 'icemage', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'potion_blue', weak: 1, up: { weak: 2 },
    text: c => `施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuff', k: 'weak', v: 'weak' }],
  },

  deep_freeze: {
    // 同上：冰霜只能出现在 ≥2 费（1 层 4.5 点）。本卡提到 2 费并加到 3 层 ——
    // 3 层正好是普通/精英的冰冻阈值，"深度冻结"一张牌直接冻住，符合名字的定位。
    name: '深度冻结', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'portal', fro: 3, up: { fro: 4 },
    text: c => `施加 <b>${c.fro}</b> 层冰霜。`,
    fx: [{ t: 'debuff', k: 'frost', v: 'fro' }],
  },
  hailstorm: {
    name: '冰雹', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'coil', dmg: 8, weak: 1, up: { dmg: 11 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  cold_snap: {
    // 冰霜 2 层（4.5×2×1.3=11.7）离 2 费蓝上限 15 还差一截，补 1 层全体虚弱
    //（3×1.3=3.9）刚好补齐 —— 这张牌的身份是"群体制冷"，顺手削弱是附带的。
    name: '寒潮', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'gate', fro: 2, weak: 1, up: { fro: 3, weak: 2 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.fro}</b> 层冰霜和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuffAll', k: 'frost', v: 'fro' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  shatter: {
    name: '碎冰', cls: 'icemage', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 7, bonus: 10, exec: 25, up: { dmg: 8, bonus: 13, exec: 30 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害；已<b>冰冻</b>则额外 <b>${c.bonus}</b> 点，低于 <b>${c.exec}%</b> 斩杀。`,
    fx: [{ t: 'dmg', v: 'dmg', ifFrozen: 'bonus', execute: 'exec' }],
  },
  frozen_grasp: {
    name: '冰封之握', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'coil', dmg: 10, fro: 1, up: { dmg: 14 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.fro}</b> 层冰霜。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'frost', v: 'fro' }],
  },
  ice_shell: {
    name: '冰壳', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 1, target: 'self',
    art: 'box', blk: 3, next: 3, up: { blk: 4, next: 5 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  permafrost: {
    name: '永冻', cls: 'icemage', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'key_purple', fro: 2, weak: 2, up: { fro: 3 },
    text: c => `施加 <b>${c.fro}</b> 层冰霜和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuff', k: 'frost', v: 'fro' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },

  glacier: {
    name: '冰川', cls: 'icemage', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'stone_platform', dmg: 20, up: { dmg: 25 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  absolute_zero: {
    name: '绝对零度', cls: 'icemage', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'portal', fro: 2, dmg: 12, up: { dmg: 16 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.fro}</b> 层冰霜并造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'debuffAll', k: 'frost', v: 'fro' }, { t: 'dmgAll', v: 'dmg' }],
  },
  winter: {
    name: '凛冬', cls: 'icemage', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'grave_cross', fro: 3, weak: 3, up: { fro: 4, weak: 3 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.fro}</b> 层冰霜和 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'debuffAll', k: 'frost', v: 'fro' }, { t: 'debuffAll', k: 'weak', v: 'weak' }],
  },
  ice_nova: {
    name: '冰霜新星', cls: 'icemage', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'arcane_orb', dmg: 16, fro: 1, up: { dmg: 19 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，并施加 <b>${c.fro}</b> 层冰霜。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'frost', v: 'fro' }],
  },


  /* ============ 奥术法师 ============
     构筑方向：**叠真理 → 多段连击**。
     起始遗物「真理之核」：每 1 层真理，让**本来就有多段**的攻击/技能牌多打 1 次。
     所以它的牌大多是 2~6 段的小刀，靠段数堆总量；
     和游侠不同 —— 游侠靠"多打几张牌"，奥术法师靠"一张牌多打几次"，不需要庞大过牌量。
     ⚠️ 强度约束：多段攻击会被「力量」逐段加成，所以**力量只出现在三费卡**上。 */
  arcane_bolt: {
    name: '奥术飞弹', cls: 'arcanist', type: 'skill', rarity: 'basic', cost: 1, target: 'enemy',
    art: 'arcane_orb', dmg: 2, hits: 2, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  mana_dart: {
    name: '法力飞镖', cls: 'arcanist', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'key_blue', dmg: 2, hits: 3, up: { dmg: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  seek_truth: {
    name: '求真', cls: 'arcanist', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'key_purple', tru: 1, up: { tru: 2 },
    text: c => `获得 <b>${c.tru}</b> 层真理。`,
    fx: [{ t: 'buff', k: 'truth', v: 'tru' }],
  },
  runeward: {
    name: '符文护盾', cls: 'arcanist', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'portcullis', blk: 3, next: 2, up: { blk: 4, next: 4 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  arcane_echo: {
    name: '奥术回响', cls: 'arcanist', type: 'skill', rarity: 'common', cost: 2, target: 'enemy',
    art: 'coil', dmg: 4, hits: 2, tru: 1, up: { dmg: 5, tru: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，获得 <b>${c.tru}</b> 层真理。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'buff', k: 'truth', v: 'tru' }],
  },
  rune_sight: {
    name: '符文视界', cls: 'arcanist', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'portal', draw: 3, up: { draw: 4 },
    text: c => `抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'draw', v: 'draw' }],
  },
  mystic_volley: {
    name: '秘法齐射', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'worm', dmg: 5, hits: 3, up: { dmg: 6, hits: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  insight: {
    name: '洞察', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'key_purple', tru: 3, up: { tru: 4 },
    text: c => `获得 <b>${c.tru}</b> 层真理。`,
    fx: [{ t: 'buff', k: 'truth', v: 'tru' }],
  },
  runic_aegis: {
    name: '符文壁垒', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'stone_platform', blk: 10, next: 3, up: { blk: 12, next: 4 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  arcane_analysis: {
    name: '奥术解析', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'apprentice', dmg: 5, hits: 2, draw: 1, up: { dmg: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'draw', v: 'draw' }],
  },
  truth_lance: {
    name: '真理之枪', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'key_purple', dmg: 3, hits: 3, tru: 1, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，获得 <b>${c.tru}</b> 层真理。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'buff', k: 'truth', v: 'tru' }],
  },
  echoing_blow: {
    name: '回响打击', cls: 'arcanist', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 5, hits: 3, up: { dmg: 6 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  cascading_runes: {
    name: '符文倾泻', cls: 'arcanist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'coil', dmg: 5, hits: 2, up: { dmg: 7 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmgAll', v: 'dmg', hits: 'hits' }],
  },
  axiom: {
    name: '公理', cls: 'arcanist', type: 'skill', rarity: 'rare', cost: 2, target: 'enemy',
    art: 'key_bone', dmg: 4, hits: 4, up: { dmg: 5 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  final_theorem: {
    name: '终焉定理', cls: 'arcanist', type: 'skill', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'key_bone', dmg: 5, hits: 6, up: { dmg: 6 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },
  grand_unity: {
    name: '万物归一', cls: 'arcanist', type: 'skill', rarity: 'rare', cost: 3, target: 'self',
    art: 'portal', tru: 2, blk: 18, up: { tru: 3, blk: 24 },
    text: c => `获得 <b>${c.tru}</b> 层真理和 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'buff', k: 'truth', v: 'tru' }, { t: 'block', v: 'blk' }],
  },
  singularity: {
    name: '奥术奇点', cls: 'arcanist', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'arcane_orb', dmg: 3, hits: 5, str: 2, up: { dmg: 4 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'buff', k: 'strength', v: 'str' }],
  },
  infinite_recursion: {
    name: '无限递归', cls: 'arcanist', type: 'skill', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'coil', dmg: 6, hits: 4, tru: 1, up: { dmg: 7 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次，获得 <b>${c.tru}</b> 层真理。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }, { t: 'buff', k: 'truth', v: 'tru' }],
  },
  rune_tempest: {
    name: '符文风暴', cls: 'arcanist', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'ghost', dmg: 7, hits: 3, up: { dmg: 9 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害 <b>${c.hits}</b> 次。`,
    fx: [{ t: 'dmgAll', v: 'dmg', hits: 'hits' }],
  },


  /* ============ 炼金师 ============
     构筑方向：**用药剂发育经济，用毒素磨死对手**（产品设定）。
     起始遗物「炼金口袋」：药水槽 +2，战斗中每用过 1 瓶药水、战斗结束额外 +20 金币。
     所以它的牌除了施毒，还有一批"把毒素换成钱"的经济牌。
     ⚠️ 中毒是行动**前**结算、每跳 -2 层；流血是行动**后**结算、每跳减半。
     炼金师用的是**中毒**（和游侠的流血区分开）。 */
  venom_vial: {
    name: '毒瓶', cls: 'alchemist', type: 'skill', rarity: 'basic', cost: 1, target: 'enemy',
    art: 'potion_green', dmg: 3, poi: 1, up: { dmg: 5, poi: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'poison', v: 'poi' }],
  },
  acid_flask: {
    name: '酸液瓶', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', dmg: 13, poi: 1, up: { dmg: 16, poi: 2 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'poison', v: 'poi' }],
  },
  fume_ward: {
    name: '烟气之盾', cls: 'alchemist', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'potion_empty', blk: 3, next: 2, up: { blk: 4, next: 4 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  toxic_draught: {
    name: '剧毒药剂', cls: 'alchemist', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'potion_green', poi: 3, up: { poi: 4 },
    text: c => `施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuff', k: 'poison', v: 'poi' }],
  },
  catalyst: {
    name: '催化剂', cls: 'alchemist', type: 'skill', rarity: 'common', cost: 2, target: 'enemy',
    art: 'coil', poi: 5, draw: 1, up: { poi: 7, draw: 2 },
    text: c => `施加 <b>${c.poi}</b> 层中毒，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'debuff', k: 'poison', v: 'poi' }, { t: 'draw', v: 'draw' }],
  },
  quicklime: {
    name: '生石灰', cls: 'alchemist', type: 'skill', rarity: 'common', cost: 1, target: 'enemy',
    art: 'potion_empty', dmg: 5, up: { dmg: 8 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  coin_flip: {
    name: '点石成金', cls: 'alchemist', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'key_gold', gain: 10, up: { gain: 16 },
    text: c => `获得 <b>${c.gain}</b> 金币。`,
    fx: [{ t: 'gold', v: 'gain' }],
  },
  corrosive_gas: {
    name: '腐蚀瓦斯', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'ghost', poi: 7, up: { poi: 9 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuffAll', k: 'poison', v: 'poi' }],
  },
  concentrate: {
    name: '浓缩', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 1, target: 'enemy',
    art: 'potion_green', dmg: 4, poi: 1, up: { dmg: 6 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'poison', v: 'poi' }],
  },
  plague_flask: {
    name: '瘟疫之瓶', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_green', poi: 9, up: { poi: 11 },
    text: c => `施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuff', k: 'poison', v: 'poi' }],
  },
  acid_rain: {
    name: '酸雨', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'potion_blue', dmg: 10, poi: 1, up: { dmg: 13 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'debuffAll', k: 'poison', v: 'poi' }],
  },
  bubbling_shield: {
    name: '沸腾护盾', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'potion_red', blk: 10, next: 3, up: { blk: 12, next: 4 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  mercury: {
    name: '水银', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'potion_empty', dmg: 12, weak: 1, up: { dmg: 14 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，施加 <b>${c.weak}</b> 层虚弱。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'weak', v: 'weak' }],
  },
  transmute: {
    name: '转化', cls: 'alchemist', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'key_gold', gain: 20, draw: 1, up: { gain: 30 },
    text: c => `获得 <b>${c.gain}</b> 金币，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'gold', v: 'gain' }, { t: 'draw', v: 'draw' }],
  },
  virulent_toxin: {
    name: '剧毒之息', cls: 'alchemist', type: 'skill', rarity: 'rare', cost: 3, target: 'all',
    art: 'ghost', poi: 14, up: { poi: 17 },
    text: c => `对<b>所有</b>敌人施加 <b>${c.poi}</b> 层中毒。`,
    fx: [{ t: 'debuffAll', k: 'poison', v: 'poi' }],
  },
  philosophers_stone: {
    name: '贤者之石', cls: 'alchemist', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'key_gold', pp: 4, up: { pp: 5 },
    text: c => `每当你施加中毒时，额外施加 <b>${c.pp}</b> 层。`,
    fx: [{ t: 'buff', k: 'poison_plus', v: 'pp' }],
  },
  pestilence: {
    name: '瘟疫', cls: 'alchemist', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'worm', mult: 2, up: { mult: 3 },
    text: c => `造成 <b>中毒层数 × ${c.mult}</b> 的伤害。`,
    fx: [{ t: 'dmgPoison', mult: 'mult' }],
  },
  elixir: {
    name: '万灵药', cls: 'alchemist', type: 'skill', rarity: 'rare', cost: 2, target: 'self',
    art: 'potion_red', heal: 8, blk: 9, up: { heal: 9, blk: 14 },
    text: c => `回复 <b>${c.heal}</b> 点生命，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'heal', v: 'heal' }, { t: 'block', v: 'blk' }],
  },
  gold_synthesis: {
    name: '炼金术', cls: 'alchemist', type: 'skill', rarity: 'rare', cost: 2, target: 'self',
    art: 'key_gold', gain: 34, up: { gain: 46 },
    text: c => `获得 <b>${c.gain}</b> 金币。`,
    fx: [{ t: 'gold', v: 'gain' }],
  },


  /* ============ 圣骑士 ============
     构筑方向：**不靠护盾的纯血牛**（产品设定）—— 血厚 + 回血硬吃伤害。
     所以它的防御牌刻意少（起始卡组只带 3 张防御），主力是"打了就回血"和"直接奶"。
     起始遗物「圣誓」：单次造成 >7 点伤害就回 1 血 —— 鼓励打**大单发**而不是小碎刀。 */
  smite: {
    name: '制裁', cls: 'paladin', type: 'attack', rarity: 'basic', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 12, up: { dmg: 16 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmg', v: 'dmg' }],
  },
  hammer_of_light: {
    name: '圣光锤', cls: 'paladin', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'hammer', dmg: 3, heal: 2, up: { dmg: 5, heal: 3 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  lay_on_hands: {
    name: '圣手', cls: 'paladin', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'key_gold', heal: 5, up: { heal: 8 },
    text: c => `回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  consecrate: {
    name: '圣化', cls: 'paladin', type: 'attack', rarity: 'common', cost: 1, target: 'all',
    art: 'portal', dmg: 4, up: { dmg: 6 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  divine_favor: {
    name: '神恩', cls: 'paladin', type: 'skill', rarity: 'common', cost: 2, target: 'self',
    art: 'key_gold', heal: 8, draw: 1, up: { heal: 9 },
    text: c => `回复 <b>${c.heal}</b> 点生命，抽 <b>${c.draw}</b> 张牌。`,
    fx: [{ t: 'heal', v: 'heal' }, { t: 'draw', v: 'draw' }],
  },
  zeal: {
    name: '热忱', cls: 'paladin', type: 'attack', rarity: 'common', cost: 1, target: 'enemy',
    art: 'torch', dmg: 7, selfdmg: 2, up: { dmg: 10 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，你失去 <b>${c.selfdmg}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'loseHp', v: 'selfdmg' }],
  },
  holy_shield: {
    name: '圣盾', cls: 'paladin', type: 'skill', rarity: 'common', cost: 1, target: 'self',
    art: 'portcullis', blk: 3, heal: 2, up: { blk: 4, heal: 4 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'heal', v: 'heal' }],
  },
  judgement: {
    // 2026-10-13 削弱：伤害 11 → **9**（产品："圣骑士蓝卡金卡略显超模"）。
    // 保持"伤害 + 回复"的身份不变，只把伤害压下来 —— 他的强是强在**续航叠加**，
    // 所以砍伤害比砍回复更对症。
    name: '审判', cls: 'paladin', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'hammer', dmg: 9, heal: 4, up: { dmg: 11, heal: 6 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  greater_heal: {
    name: '高等治疗', cls: 'paladin', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'key_gold', heal: 15, up: { heal: 18 },
    text: c => `回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  martyr: {
    // 2026-10-13 两处修 + 一处削弱：
    //  ① **`ifLowHp` 以前引擎从没读过** —— 卡面写着"生命低于一半改为双倍"，
    //     实际永远只打基础伤害（卡面撒谎）。现在引擎真的会读（见 battle.js）。
    //  ② 删掉遗留字段 `selfdmg: 5`：它既不在 fx 里、文案也没提，是重构剩下的死数据
    //     （我一开始就是被它误导，以为这张牌有自伤代价）。
    //  ③ 伤害 15 → **9**：现在"残血双倍"真的生效了（9 → 18），
    //     但**平常**明显弱于原来的 15 —— 总体是削弱，符合"蓝卡略显超模"。
    //     价值 = 9 + 0.6×9 = 14.4 / 15 ✅
    name: '殉道', cls: 'paladin', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'sword_broad', dmg: 9, up: { dmg: 12 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害。若你生命低于一半，改为造成 <b>双倍</b>。`,
    fx: [{ t: 'dmg', v: 'dmg', ifLowHp: 'dmg' }],
  },
  retribution: {
    name: '报应', cls: 'paladin', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'bars', blk: 12, thn: 1, up: { blk: 16, thn: 2 },
    text: c => `获得 <b>${c.blk}</b> 点护甲和 <b>${c.thn}</b> 层荆棘。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'thorns', v: 'thn' }],
  },
  divine_smite: {
    // 2026-10-13 削弱：伤害 12 → **10**（同「审判」，砍伤害保留回复）
    name: '神圣制裁', cls: 'paladin', type: 'attack', rarity: 'uncommon', cost: 2, target: 'enemy',
    art: 'torch', dmg: 10, heal: 3, up: { dmg: 12 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  consecrated_ground: {
    name: '圣土', cls: 'paladin', type: 'skill', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'stone_platform', blk: 9, next: 4, up: { blk: 12, next: 6 },
    text: c => `获得 <b>${c.blk}</b> 点护甲，下回合额外 <b>${c.next}</b> 点。`,
    fx: [{ t: 'block', v: 'blk' }, { t: 'buff', k: 'block_next', v: 'next' }],
  },
  sacred_flame: {
    // 2026-10-13 削弱：全体伤害 11 → **10**（2 费蓝的群体档，原来是全场最高）
    name: '圣焰', cls: 'paladin', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'portal', dmg: 10, up: { dmg: 13 },
    text: c => `对<b>所有</b>敌人造成 <b>${c.dmg}</b> 点伤害。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }],
  },
  resurrection: {
    name: '复活', cls: 'paladin', type: 'skill', rarity: 'rare', cost: 2, target: 'self',
    art: 'key_gold', heal: 18, up: { heal: 23 },
    text: c => `回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  divine_intervention: {
    name: '神圣干预', cls: 'paladin', type: 'skill', rarity: 'rare', cost: 3, target: 'self',
    art: 'portal', heal: 10, blk: 18, up: { heal: 13, blk: 25 },
    text: c => `回复 <b>${c.heal}</b> 点生命，获得 <b>${c.blk}</b> 点护甲。`,
    fx: [{ t: 'heal', v: 'heal' }, { t: 'block', v: 'blk' }],
  },
  holy_avenger: {
    // 2026-10-13 削弱：伤害 20 → **18**（3 费金，打击 + 回复的组合股）
    name: '神圣复仇者', cls: 'paladin', type: 'attack', rarity: 'rare', cost: 3, target: 'enemy',
    art: 'sword_broad', dmg: 18, heal: 6, up: { dmg: 23, heal: 9 },
    text: c => `造成 <b>${c.dmg}</b> 点伤害，回复 <b>${c.heal}</b> 点生命。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'heal', v: 'heal' }],
  },
  eternal_light: {
    name: '永恒圣光', cls: 'paladin', type: 'power', rarity: 'rare', cost: 2, target: 'self',
    art: 'torch', hl: 5, up: { hl: 7 },
    text: c => `回合结束时回复 <b>${c.hl}</b> 点生命（然后 -1 层）。`,
    fx: [{ t: 'buff', k: 'regen', v: 'hl' }],
  },
  battle_hymn: {
    name: '战歌', cls: 'paladin', type: 'power', rarity: 'uncommon', cost: 2, target: 'self',
    art: 'key_gold', str: 4, up: { str: 5 },
    text: c => `获得 <b>${c.str}</b> 层力量。`,
    fx: [{ t: 'buff', k: 'strength', v: 'str' }],
  },

  /* ============ 中性 ============ */
  bandage: {
    name: '绷带', cls: 'neutral', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'potion_empty', heal: 6, exhaust: true, up: { heal: 8 },
    text: c => `回复 <b>${c.heal}</b> 点生命。<i>消耗</i>`,
    fx: [{ t: 'heal', v: 'heal' }],
  },
  quick_slash: {
    name: '快速斩击', cls: 'neutral', type: 'attack', rarity: 'common', cost: 0, target: 'enemy',
    art: 'sword_short', dmg: 5, up: { dmg: 5 },
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
    art: 'anvil', blk: 8, exhaust: true, up: { blk: 11 },
    text: c => `获得 <b>${c.blk}</b> 点护甲。<i>消耗</i>`,
    fx: [{ t: 'block', v: 'blk' }],
  },
  good_instincts: {
    name: '直觉', cls: 'neutral', type: 'skill', rarity: 'common', cost: 0, target: 'self',
    art: 'coil', draw: 1, exhaust: true, up: { draw: 2 },
    text: c => `抽 <b>${c.draw}</b> 张牌。<i>消耗</i>`,
    fx: [{ t: 'draw', v: 'draw' }],
  },
  war_stomp: {
    name: '战踏', cls: 'neutral', type: 'attack', rarity: 'uncommon', cost: 2, target: 'all',
    art: 'boss_stone', dmg: 11, up: { dmg: 16 },
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
    name: '点燃', cls: 'status', type: 'status', rarity: 'special', cost: -1, target: 'none',
    art: 'torch', unplayable: true, endDmg: 2,
    text: c => `<i>不能被打出。</i>回合结束时受到 <b>${c.endDmg}</b> 点伤害。`,
    fx: [],
  },

  /* ============================================================================
   * 终结牌（Finisher）
   * ----------------------------------------------------------------------------
   * 每个职业至少一张。共同点：
   *   · `costN: true` —— 费用是 **N**：吃掉你**当前全部能量**。
   *     它贵的不是 3 点能量，而是"这一回合你别的什么都打不了"。
   *   · `finisher: true` —— 卡框走彩色流光（CSS `.card.r-finisher`），
   *     `rarity: 'finisher'` 给它自己的稀有度档。
   *   · `cond: B => …` —— **条件门**：没满足就打不出去（界面会置灰并说明原因）。
   *   · `targetFilter`（可选）—— 只允许打在某类目标上（例：只能打**冻结**目标）。
   *   · `unique: true` —— 牌组里有一张就**不会再给第二张**（见 rewardPool/rollCardChoices）。
   *   · 参考价值 **40**（见 values.js 的 FINISHER_VALUE）—— 不走普通费用档的预算。
   *
   * 设计意图：它们不是"更强的普通牌"，而是**给一套铺垫一个交代**。
   * 每张都要求你先做成某件事（叠够点燃/流血/中毒、冻住它、攒够护甲…），
   * 然后一次性把铺垫全部兑现。所以它们只在"构筑成型"之后才有意义。
   * ========================================================================== */

  /** 铁誓骑士 —— 先挨打攒甲，再一次性把甲变成全体重击 */
  finisher_bulwark: {
    name: '誓约·破城', cls: 'knight', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'all',
    art: 'portcullis', dmg: 25, blk: 8,
    cond: B => B.player.block >= 15,
text: c => `<i>需护甲 ≥15</i><br>全体 <b>${c.dmg}</b> 伤，获得 <b>${c.blk}</b> 护甲。`,
    fx: [{ t: 'dmgAll', v: 'dmg' }, { t: 'block', v: 'blk' }],
  },

  /** 火焰法师 —— 点燃烧够之后，引爆全部点燃 */
  finisher_pyre: {
    name: '焚世之终', cls: 'mage', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    // 价值：伤害 20 + 全体点燃 6 层（2.5×6×1.3=19.5）= 39.5 ≈ 40。
    // 引爆是**额外**的（模型不计），所以实际收益比表面更高 —— 这正是终结牌该有的样子。
    art: 'icon_burn', dmg: 20, mult: 2, poi: 6,
    cond: B => B.aliveEnemies().some(e => B.get(e, 'burn') >= 5),
text: c => `<i>需点燃 ≥5</i><br><b>${c.dmg}</b> 伤，引爆其点燃 ×${c.mult}，全体 +<b>${c.poi}</b> 点燃。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'detonate', mult: 'mult' }, { t: 'debuffAll', k: 'burn', v: 'poi' }],
  },

  /** 暗巷游侠 —— 放够血之后，把流血一次性榨干 */
  finisher_exsanguinate: {
    name: '血尽', cls: 'rogue', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    // 价值：伤害 15 + 全体流血 4 层（2.5×4×1.3=13）+ dmgBleed 12 = 40（正好参考值）。
    // dmgBleed 是"按流血层数追加伤害"，属模型不计的额外收益，所以实际更强一点。
    art: 'spider', dmg: 15, mult: 3, poi: 4,
    cond: B => B.aliveEnemies().some(e => B.get(e, 'bleed') >= 8),
text: c => `<i>需流血 ≥8</i><br><b>${c.dmg}</b> 伤 +（流血×<b>${c.mult}</b>），全体 +<b>${c.poi}</b> 流血。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'dmgBleed', mult: 'mult' }, { t: 'debuffAll', k: 'bleed', v: 'poi' }],
  },

  /** 寒冰法师 —— 冻住它，然后一击碎冰（产品给的例子） */
  finisher_shatterfrost: {
    name: '碎冰绝响', cls: 'icemage', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    art: 'icon_freeze', dmg: 25, fro: 2,
    // 只能打**处于冰冻**的敌人 —— 这就是产品给的那个例子。
    targetFilter: (e, B) => B.get(e, 'freeze') > 0,
    cond: B => B.aliveEnemies().some(e => B.get(e, 'freeze') > 0),
text: c => `<i>需冰冻中</i><br><b>${c.dmg}</b> 伤，+<b>${c.fro}</b> 冰霜。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'frost', v: 'fro' }],
  },

  /** 奥术法师 —— 真理叠够，一次连击收尾 */
  finisher_finaltheorem: {
    name: '终极定理', cls: 'arcanist', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    // 2026-10-13 产品改动：条件从 3 层真理提到 **7 层**（原来太容易满足，
    // 奥术师堆到 3 层真理几乎是顺手的事），同时**增加一段**伤害段数（5 → 6 段）。
    // 价值 8 × 6 = 48，所以显式写下 `finisherTarget: 48` ——
    // 条件苛刻了 4 层（≈20 点真理投入）换来更高的爆发，这个目标值是产品要的，
    // 而不是我偷偷放宽整类终结牌的判定（见 values.js 的注释）。
    // 注意真理还会让段数继续增加：7 层真理下实际是 6+7 = 13 段。
    art: 'arcane_orb', dmg: 8, hits: 6, finisherTarget: 48,
    cond: B => B.get(B.player, 'truth') >= 7,
    text: c => `<i>需真理 ≥7</i><br><b>${c.dmg}</b> 伤 ×<b>${c.hits}</b>。`,
    fx: [{ t: 'dmg', v: 'dmg', hits: 'hits' }],
  },

  /** 炼金师 —— 毒够厚，一次性归宗 */
  finisher_plagueend: {
    name: '万毒归宗', cls: 'alchemist', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    // 价值：伤害 15 + 全体中毒 4 层（13）+ dmgPoison 12 = 40（正好参考值）
    art: 'potion_green', dmg: 15, mult: 5, poi: 6,
    cond: B => B.aliveEnemies().some(e => B.get(e, 'poison') >= 8),
text: c => `<i>需中毒 ≥8</i><br><b>${c.dmg}</b> 伤 +（中毒×<b>${c.mult}</b>），全体 +<b>${c.poi}</b> 中毒。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'dmgPoison', mult: 'mult' }, { t: 'debuffAll', k: 'poison', v: 'poi' }],
  },

  /** 圣骑士 —— 残血时的圣裁：一口气奶回来再砸一波 */
  finisher_judgment: {
    name: '最终圣裁', cls: 'paladin', type: 'skill', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'self',
    art: 'anvil', heal: 25, dmg: 12,
    cond: B => B.player.hp <= B.player.maxHp / 2,
text: c => `<i>需生命 <50%</i><br>回复 <b>${c.heal}</b>，全体 <b>${c.dmg}</b> 伤。`,
    fx: [{ t: 'heal', v: 'heal' }, { t: 'dmgAll', v: 'dmg' }],
  },

  /** 暗影刺客 —— 易伤叠满，一刀定胜负 */
  finisher_annihilate: {
    name: '湮灭之刻', cls: 'assassin', type: 'attack', rarity: 'finisher', cost: 3, costN: true,
    finisher: true, unique: true, target: 'enemy',
    art: 'sword_broad', dmg: 30, vul: 3,
    cond: B => B.aliveEnemies().some(e => B.get(e, 'vulnerable') >= 5),
text: c => `<i>需易伤 ≥5</i><br><b>${c.dmg}</b> 伤，+<b>${c.vul}</b> 易伤。`,
    fx: [{ t: 'dmg', v: 'dmg' }, { t: 'debuff', k: 'vulnerable', v: 'vul' }],
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
  // 终结牌：自己一档。卡框走 CSS 的流光动画（.card.r-finisher），不用 PNG 边框，
  // 因为"彩色"要的是**会动**的效果，静态贴图做不到。
  finisher: { label: '终结', frame: 'finisher', color: '#ff79e1' },
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

/** 终结牌（费用 N、条件门、牌组唯一） */
export const isFinisher = c => !!(c && c.finisher);
/** 牌组里是否已经有这张终结牌的同名卡（用于 `unique` 判定） */
export function deckHasCard(deck, id) {
  return (deck || []).some(d => (d && d.id === id));
}

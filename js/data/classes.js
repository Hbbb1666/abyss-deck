/** 可玩职业 */
export const CLASSES = {
  knight: {
    id: 'knight', name: '铁誓骑士', sprite: 'hero_knight',
    unlockScore: 0, hp: 64, gold: 99, relic: 'burning_blood',
    tagline: '护盾流 · 高容错',
    desc: '把护甲堆到敌人打不穿。用护甲换伤害，每一回合都给自己留足余地。',
    deck: [['strike', 5], ['defend', 4], ['heavy_blow', 1]],
  },
  mage: {
    id: 'mage', name: '火焰法师', sprite: 'hero_mage',
    unlockScore: 9, hp: 53, gold: 99, relic: 'mana_crystal',
    tagline: '烈焰法术 · 能量饱和',
    desc: '掌控烈焰的施法者。先点燃「能量饱和」抬高每回合能量上限，之后每一发都烧得更旺。',
    deck: [['fire_bolt', 4], ['defend', 4], ['fireball', 1], ['ice_shard', 1]],
  },
  rogue: {
    id: 'rogue', name: '暗巷游侠', sprite: 'hero_rogue',
    unlockScore: 9, hp: 59, gold: 99, relic: 'venom_fang',
    tagline: '低费 · 快速过牌',
    desc: '手牌几乎都是 0~1 费。一回合连打五六张，靠过牌速度把牌库翻个底朝天。',
    deck: [['strike', 5], ['defend', 4], ['poison_blade', 1]],
  },
  icemage: {
    id: 'icemage', name: '寒冰法师', sprite: 'hero_icemage',
    unlockScore: 27, hp: 55, gold: 99, relic: 'frost_core',
    tagline: '冰霜 · 冻结控场',
    desc: '不打爆发，打的是让敌人「这一回合别动」。冰霜叠满就冻住它，Boss 需要叠得更厚。',
    deck: [['snowball', 4], ['defend', 4], ['frost_bolt', 1], ['ice_wall', 1]],
  },
  arcanist: {
    id: 'arcanist', name: '奥术法师', sprite: 'hero_arcanist',
    unlockScore: 36, hp: 54, gold: 99, relic: 'truth_core',
    tagline: '真理 · 多段连击',
    desc: '叠「真理」层数，让每一段攻击都多打一次。不靠过牌，靠一击连成一串。',
    deck: [['arcane_bolt', 4], ['defend', 4], ['mana_dart', 1], ['runeward', 1]],
  },
  alchemist: {
    id: 'alchemist', name: '炼金师', sprite: 'hero_alchemist',
    unlockScore: 18, hp: 60, gold: 150, relic: 'alchemy_pouch',
    tagline: '药剂 · 毒伤发育',
    desc: '靠药剂攒家底，靠毒素磨死对手。药水槽比别人多两个，用掉的药水还能换钱。',
    deck: [['venom_vial', 4], ['defend', 4], ['toxic_draught', 1], ['fume_ward', 1]],
  },
  paladin: {
    id: 'paladin', name: '圣骑士', sprite: 'hero_paladin',
    unlockScore: 9, hp: 73, gold: 99, relic: 'holy_oath',
    tagline: '血牛 · 回复续航',
    desc: '不靠护盾，靠血厚和回血硬吃伤害。每次重击都顺手回一点，越打越稳。',
    deck: [['smite', 4], ['defend', 3], ['lay_on_hands', 1], ['consecrate', 1]],
  },
  assassin: {
    id: 'assassin', name: '暗影刺客', sprite: 'hero_assassin',
    unlockScore: 36, hp: 56, gold: 99, relic: 'shadow_mark',
    tagline: '叠易伤 · 一击必杀',
    desc: '前几回合都在铺垫：把易伤叠厚、力量叠高。铺完之后，一次攻击就能决定胜负。',
    deck: [['strike', 4], ['defend', 4], ['shadow_stab', 2]],
  },
};
export const CLASS_LIST = Object.values(CLASSES);

/** 职业立绘名。以前这段映射在 scene-battle.js 和 scene-map.js 里各抄了一份，
    加职业时必然漏掉一处、而且静默回退成骑士 —— 统一放在这里。
    刻意接收 clsId 而不是自己去读 G：data 层不该反向依赖 core/state。 */
export function classSprite(clsId) {
  return (CLASSES[clsId] || CLASSES.knight).sprite;
}

/** 职业中文名（战报里用）。同样别再各处硬编码那份 {knight:'铁誓骑士',…}。 */
export function className(clsId) {
  return (CLASSES[clsId] || CLASSES.knight).name;
}

/** 展开起始卡组为卡 id 数组 */
export function startingDeck(clsId) {
  const out = [];
  for (const [id, n] of CLASSES[clsId].deck) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

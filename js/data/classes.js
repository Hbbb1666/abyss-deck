/** 可玩职业 */
export const CLASSES = {
  knight: {
    id: 'knight', name: '铁誓骑士', sprite: 'hero_knight',
    hp: 67, gold: 99, relic: 'burning_blood',
    tagline: '护盾流 · 高容错',
    desc: '把护甲堆到敌人打不穿。用护甲换伤害，每一回合都给自己留足余地。',
    deck: [['strike', 5], ['defend', 4], ['heavy_blow', 1]],
  },
  mage: {
    id: 'mage', name: '火焰法师', sprite: 'hero_mage',
    hp: 53, gold: 99, relic: 'mana_crystal',
    tagline: '烈焰法术 · 法力增幅',
    desc: '掌控烈焰的施法者。先点燃「法力增幅」抬高每回合能量上限，之后每一发都烧得更旺。',
    deck: [['fire_bolt', 4], ['defend', 4], ['fireball', 1], ['ice_shard', 1]],
  },
  rogue: {
    id: 'rogue', name: '暗巷游侠', sprite: 'hero_rogue',
    hp: 59, gold: 99, relic: 'venom_fang',
    tagline: '低费 · 快速过牌',
    desc: '手牌几乎都是 0~1 费。一回合连打五六张，靠过牌速度把牌库翻个底朝天。',
    deck: [['strike', 5], ['defend', 4], ['poison_blade', 1]],
  },
  icemage: {
    id: 'icemage', name: '寒冰法师', sprite: 'hero_icemage',
    hp: 55, gold: 99, relic: 'frost_core',
    tagline: '冰霜 · 冻结控场',
    desc: '不打爆发，打的是让敌人「这一回合别动」。冰霜叠满就冻住它，Boss 需要叠得更厚。',
    deck: [['snowball', 4], ['defend', 4], ['frost_bolt', 1], ['ice_wall', 1]],
  },
  assassin: {
    id: 'assassin', name: '暗影刺客', sprite: 'hero_assassin',
    hp: 56, gold: 99, relic: 'shadow_mark',
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

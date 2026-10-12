/** 可玩职业 */
export const CLASSES = {
  knight: {
    id: 'knight', name: '铁誓骑士', sprite: 'hero_knight',
    hp: 82, gold: 99, relic: 'burning_blood',
    tagline: '力量与护甲',
    desc: '厚甲重剑的正面硬汉。用护甲扛住伤害，把敌人的攻击反弹回去。',
    deck: [['strike', 5], ['defend', 4], ['heavy_blow', 1]],
  },
  mage: {
    id: 'mage', name: '流亡法师', sprite: 'hero_mage',
    hp: 68, gold: 99, relic: 'mana_crystal',
    tagline: '元素与法术',
    desc: '掌控火焰与寒冰。群体法术清场，增益叠满后一发陨石定胜负。',
    deck: [['strike', 4], ['defend', 4], ['fireball', 1], ['ice_shard', 1]],
  },
  rogue: {
    id: 'rogue', name: '暗巷游侠', sprite: 'hero_rogue',
    hp: 74, gold: 99, relic: 'venom_fang',
    tagline: '中毒与连击',
    desc: '匕首上淬着毒。用低费连击快速过牌，让敌人在剧毒中慢慢死去。',
    deck: [['strike', 5], ['defend', 4], ['poison_blade', 1]],
  },
};
export const CLASS_LIST = Object.values(CLASSES);

/** 展开起始卡组为卡 id 数组 */
export function startingDeck(clsId) {
  const out = [];
  for (const [id, n] of CLASSES[clsId].deck) for (let i = 0; i < n; i++) out.push(id);
  return out;
}

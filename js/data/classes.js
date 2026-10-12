/** 可玩职业 */
export const CLASSES = {
  knight: {
    id: 'knight', name: '铁誓骑士', sprite: 'hero_knight',
    hp: 67, gold: 99, relic: 'burning_blood',
    tagline: '力量与护甲',
    desc: '厚甲重剑的正面硬汉。用护甲扛住伤害，把敌人的攻击反弹回去。',
    deck: [['strike', 5], ['defend', 4], ['heavy_blow', 1]],
  },
  mage: {
    id: 'mage', name: '流亡法师', sprite: 'hero_mage',
    hp: 53, gold: 99, relic: 'mana_crystal',
    tagline: '元素与法术',
    desc: '掌控火焰与寒冰。群体法术清场，增益叠满后一发陨石定胜负。',
    deck: [['strike', 4], ['defend', 4], ['fireball', 1], ['ice_shard', 1]],
  },
  rogue: {
    id: 'rogue', name: '暗巷游侠', sprite: 'hero_rogue',
    hp: 59, gold: 99, relic: 'venom_fang',
    tagline: '中毒与连击',
    desc: '匕首上淬着毒。用低费连击快速过牌，让敌人在剧毒中慢慢死去。',
    deck: [['strike', 5], ['defend', 4], ['poison_blade', 1]],
  },
  assassin: {
    id: 'assassin', name: '暗影刺客', sprite: 'hero_assassin',
    hp: 56, gold: 99, relic: 'shadow_mark',
    tagline: '易伤与斩杀',
    desc: '从暗影里递刀的人。先把易伤铺满，再用廉价多段把伤害放大，最后一击处决。',
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

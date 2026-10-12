/**
 * 药水数据 —— 使用与卡牌相同的效果 DSL
 * target: self / enemy / all / none
 */
export const POTIONS = {
  heal: {
    name: '治疗药水', sprite: 'potion_red', price: 50, target: 'self',
    text: '回复 <b>22</b> 点生命。', fx: [{ t: 'heal', v: 22 }],
  },
  strength: {
    name: '力量药水', sprite: 'potion_red', price: 60, target: 'self',
    text: '获得 <b>2</b> 层力量。', fx: [{ t: 'buff', k: 'strength', v: 2 }],
  },
  dexterity: {
    name: '敏捷药水', sprite: 'potion_green', price: 60, target: 'self',
    text: '获得 <b>2</b> 层敏捷。', fx: [{ t: 'buff', k: 'dexterity', v: 2 }],
  },
  block: {
    name: '护甲药水', sprite: 'potion_blue', price: 45, target: 'self',
    text: '获得 <b>14</b> 点护甲。', fx: [{ t: 'block', v: 14 }],
  },
  energy: {
    name: '能量药水', sprite: 'potion_blue', price: 70, target: 'self',
    text: '获得 <b>2</b> 点能量。', fx: [{ t: 'energy', v: 2 }],
  },
  draw: {
    name: '洞察药水', sprite: 'potion_green', price: 50, target: 'self',
    text: '抽 <b>3</b> 张牌。', fx: [{ t: 'draw', v: 3 }],
  },
  fire: {
    name: '火焰药水', sprite: 'potion_red', price: 55, target: 'all',
    text: '对所有敌人造成 <b>12</b> 点伤害。', fx: [{ t: 'dmgAll', v: 12 }],
  },
  poison: {
    name: '剧毒药水', sprite: 'potion_green', price: 55, target: 'all',
    text: '对所有敌人施加 <b>6</b> 层中毒。', fx: [{ t: 'debuffAll', k: 'poison', v: 6 }],
  },
  weak: {
    name: '虚弱药水', sprite: 'potion_blue', price: 50, target: 'all',
    text: '对所有敌人施加 <b>3</b> 层虚弱。', fx: [{ t: 'debuffAll', k: 'weak', v: 3 }],
  },
  fear: {
    name: '恐惧药水', sprite: 'potion_empty', price: 50, target: 'all',
    text: '对所有敌人施加 <b>3</b> 层易伤。', fx: [{ t: 'debuffAll', k: 'vulnerable', v: 3 }],
  },
  blood: {
    name: '血之药水', sprite: 'potion_red', price: 65, target: 'self',
    text: '失去 <b>5</b> 点生命，抽 <b>2</b> 张牌并获得 <b>1</b> 点能量。',
    fx: [{ t: 'loseHp', v: 5 }, { t: 'draw', v: 2 }, { t: 'energy', v: 1 }],
  },
  smoke: {
    name: '烟雾药水', sprite: 'potion_empty', price: 40, target: 'self',
    text: '获得 <b>3</b> 层荆棘。', fx: [{ t: 'buff', k: 'thorns', v: 3 }],
  },
};
for (const [id, p] of Object.entries(POTIONS)) p.id = id;

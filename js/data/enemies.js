/**
 * 敌人数据
 * ---------------------------------------------------------------
 * moves: { 招式id: { name, intent, dmg?, hits?, blk?, fx?, say? } }
 *   intent 决定头顶图标：attack / attack_debuff / defend / buff / debuff / heal / unknown
 * ai(e, turn, rng, B) 返回招式 id；也可以直接给 pattern: ['a','b','a']
 * body: 体型倍率（Boss 放大）
 * ---------------------------------------------------------------
 */

const A = (name, dmg, extra = {}) => ({ name, intent: 'attack', dmg, ...extra });

export const ENEMIES = {
  /* ================= 第一层 · 地牢 ================= */
  slime: {
    name: '史莱姆', sprite: 'slime', hp: [10, 14], act: 1,
    moves: {
      tackle: A('撞击', 5),
      lick: { name: '酸液舔舐', intent: 'attack_debuff', dmg: 3, fx: [{ t: 'debuff', k: 'weak', v: 1 }] },
      jiggle: { name: '抖动', intent: 'buff', blk: 4 },
    },
    ai: (e, t, rng) => (t % 4 === 3 ? 'jiggle' : t % 3 === 2 ? 'lick' : 'tackle'),
  },
  bat: {
    name: '吸血蝙蝠', sprite: 'bat', hp: [8, 11], act: 1,
    moves: {
      bite: A('双咬', 3, { hits: 2 }),
      screech: { name: '尖啸', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 1 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'screech' : 'bite'),
  },
  spider: {
    name: '洞穴蜘蛛', sprite: 'spider', hp: [10, 13], act: 1,
    moves: {
      bite: A('毒咬', 4, { fx: [{ t: 'debuff', k: 'poison', v: 1 }] }),
      web: { name: '吐丝', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 2 }] },
    },
    ai: (e, t) => (t % 3 === 1 ? 'web' : 'bite'),
  },
  worm: {
    name: '掘地虫', sprite: 'worm', hp: [13, 17], act: 1,
    moves: {
      gnaw: A('撕咬', 6),
      burrow: { name: '钻地', intent: 'defend', blk: 6, fx: [{ t: 'buff', k: 'strength', v: 1 }] },
    },
    ai: (e, t) => (t % 3 === 0 ? 'burrow' : 'gnaw'),
  },
  ghost: {
    name: '怨灵', sprite: 'ghost', hp: [9, 12], act: 1,
    moves: {
      touch: A('冰冷触碰', 5),
      phase: { name: '虚化', intent: 'defend', blk: 5 },
    },
    ai: (e, t, rng) => (rng.chance(0.35) ? 'phase' : 'touch'),
  },
  undead: {
    name: '骷髅兵', sprite: 'undead', hp: [15, 19], act: 1,
    moves: {
      slash: A('挥砍', 7),
      bones: { name: '骨甲', intent: 'defend', blk: 5 },
    },
    ai: (e, t) => (t % 3 === 2 ? 'bones' : 'slash'),
  },
  apprentice: {
    name: '堕落学徒', sprite: 'apprentice', hp: [12, 15], act: 1,
    moves: {
      staff: A('法杖敲击', 6),
      empower: { name: '附魔', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 2 }] },
    },
    ai: (e, t) => (t === 0 ? 'empower' : t % 3 === 0 ? 'empower' : 'staff'),
  },
  guard: {
    name: '地牢守卫', sprite: 'guard', hp: [17, 21], act: 1,
    moves: {
      cleave: A('劈砍', 8),
      shieldup: { name: '举盾', intent: 'defend', blk: 6 },
    },
    ai: (e, t) => (t % 3 === 1 ? 'shieldup' : 'cleave'),
  },
  slime_big: {
    name: '巨型史莱姆', sprite: 'slime', hp: [34, 40], act: 1, elite: true, body: 1.7,
    moves: {
      devour: A('吞噬', 10),
      acid: { name: '酸液喷溅', intent: 'attack_debuff', dmg: 4, fx: [{ t: 'debuff', k: 'poison', v: 3 }] },
      split: { name: '分裂', intent: 'buff', fx: [{ t: 'summon', id: 'slime', n: 1 }] },
    },
    ai: (e, t) => (t % 4 === 2 ? 'split' : t % 3 === 1 ? 'acid' : 'devour'),
  },
  skeleton_king: {
    name: '骷髅王', sprite: 'undead', hp: [40, 46], act: 1, elite: true, body: 1.7,
    moves: {
      royal_slash: A('王之斩', 12),
      summon: { name: '召唤骸骨', intent: 'buff', fx: [{ t: 'summon', id: 'undead', n: 1 }] },
      bonewall: { name: '骨墙', intent: 'defend', blk: 10 },
    },
    ai: (e, t) => (t === 0 ? 'summon' : t % 4 === 3 ? 'bonewall' : 'royal_slash'),
  },

  /* ================= 第二层 · 巢穴 ================= */
  golem: {
    name: '石傀儡', sprite: 'golem', hp: [24, 30], act: 2,
    moves: {
      smash: A('重拳', 10),
      harden: { name: '硬化', intent: 'defend', blk: 10 },
    },
    ai: (e, t) => (t % 3 === 2 ? 'harden' : 'smash'),
  },
  crabdemon: {
    name: '红蟹魔', sprite: 'crabdemon', hp: [20, 26], act: 2,
    moves: {
      pincer: A('钳击', 7, { fx: [{ t: 'debuff', k: 'poison', v: 2 }] }),
      spray: { name: '喷毒', intent: 'debuff', fx: [{ t: 'debuff', k: 'poison', v: 4 }] },
    },
    ai: (e, t) => (t % 3 === 1 ? 'spray' : 'pincer'),
  },
  witch: {
    name: '沼泽女巫', sprite: 'witch', hp: [18, 24], act: 2,
    moves: {
      hex: { name: '诅咒', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_wound', to: 'discard', n: 2 }] },
      bolt: A('暗影箭', 6),
      mending: { name: '自愈', intent: 'heal', fx: [{ t: 'healSelf', v: 6 }] },
    },
    ai: (e, t) => (t === 0 ? 'hex' : t % 3 === 2 ? 'bolt' : rng0(e) ? 'mending' : 'bolt'),
  },
  dwarf: {
    name: '狂怒矮人', sprite: 'dwarf', hp: [26, 32], act: 2,
    moves: {
      axe: A('战斧', 12),
      roar: { name: '怒吼', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 2 }] },
    },
    ai: (e, t) => (t % 4 === 3 ? 'roar' : 'axe'),
  },
  monk: {
    name: '苦修武僧', sprite: 'monk', hp: [22, 28], act: 2,
    moves: {
      flurry: A('三连击', 4, { hits: 3 }),
      meditate: { name: '打坐', intent: 'heal', fx: [{ t: 'healSelf', v: 5 }, { t: 'buff', k: 'block_next', v: 5 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'meditate' : 'flurry'),
  },
  guard_elite: {
    name: '精英守卫', sprite: 'guard_elite', hp: [32, 38], act: 2,
    moves: {
      heavy: A('重斩', 10),
      ironwall: { name: '铁壁', intent: 'defend', blk: 8 },
      intimidate: { name: '威吓', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 2 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
    },
    ai: (e, t) => (t === 0 ? 'intimidate' : t % 3 === 2 ? 'ironwall' : 'heavy'),
  },
  spider_queen: {
    name: '蛛后', sprite: 'spider', hp: [50, 58], act: 2, elite: true, body: 1.9,
    moves: {
      venom: { name: '毒液喷射', intent: 'attack_debuff', dmg: 5, fx: [{ t: 'debuff', k: 'poison', v: 6 }] },
      rend: A('撕咬', 10),
      web: { name: '蛛网', intent: 'defend', blk: 8, fx: [{ t: 'debuff', k: 'weak', v: 2 }] },
      brood: { name: '产卵', intent: 'buff', fx: [{ t: 'summon', id: 'spider', n: 1 }] },
    },
    ai: (e, t) => ['venom', 'rend', 'web', 'rend', 'brood', 'venom'][t % 6],
  },
  lich: {
    name: '巫妖', sprite: 'witch', hp: [55, 64], act: 2, elite: true, body: 1.8,
    moves: {
      deathray: A('死亡射线', 14),
      curse: { name: '亡灵诅咒', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_regret', to: 'discard', n: 1 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
      drain: A('生命汲取', 8, { fx: [{ t: 'healSelf', v: 8 }] }),
    },
    ai: (e, t) => ['deathray', 'curse', 'drain', 'deathray', 'curse'][t % 5],
  },

  /* ================= 第三层 · 深渊 ================= */
  warrior: {
    name: '深渊战士', sprite: 'warrior', hp: [34, 40], act: 3,
    moves: {
      greatsword: A('巨剑斩', 14),
      warcry: { name: '战吼', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 3 }] },
    },
    ai: (e, t) => (t === 0 ? 'warcry' : t % 4 === 3 ? 'warcry' : 'greatsword'),
  },
  noble: {
    name: '堕落贵族', sprite: 'noble', hp: [28, 34], act: 3,
    moves: {
      whip: A('鞭笞', 9),
      rally: { name: '鼓舞', intent: 'buff', fx: [{ t: 'buffAll', k: 'strength', v: 2 }] },
      sip: { name: '饮血', intent: 'heal', fx: [{ t: 'healSelf', v: 7 }] },
    },
    ai: (e, t) => (t === 0 ? 'rally' : t % 4 === 2 ? 'sip' : 'whip'),
  },
  statue: {
    name: '石像守卫', sprite: 'boss_stone', hp: [40, 48], act: 3,
    moves: {
      gaze: { name: '石化凝视', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }, { t: 'debuff', k: 'weak', v: 2 }] },
      crush: A('碾压', 16),
      stone: { name: '岩壳', intent: 'defend', blk: 14 },
    },
    ai: (e, t) => (t === 0 ? 'gaze' : t % 3 === 2 ? 'stone' : 'crush'),
  },
  demonling: {
    name: '深渊小鬼', sprite: 'undead', tint: 'hue-rotate(275deg) saturate(2.1) brightness(1.12)', hp: [24, 30], act: 3,
    moves: {
      claw: A('撕抓', 5, { hits: 3 }),
      boom: A('自爆', 18, { selfDamage: 10 }),
    },
    ai: (e, t, rng) => (e.hp < e.maxHp * 0.3 ? 'boom' : 'claw'),
  },
  gargoyle: {
    name: '石像鬼', sprite: 'gargoyle', hp: [60, 70], act: 3, elite: true, body: 1.8,
    moves: {
      dive: A('俯冲', 13),
      petrify: { name: '石化', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 3 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      shell: { name: '石壳', intent: 'defend', blk: 16, fx: [{ t: 'buff', k: 'thorns', v: 4 }] },
    },
    ai: (e, t) => ['petrify', 'dive', 'shell', 'dive'][t % 4],
  },

  /* ================= Boss ================= */
  boss_eye: {
    name: '深渊魔眼', sprite: 'boss_demon', hp: [92, 92], act: 1, boss: true, body: 2.6,
    moves: {
      gaze: { name: '虚空凝视', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }, { t: 'debuff', k: 'weak', v: 2 }] },
      wave: { name: '暗影波', intent: 'attack', dmg: 9 },
      charge: { name: '蓄能', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 3 }] },
      ray: A('湮灭射线', 22),
      spawn: { name: '召唤仆从', intent: 'buff', fx: [{ t: 'summon', id: 'bat', n: 2 }] },
    },
    ai: (e, t) => ['gaze', 'wave', 'charge', 'ray', 'spawn', 'wave', 'ray'][t % 7],
  },
  boss_tyrant: {
    name: '石像暴君', sprite: 'boss_stone', hp: [135, 135], act: 2, boss: true, body: 2.8,
    moves: {
      crush: A('碾压', 18),
      petrify: { name: '石化诅咒', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 3 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      armor: { name: '磐石之躯', intent: 'defend', blk: 20 },
      quake: { name: '大地震击', intent: 'attack', dmg: 11, hits: 2 },
    },
    ai: (e, t) => ['petrify', 'crush', 'armor', 'quake', 'crush', 'quake'][t % 6],
  },
  boss_lord: {
    name: '深渊之主', sprite: 'boss_gargoyle', hp: [180, 180], act: 3, boss: true, body: 3.0,
    moves: {
      ruin: A('毁灭之爪', 26),
      void: { name: '虚空侵蚀', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_regret', to: 'discard', n: 2 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      swarm: { name: '深渊召唤', intent: 'buff', fx: [{ t: 'summon', id: 'demonling', n: 2 }] },
      drain: { name: '灵魂收割', intent: 'attack', dmg: 14, fx: [{ t: 'healSelf', v: 14 }] },
      doom: { name: '终末宣告', intent: 'unknown', fx: [{ t: 'buff', k: 'strength', v: 4 }] },
    },
    ai: (e, t) => ['void', 'ruin', 'swarm', 'drain', 'doom', 'ruin', 'drain'][t % 7],
  },
};

function rng0(e) { return Math.random() < 0.3; }

/** 遭遇战配置（按层） */
export const ENCOUNTERS = {
  1: {
    weak: [['slime'], ['bat', 'bat'], ['spider'], ['worm'], ['ghost', 'bat'], ['slime', 'slime']],
    strong: [['undead', 'bat'], ['guard'], ['apprentice', 'slime'], ['ghost', 'spider', 'bat'], ['guard', 'apprentice']],
    elite: [['slime_big'], ['skeleton_king'], ['slime_big', 'slime']],
    boss: [['boss_eye']],
  },
  2: {
    weak: [['crabdemon'], ['monk'], ['witch'], ['spider', 'spider']],
    strong: [['golem'], ['dwarf', 'bat'], ['guard_elite'], ['crabdemon', 'monk'], ['witch', 'golem']],
    elite: [['spider_queen'], ['lich'], ['guard_elite', 'monk']],
    boss: [['boss_tyrant']],
  },
  3: {
    weak: [['demonling'], ['noble'], ['statue']],
    strong: [['warrior', 'demonling'], ['statue', 'noble'], ['warrior', 'warrior'], ['gargoyle']],
    elite: [['gargoyle'], ['lich', 'demonling'], ['spider_queen', 'gargoyle']],
    boss: [['boss_lord']],
  },
};

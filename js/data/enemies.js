/**
 * 敌人数据
 * ---------------------------------------------------------------
 * moves: { 招式id: { name, intent, dmg?, hits?, blk?, fx?, say? } }
 *   intent 决定头顶图标：attack / attack_debuff / defend / buff / debuff / heal / unknown
 * ai(e, turn, rng, B) 返回招式 id；也可以直接给 pattern: ['a','b','a']
 * body: 体型倍率（Boss 放大）
 *
 * act 字段：敌人**基础数值所属的层**（数值就是照这一层调的）。
 *   同一张敌人表会被所有层复用，实际出场的强度由 core/battle.js 的
 *   `actScale(层)` 缩放。倍率是**相对第 1 层**算的（下面这份表就是
 *   `1 + STEP × (层-1)` 的结果，改常量时记得同步这里）：
 *     第 1 层 ×1.00 生命 / ×1.00 攻击
 *     第 2 层 ×1.25 生命 / ×1.17 攻击
 *     第 3 层 ×1.50 生命 / ×1.34 攻击
 *     第 4 层 ×1.75 生命 / ×1.51 攻击
 *   所以 act 只表示"这套数值的基线"，不代表它只能在那一层出现。
 * ---------------------------------------------------------------
 */

const A = (name, dmg, extra = {}) => ({ name, intent: 'attack', dmg, ...extra });

/** 每层相对第 1 层的强度倍率。改这里就能调整整条难度曲线。
    hp: 1 → 1.25 → 1.5 → 1.75（每层 +25%）
    atk: 1 → 1.17 → 1.34 → 1.51（每层 +17%）
    攻击增幅 2026-10-12 一天内被调过三次（+20% → +15% → +20% → +13%），
    2026-10-13 又按"一击伤害参考表"回调到 **+17%** ——
    原因是同一只怪会在多层出现（蛛后/巫妖在 2、3、4 层），
    13% 时它不可能同时落在两层的档位里，17% 才能两边都合规。
    ⚠️ 这份注释以前还写着 +13%，与常量不符；**以常量与 actScale() 为准**。
    难度系统里另有"每层额外 +8% 攻击"的选项可以再往上加。 */
export const ACT_HP_STEP = 0.25;
export const ACT_ATK_STEP = 0.17;
export const TOTAL_ACTS = 4;
export function actScale(act) {
  const n = Math.max(0, (act | 0) - 1);
  return { hp: 1 + ACT_HP_STEP * n, atk: 1 + ACT_ATK_STEP * n };
}

export const ENEMIES = {
  /* ================= 第一层 · 地牢 ================= */
  slime: {
    name: '史莱姆', sprite: 'slime', hp: [10, 14], act: 1,
    moves: {
      tackle: A('撞击', 5),
      lick: { name: '酸液舔舐', intent: 'attack_debuff', dmg: 9, fx: [{ t: 'debuff', k: 'weak', v: 1 }] },
      jiggle: { name: '抖动', intent: 'buff', blk: 4 },
    },
    ai: (e, t, rng) => (t % 4 === 3 ? 'jiggle' : t % 3 === 2 ? 'lick' : 'tackle'),
  },
  bat: {
    name: '吸血蝙蝠', sprite: 'bat', hp: [8, 11], act: 1,
    moves: {
      bite: A('双咬', 4, { hits: 2 }),
      screech: { name: '尖啸', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 1 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'screech' : 'bite'),
  },
  spider: {
    name: '洞穴蜘蛛', sprite: 'spider', hp: [10, 13], act: 1,
    moves: {
      bite: A('毒咬', 9, { fx: [{ t: 'debuff', k: 'poison', v: 1 }] }),
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
    name: '巨型史莱姆', sprite: 'slime', hp: [34, 40], act: 1, elite: true, body: 1.5,
    moves: {
      devour: A('吞噬', 9),
      acid: { name: '酸液喷溅', intent: 'attack_debuff', dmg: 11, fx: [{ t: 'debuff', k: 'poison', v: 3 }] },
      split: { name: '分裂', intent: 'buff', fx: [{ t: 'summon', id: 'slime', n: 1 }] },
    },
    ai: (e, t) => (t % 4 === 2 ? 'split' : t % 3 === 1 ? 'acid' : 'devour'),
  },
  skeleton_king: {
    name: '骷髅王', sprite: 'undead', hp: [40, 46], act: 1, elite: true, body: 1.5,
    moves: {
      royal_slash: A('王之斩', 9),
      summon: { name: '召唤骸骨', intent: 'buff', fx: [{ t: 'summon', id: 'undead', n: 1 }] },
      bonewall: { name: '骨墙', intent: 'defend', blk: 10 },
    },
    ai: (e, t) => (t === 0 ? 'summon' : t % 4 === 3 ? 'bonewall' : 'royal_slash'),
  },

  /* ================= 第二层 · 巢穴 ================= */
  golem: {
    name: '石傀儡', sprite: 'golem', hp: [24, 30], act: 2,
    moves: {
      smash: A('重拳', 12),
      harden: { name: '硬化', intent: 'defend', blk: 10 },
    },
    ai: (e, t) => (t % 3 === 2 ? 'harden' : 'smash'),
  },
  crabdemon: {
    name: '红蟹魔', sprite: 'crabdemon', hp: [20, 26], act: 2,
    moves: {
      pincer: A('钳击', 9, { fx: [{ t: 'debuff', k: 'poison', v: 2 }] }),
      spray: { name: '喷毒', intent: 'debuff', fx: [{ t: 'debuff', k: 'poison', v: 4 }] },
    },
    ai: (e, t) => (t % 3 === 1 ? 'spray' : 'pincer'),
  },
  witch: {
    name: '沼泽女巫', sprite: 'witch', hp: [18, 24], act: 2,
    moves: {
      hex: { name: '诅咒', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_wound', to: 'discard', n: 2 }] },
      bolt: A('暗影箭', 9),
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
      flurry: A('三连击', 6, { hits: 2 }),
      meditate: { name: '打坐', intent: 'heal', fx: [{ t: 'healSelf', v: 5 }, { t: 'buff', k: 'block_next', v: 5 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'meditate' : 'flurry'),
  },
  guard_elite: {
    name: '精英守卫', sprite: 'guard_elite', hp: [32, 38], act: 2,
    moves: {
      heavy: A('重斩', 12),
      ironwall: { name: '铁壁', intent: 'defend', blk: 8 },
      intimidate: { name: '威吓', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 2 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
    },
    ai: (e, t) => (t === 0 ? 'intimidate' : t % 3 === 2 ? 'ironwall' : 'heavy'),
  },
  spider_queen: {
    name: '蛛后', sprite: 'spider', hp: [50, 58], act: 2, elite: true, body: 1.6,
    moves: {
      venom: { name: '毒液喷射', intent: 'attack_debuff', dmg: 14, fx: [{ t: 'debuff', k: 'poison', v: 6 }] },
      rend: A('撕咬', 14),
      web: { name: '蛛网', intent: 'defend', blk: 8, fx: [{ t: 'debuff', k: 'weak', v: 2 }] },
      brood: { name: '产卵', intent: 'buff', fx: [{ t: 'summon', id: 'spider', n: 1 }] },
    },
    ai: (e, t) => ['venom', 'rend', 'web', 'rend', 'brood', 'venom'][t % 6],
  },
  lich: {
    name: '巫妖', sprite: 'witch', hp: [55, 64], act: 2, elite: true, body: 1.55,
    moves: {
      deathray: A('死亡射线', 13),
      curse: { name: '亡灵诅咒', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_regret', to: 'discard', n: 1 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
      drain: A('生命汲取', 14, { fx: [{ t: 'healSelf', v: 8 }] }),
    },
    ai: (e, t) => ['deathray', 'curse', 'drain', 'deathray', 'curse'][t % 5],
  },

  /* ================= 第三层 · 深渊 ================= */
  warrior: {
    name: '深渊战士', sprite: 'warrior', hp: [34, 40], act: 3,
    moves: {
      greatsword: A('巨剑斩', 13),
      warcry: { name: '战吼', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 3 }] },
    },
    ai: (e, t) => (t === 0 ? 'warcry' : t % 4 === 3 ? 'warcry' : 'greatsword'),
  },
  noble: {
    name: '堕落贵族', sprite: 'noble', hp: [28, 34], act: 3,
    moves: {
      whip: A('鞭笞', 12),
      rally: { name: '鼓舞', intent: 'buff', fx: [{ t: 'buffAll', k: 'strength', v: 2 }] },
      sip: { name: '饮血', intent: 'heal', fx: [{ t: 'healSelf', v: 7 }] },
    },
    ai: (e, t) => (t === 0 ? 'rally' : t % 4 === 2 ? 'sip' : 'whip'),
  },
  statue: {
    name: '石像守卫', sprite: 'boss_stone', hp: [40, 48], act: 3,
    moves: {
      gaze: { name: '石化凝视', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }, { t: 'debuff', k: 'weak', v: 2 }] },
      crush: A('碾压', 13),
      stone: { name: '岩壳', intent: 'defend', blk: 14 },
    },
    ai: (e, t) => (t === 0 ? 'gaze' : t % 3 === 2 ? 'stone' : 'crush'),
  },
  demonling: {
    name: '深渊小鬼', sprite: 'undead', tint: 'hue-rotate(275deg) saturate(2.1) brightness(1.12)', hp: [24, 30], act: 3,
    moves: {
      claw: A('撕抓', 6, { hits: 2 }),
      boom: A('自爆', 13, { selfDamage: 10 }),
    },
    ai: (e, t, rng) => (e.hp < e.maxHp * 0.3 ? 'boom' : 'claw'),
  },
  gargoyle: {
    name: '石像鬼', sprite: 'gargoyle', hp: [60, 70], act: 3, elite: true, body: 1.55,
    moves: {
      dive: A('俯冲', 13),
      petrify: { name: '石化', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 3 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      shell: { name: '石壳', intent: 'defend', blk: 16, fx: [{ t: 'buff', k: 'thorns', v: 4 }] },
    },
    ai: (e, t) => ['petrify', 'dive', 'shell', 'dive'][t % 4],
  },

  /* ================= 第三层专属（2026-10-13 新增） ================= */
  /* 小怪「窃魂灯」—— 机制：**能量掠夺**。
     灯里锁着上一个旅人的魂，它每 3 回合吸走你 1 点**当前**能量。
     惩罚的是"攒着能量不打"（很多人喜欢留 3 能量等一张大招），
     所以它的攻击很低 —— 它的威胁不在伤害，而在打断你的节奏。 */
  soul_lantern: {
    name: '窃魂灯', sprite: 'soul_lantern', hp: [30, 36], act: 3,
    moves: {
      drain: { name: '吸魂', intent: 'debuff', fx: [{ t: 'drainEnergy', n: 1 }, { t: 'debuff', k: 'weak', v: 1 }] },
      flare: A('鬼火', 12),
      guard: { name: '灯罩', intent: 'defend', blk: 10 },
    },
    ai: (e, t) => ['drain', 'flare', 'guard', 'flare'][t % 4],
  },
  /* 精英「深渊祭司」—— 机制：**拖时间惩罚**。
     它自己几乎不打人（攻击只有 6），但每回合都在给全场加力量、往你牌堆塞诅咒。
     你拖得越久，它养出来的力量越高 → 逼你**必须进攻**，
     和前面那些"高攻低血、速战速决"的精英正好相反。 */
  abyss_priest: {
    name: '深渊祭司', sprite: 'abyss_priest', hp: [62, 72], act: 3, elite: true, body: 1.5,
    moves: {
      rite: { name: '血祭', intent: 'buff', fx: [{ t: 'buffAll', k: 'strength', v: 2 }] },
      hex: { name: '深渊祷言', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_wound', to: 'discard', n: 1 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
      smite: A('祭司之锤', 12),
      mend: { name: '献祭自愈', intent: 'heal', fx: [{ t: 'healSelf', v: 12 }] },
    },
    ai: (e, t) => ['rite', 'hex', 'smite', 'mend', 'rite', 'smite'][t % 6],
  },

  /* ================= 第四层专属（2026-10-13 新增） ================= */
  /* 小怪「虚空裂片」—— 机制：**分裂**（血量降到一半时裂成 2 个）。
     一次只打一只（"单点爆发"）会被它反制：打掉一半 → 场上变 2 只；
     而直接一波打死、或者用群攻，就不会触发。所以它逼玩家换打法。 */
  void_shard: {
    name: '虚空裂片', sprite: 'void_shard', hp: [34, 40], act: 4,
    split: { n: 2, hpPct: 0.4 },
    moves: {
      slice: A('虚空切面', 14),
      shatter: { name: '碎响', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 2 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'shatter' : 'slice'),
  },
  /* 精英「深渊之喉」—— 机制：**护甲溶解**。
     每次出招前先吞掉你**一半护甲**，然后再打。它专门惩罚"叠满甲慢慢磨"，
     所以它的血量很厚（逼你没法速杀），你必须一边防守一边输出。 */
  abyss_maw: {
    name: '深渊之喉', sprite: 'abyss_maw', hp: [70, 82], act: 4, elite: true, body: 1.6,
    moves: {
      devour: { name: '吞噬甲胄', intent: 'attack', dmg: 13, preFx: [{ t: 'eatBlock', pct: 50 }] },
      grind: { name: '磨牙', intent: 'attack', dmg: 7, hits: 2, preFx: [{ t: 'eatBlock', pct: 50 }] },
      swallow: { name: '囫囵吞下', intent: 'attack_debuff', dmg: 15, preFx: [{ t: 'eatBlock', pct: 50 }], fx: [{ t: 'debuff', k: 'frail', v: 2 }] },
      gorge: { name: '饱食', intent: 'heal', fx: [{ t: 'healSelf', v: 14 }] },
    },
    ai: (e, t) => ['devour', 'grind', 'gorge', 'swallow'][t % 4],
  },

  /* ================= Boss ================= */
  boss_eye: {
    name: '深渊魔眼', sprite: 'boss_demon', hp: [74, 74], act: 1, boss: true, body: 1.6,
    moves: {
      gaze: { name: '虚空凝视', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }, { t: 'debuff', k: 'weak', v: 2 }] },
      wave: { name: '暗影波', intent: 'attack', dmg: 12 },
      charge: { name: '蓄能', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 3 }] },
      ray: A('湮灭射线', 10),
      spawn: { name: '召唤仆从', intent: 'buff', fx: [{ t: 'summon', id: 'bat', n: 2 }] },
    },
    ai: (e, t) => ['gaze', 'wave', 'charge', 'ray', 'spawn', 'wave', 'ray'][t % 7],
  },
  boss_tyrant: {
    name: '石像暴君', sprite: 'boss_stone', hp: [108, 108], act: 2, boss: true, body: 2.0,
    moves: {
      crush: A('碾压', 12),
      petrify: { name: '石化诅咒', intent: 'debuff', fx: [{ t: 'debuff', k: 'weak', v: 3 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      armor: { name: '磐石之躯', intent: 'defend', blk: 16 },
      quake: { name: '大地震击', intent: 'attack', dmg: 8, hits: 2 },
    },
    ai: (e, t) => ['petrify', 'crush', 'armor', 'quake', 'crush', 'quake'][t % 6],
  },
  boss_lord: {
    name: '深渊之主', sprite: 'boss_gargoyle', hp: [144, 144], act: 3, boss: true, body: 2.1,
    moves: {
      ruin: A('毁灭之爪', 14),
      void: { name: '虚空侵蚀', intent: 'debuff', fx: [{ t: 'addCard', id: 'curse_regret', to: 'discard', n: 2 }, { t: 'debuff', k: 'vulnerable', v: 3 }] },
      swarm: { name: '深渊召唤', intent: 'buff', fx: [{ t: 'summon', id: 'demonling', n: 2 }] },
      drain: { name: '灵魂收割', intent: 'attack', dmg: 18, fx: [{ t: 'healSelf', v: 14 }] },
      doom: { name: '终末宣告', intent: 'unknown', fx: [{ t: 'buff', k: 'strength', v: 4 }] },
    },
    ai: (e, t) => ['void', 'ruin', 'swarm', 'drain', 'doom', 'ruin', 'drain'][t % 7],
  },
  /* 第 3 层 Boss 之一：凛冬女王。
     机制特色（产品设定）：**攻击意图与增益意图都会往玩家身上叠冰霜**。
     玩家身上的冰霜攒到 4 层就会变成冰冻，而那会让玩家**本回合能量减半** ——
     所以这场仗的核心是"别让它一直冻你"，而不是单纯拼伤害。
     和「深渊之主」**平分第 3 层 Boss 的出现概率**（以后再加 Boss 会继续平分）。 */
  boss_frostqueen: {
    name: '凛冬女王', sprite: 'boss_frostqueen', hp: [140, 140], act: 3, boss: true, body: 1.8,
    moves: {
      frost_bolt: { name: '霜矢', intent: 'attack', dmg: 14, fx: [{ t: 'debuff', k: 'frost', v: 1 }] },
      ice_lance: { name: '冰锥', intent: 'attack', dmg: 8, hits: 2, fx: [{ t: 'debuff', k: 'frost', v: 1 }] },
      blizzard: { name: '暴风雪', intent: 'attack', dmg: 15, fx: [{ t: 'debuff', k: 'frost', v: 2 }] },
      winter_grasp: { name: '凛冬之握', intent: 'attack_debuff', dmg: 18, fx: [{ t: 'debuff', k: 'weak', v: 3 }, { t: 'debuff', k: 'frost', v: 2 }] },
      frozen_throne: { name: '冰封王座', intent: 'buff', blk: 16, fx: [{ t: 'buff', k: 'strength', v: 2 }, { t: 'debuff', k: 'frost', v: 2 }] },
      absolute_zero: { name: '绝对零度', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 3 }, { t: 'debuff', k: 'frost', v: 3 }] },
    },
    ai: (e, t) => ['frost_bolt', 'frozen_throne', 'ice_lance', 'winter_grasp',
                   'blizzard', 'absolute_zero', 'frost_bolt', 'ice_lance'][t % 8],
  },
  /* 第 4 层 · 深渊之底的最终 Boss。
     基础数值就照第 4 层写（这一层会再乘 1.39 倍攻击，所以这里不能按第 3 层的量级给）。
     立绘有**专属贴图**（`boss_abyss`）：以前它借的是「深渊之主」那张图 + 色相旋转，
     两个 Boss 长得一模一样，最终决战毫无辨识度。

     2026-10-13 产品改动（两条）：
       ① **砍掉召唤小弟**：原来 AI 里有一手 `brood`（召唤深渊，一次招 2 只深渊小鬼）。
          最终 Boss 本来就有 5 层力量成长 + 三连击 + 吸血，再加"场上突然多两只"
          会让最后一场变成"先清小怪、再打 Boss"的拉锯战，把决战节奏冲散。
       ② **基础攻击各降 1~3 点**：撕裂虚空 24→**22**，连环撕裂每段 10→**9**，
          收割灵魂 13→**12**。去掉召唤之后 Boss 少了一份压制力，
          攻击下调是为了**顺手把"决策密度"还回来** —— 让玩家把注意力放在
          "挡哪一手 / 什么时候爆发"，而不是被小怪分心。
          注意：`收割灵魂` 的吸血量（16）没动，它的定位是"惩罚你不打断"。 */
  boss_abyss: {
    name: '深渊之眼', sprite: 'boss_abyss', hp: [168, 168], act: 4, boss: true, body: 2.2,
    moves: {
      rend: A('撕裂虚空', 16),
      mark: { name: '湮灭印记', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 4 }, { t: 'debuff', k: 'weak', v: 2 }] },
      bulwark: { name: '深渊壁垒', intent: 'defend', blk: 21 },
      onslaught: { name: '连环撕裂', intent: 'attack', dmg: 9, hits: 2 },
      reap: { name: '收割灵魂', intent: 'attack', dmg: 13, fx: [{ t: 'healSelf', v: 16 }] },
      ascend: { name: '终极宣告', intent: 'unknown', fx: [{ t: 'buff', k: 'strength', v: 5 }] },
    },
    // 去掉 brood 之后正好剩 6 手：先上印记（逼玩家挡）→ 大招 → 三连击 → 吸血 → 加甲 → 力量成长
    ai: (e, t) => ['mark', 'rend', 'onslaught', 'reap', 'bulwark', 'ascend'][t % 6],
  },
};

function rng0(e) { return Math.random() < 0.3; }

/** 遭遇战配置（按层）
    第 4 层是"深渊之底"：沿用第 3 层的敌人表，但强度由 actScale 放大到
    约 1.75 倍生命、1.6 倍攻击，所以怪物本身就是第 3 层那批的强化版。
    这里刻意把配置写全（而不是让代码回退到第 3 层），
    这样以后想单独调第 4 层的阵容，改这一处就够了。 */
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
    weak: [['demonling'], ['noble'], ['statue'], ['soul_lantern']],
    strong: [['warrior', 'demonling'], ['statue', 'noble'], ['warrior', 'warrior'], ['gargoyle'], ['soul_lantern', 'noble']],
    elite: [['gargoyle'], ['lich', 'demonling'], ['spider_queen', 'gargoyle'], ['abyss_priest']],
    // 第 3 层的两个 Boss **平分出现概率** —— 往这个列表里加条目即可继续平分
    boss: [['boss_lord'], ['boss_frostqueen']],
  },
  4: {
    weak: [['demonling', 'demonling'], ['noble', 'demonling'], ['statue'], ['void_shard']],
    strong: [['warrior', 'noble'], ['gargoyle'], ['statue', 'warrior'], ['warrior', 'demonling', 'demonling'], ['void_shard', 'demonling']],
    elite: [['gargoyle', 'demonling'], ['spider_queen', 'lich'], ['gargoyle', 'statue'], ['abyss_maw']],
    boss: [['boss_abyss']],
  },
};

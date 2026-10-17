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
      /* 2026-10-17 玩家反馈：第 1 层**第 2 关**就遇到 4×2 的攻击，对 27 难度分太高了。
         4×2 = 8 点/回合，而那时玩家手里只有 5 张起始牌、还没拿到任何遗物。
         多段攻击的伤害应该是"从很小起步、逐步加压"，而不是一上来就打满。
         这里下调到 **3×2**（合计 6，落在产品给的 5~9 档下限附近），
         再靠 `innerScale`（层内进度 ×0.88~×1.12）与 `actScale`（层间 +17%）
         把它在地图后段和深层抬上去 —— 复杂度不靠单只怪的起点撑。 */
      bite: A('双咬', 3, { hits: 2 }),
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
      // 6×2 = 12 → **5×2 = 10**：与吸血蝙蝠同样的理由（多段怪起手别打满）
      flurry: A('三连击', 5, { hits: 2 }),
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
     所以它的血量很厚（逼你没法速杀），你必须一边防守一边输出。
     ⚠️ 2026-10-17 从第 4 层搬到第 3 层，数值按第 3 层重配：
        原 70~82 血 / 囫囵吞下 15 是照第 4 层调的，搬到第 3 层会显示 105~123 血、
        单体重击 20，比同层精英（巫妖 55~64 血、峰值 19）高出一截。
        现在：血 58~68 → 显示 87~102，磨牙 6×2 → 显示 8×2=16，囫囵吞下 12 → 显示 16。
        机制（吞 50% 护甲 + 脆化 2 层）原样保留。 */
  abyss_maw: {
    name: '深渊之喉', sprite: 'abyss_maw', hp: [58, 68], act: 3, elite: true, body: 1.6,
    moves: {
      devour: { name: '吞噬甲胄', intent: 'attack', dmg: 11, preFx: [{ t: 'eatBlock', pct: 50 }] },
      grind: { name: '磨牙', intent: 'attack', dmg: 6, hits: 2, preFx: [{ t: 'eatBlock', pct: 50 }] },
      swallow: { name: '囫囵吞下', intent: 'attack_debuff', dmg: 12, preFx: [{ t: 'eatBlock', pct: 50 }], fx: [{ t: 'debuff', k: 'frail', v: 2 }] },
      gorge: { name: '饱食', intent: 'heal', fx: [{ t: 'healSelf', v: 10 }] },
    },
    ai: (e, t) => ['devour', 'grind', 'gorge', 'swallow'][t % 4],
  },

  /* ================= 2026-10-17 新增的普通怪 =================
     产品要求：第 1/2 层各新增 1 种普通怪，第 3/4 层各新增 2 种。
     统一的定值纪律（与既有 33 只一致）：
       · 单体最重一击照该层的**普通档**给（第1层 5~9 / 第2层 10~15 / 第3层 15~18 / 第4层 18~21）
       · 血量照该层普通怪的量级（不越级到精英）
       · 每只都要有**一个自己的机制**，不能只是换皮数字
       · 登记进 ENCOUNTERS 的 weak/strong —— 否则**永远不会出现，而且测试不报错**
         （这是本项目最容易漏的一步，见开发与维护指南 §4(b)）
     ============================================================ */

  /* ---- 第 1 层：墓鼠（血量线低、会翻找）---- */
  grave_rat: {
    name: '墓鼠', sprite: 'bat', hp: [10, 13], act: 1,
    moves: {
      // 显示 6（第 1 层普通档 5~9）+ 1 层虚弱：教玩家"代价牌"的概念
      gnaw: { name: '啃噬', intent: 'attack', dmg: 6, fx: [{ t: 'debuff', k: 'weak', v: 1 }] },
      scatter: { name: '四散', intent: 'defend', blk: 5 },
    },
    ai: (e, t) => (t % 3 === 0 ? 'scatter' : 'gnaw'),
  },

  /* ---- 第 2 层：沼行尸（慢，但每轮回一点血，逼你快打）---- */
  bog_walker: {
    name: '沼行尸', sprite: 'undead', hp: [24, 30], act: 2,
    moves: {
      // 基础 11 → 第 2 层显示 13（普通档 10~15，且低于强档峰值 14）
      slam: A('腐臂重击', 11),
      mend: { name: '淤愈', intent: 'heal', blk: 4, fx: [{ t: 'healSelf', v: 5 }] },
    },
    ai: (e, t) => (t % 4 === 3 ? 'mend' : 'slam'),
  },

  /* ---- 第 3 层：两只是"反单一打法"的对照 ----
     一只惩罚纯物理（抗打但会给你挂虚弱），一只惩罚纯拖（越拖越痛）。 */
  bone_choir: {
    name: '骨唱诗班', sprite: 'undead', hp: [34, 42], act: 3,
    moves: {
      wail: { name: '哀嚎', intent: 'debuff', fx: [{ t: 'debuff', k: 'frail', v: 2 }, { t: 'debuff', k: 'weak', v: 1 }] },
      // 基础 12 → 第 3 层显示 16（普通档 15~18）
      toll: A('丧钟', 12),
    },
    ai: (e, t) => (t % 3 === 0 ? 'wail' : 'toll'),
  },
  cinder_wraith: {
    name: '烬火怨魂', sprite: 'witch', hp: [30, 36], act: 3,
    moves: {
      // 基础 12 → 显示 16，并挂 2 层点燃：让"只叠甲不打"的构筑难受
      sear: { name: '灼烧', intent: 'attack_debuff', dmg: 12, fx: [{ t: 'debuff', k: 'burn', v: 2 }] },
      flare: { name: '复燃', intent: 'buff', fx: [{ t: 'buff', k: 'strength', v: 2 }] },
    },
    ai: (e, t) => (t % 4 === 2 ? 'flare' : 'sear'),
  },

  /* ---- 第 4 层：两只都要求"你不能只守" ---- */
  void_herald: {
    name: '虚空传令', sprite: 'noble', hp: [40, 48], act: 4,
    moves: {
      // 基础 13 → 第 4 层显示 20（普通档 18~21）
      decree: A('虚空诏令', 13),
      // 每 4 轮往你弃牌堆塞 1 张眩晕：稀释抽牌质量
      edict: { name: '敕令', intent: 'debuff', fx: [{ t: 'addCard', id: 'status_dazed', to: 'discard', n: 1 }, { t: 'debuff', k: 'vulnerable', v: 2 }] },
    },
    ai: (e, t) => (t % 4 === 3 ? 'edict' : 'decree'),
  },
  abyss_spawn: {
    name: '深渊孽生', sprite: 'slime', hp: [38, 44], act: 4,
    moves: {
      // 基础 13 → 显示 20，并每轮自加 1 力量（拖不得）
      surge: { name: '孽潮', intent: 'attack_debuff', dmg: 13, fx: [{ t: 'buff', k: 'strength', v: 1 }] },
      fester: { name: '溃烂', intent: 'defend', blk: 8, fx: [{ t: 'buff', k: 'strength', v: 1 }] },
    },
    ai: (e, t) => (t % 3 === 2 ? 'fester' : 'surge'),
  },

  /* ================= 2026-10-17 「组合怪关卡逻辑」新怪 =================
     产品要求：第 3/4 层开始出现**互补双怪**（两只怪分工，拆错目标就吃亏）；
     第 2 层新增一个**三小怪**关卡，三只同一轮最多只有两个攻击意图（分工固定）。

     实现方式（已与产品确认）：
       · 互补靠 `buffOne`（只给**指定 defId** 的同伴加），不是 buffAll ——
         否则场上多出第三只怪时会连带喂到它。
       · 三怪的攻击意图上限**只靠 AI 轮序保证**（不碰引擎的意图掷骰），
         因此这三只**绝对不能有 summon 能力**，否则多出第四只就破了约束。
         `intenttest`（测试 AM3）会真的跑 30 轮，逐轮数攻击意图。
     ==================================================================== */

  /* ---- 第 2 层：三小怪「残兵小队」----
     分工固定：**碑灵**（只增益，不攻击）/ **盾兵**（护甲+攻击）/ **弩手**（纯输出）。
     三者轮序刻意错开，保证任一轮的攻击意图 ≤ 2：
       轮0 碑灵(buff) 盾兵(attack) 弩手(attack) → 2 个攻击
       轮1 碑灵(buff) 盾兵(defend) 弩手(attack) → 1 个
       轮2 碑灵(debuff) 盾兵(attack) 弩手(defend) → 1 个
     玩家看到的就是"总有一个不攻击的"——这就是要的分工感。 */
  squad_singer: {
    name: '碑灵', sprite: 'ghost', hp: [22, 26], act: 2,
    moves: {
      // 只增益、不攻击：给它加攻击意图会直接破坏三条约束，所以它一个攻击招都没有
      chant: { name: '碑文吟诵', intent: 'buff', fx: [{ t: 'buffOne', id: 'squad_shield', k: 'strength', v: 2 }] },
      bless: { name: '庇佑', intent: 'buff', fx: [{ t: 'buffOne', id: 'squad_crossbow', k: 'dexterity', v: 2 }] },
      curse: { name: '哀鸣', intent: 'debuff', fx: [{ t: 'debuff', k: 'frail', v: 2 }] },
    },
    ai: (e, t) => ['chant', 'bless', 'curse'][t % 3],
  },
  squad_shield: {
    name: '残盾兵', sprite: 'guard', hp: [26, 32], act: 2,
    moves: {
      // 基础 6 → 第 2 层显示 7
      bash: A('盾击', 6),
      wall: { name: '结阵', intent: 'defend', blk: 9 },
    },
    // 攻击 → 护甲 → 攻击：与弩手错开
    ai: (e, t) => (t % 2 === 1 ? 'wall' : 'bash'),
  },
  squad_crossbow: {
    name: '残弩手', sprite: 'apprentice', hp: [20, 24], act: 2,
    moves: {
      // 基础 8 → 显示 9
      shot: A('弩射', 8),
      reload: { name: '装填', intent: 'buff', blk: 5 },
    },
    // 攻击 → 攻击 → 装填：连打两轮后歇一轮
    ai: (e, t) => (t % 3 === 2 ? 'reload' : 'shot'),
  },

  /* ---- 第 3 层：互补双怪「守碑人 + 无名剑士」----
     守碑人血厚、几乎不打人，但每轮给剑士 +2 力量；
     剑士本身输出不高，可一旦被喂起来，第 5 轮开始就挡不住。
     → 先杀剑士：守碑人血厚、要打很久；
     → 先杀守碑人：剑士这几轮还能扛，但你要吃它的直伤。
     **没有正确顺序，只有取舍** —— 这正是"互补双怪"要的感觉。 */
  ward_keeper: {
    name: '守碑人', sprite: 'stone_platform', hp: [52, 60], act: 3,
    moves: {
      // 基础 8 → 显示 11：它自身输出低，价值全在"喂剑士"上
      strike: A('石碑碾压', 8),
      empower: { name: '铭刻', intent: 'buff', fx: [{ t: 'buffOne', id: 'sword_nameless', k: 'strength', v: 2 }] },
      mend: { name: '修补', intent: 'defend', blk: 10, fx: [{ t: 'buff', k: 'strength', v: 1 }] },
    },
    ai: (e, t) => ['empower', 'strike', 'empower', 'mend'][t % 4],
  },
  sword_nameless: {
    name: '无名剑士', sprite: 'hero_assassin', hp: [34, 40], act: 3,
    moves: {
      // 基础 9 → 显示 12：不加成时它不算威胁，被喂 3 轮后就是 18+
      slash: A('无铭斩', 9),
      // 双段：对"只挡一发"的玩家施压
      flurry: A('连斩', 6, { hits: 2 }),
      focus: { name: '凝神', intent: 'buff', fx: [{ t: 'buff', k: 'dexterity', v: 2 }] },
    },
    ai: (e, t) => ['slash', 'flurry', 'focus', 'flurry'][t % 4],
  },

  /* ---- 第 4 层：互补双怪「噬魂藤 + 牵丝者」----
     牵丝者每轮给噬魂藤 +2 力量并给它回血；噬魂藤是纯输出。
     与第 3 层那对不同：这里**被喂的那只才是威胁**，喂它的那只自己很脆 ——
     所以最优解反过来变成"先秒牵丝者"。同一个框架、相反的最优解。 */
  soul_vine: {
    name: '噬魂藤', sprite: 'worm', hp: [46, 54], act: 4,
    moves: {
      // 基础 12 → 显示 18
      lash: A('缠鞭', 12),
      // 基础 6×2 → 第 4 层显示 9×2 = 18
      constrict: A('绞缚', 6, { hits: 2 }),
    },
    ai: (e, t) => (t % 3 === 2 ? 'constrict' : 'lash'),
  },
  thread_puller: {
    name: '牵丝者', sprite: 'witch', hp: [30, 36], act: 4,
    moves: {
      // 给噬魂藤加力量 + 回血：不打断它，藤就越来越难打
      pull: { name: '牵丝', intent: 'buff', fx: [{ t: 'buffOne', id: 'soul_vine', k: 'strength', v: 2 }, { t: 'healSelf', v: 6 }] },
      // 基础 9 → 显示 14：它自己有输出但不高
      stab: A('丝刃', 9),
      weave: { name: '织网', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }] },
    },
    ai: (e, t) => ['pull', 'stab', 'weave', 'pull'][t % 4],
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
      armor: { name: '磐石之躯', intent: 'defend', blk: 12 },
      quake: { name: '大地震击', intent: 'attack', dmg: 8, hits: 2 },
    },
    ai: (e, t) => ['petrify', 'crush', 'armor', 'quake', 'crush', 'quake'][t % 6],
  },
  /* 第 2 层 Boss 之二（2026-10-17 新增，与石像暴君**平分出现概率**）。
     产品指定机制：**它的回合结束后获得 2 点虚血**。
     为什么这条机制有意义：虚血是"护甲之后、生命之前"的第二层缓冲，
     而它**不被回合结束清空**（见 battle.js 的 gainVhp）。所以这一场不是
     "拼一回合的输出"，而是"你每回合必须打穿它的虚血、还要压得过它的积累" ——
     拖得越久、它的虚血越厚，逼你不要留牌等大招。
     数值口径（0 难度分、第 2 层）：基础 10 → 层内 ×1.2 ≈ 12，与暴君的碾压 12/大地震击 8×2 同档。 */
  boss_hollow: {
    name: '空洞守望者', sprite: 'boss_hollow', hp: [96, 96], act: 2, boss: true, body: 1.9,
    moves: {
      /* 2026-10-17 产品定值（**基础值**，第 2 层再吃 ×1.17 缩放 → 显示约 20）：
         基础攻击力 17；buff 意图**固定**为「赐予自身 1 层力量 + 1 层敏捷」；护盾 10。
         之所以要"固定"：原来 buff 分成加虚血/召唤/减益三种，抽到哪一手全看运气，
         强度方差太大。现在它的成长路线只有一条 —— 每轮稳定 +1 力 +1 敏，
         而敏捷会让它的护盾越长越厚，逼你尽早打掉它。 */
      crush: A('穿空', 17),
      loom: { name: '虚影叠生', intent: 'buff', blk: 10, fx: [{ t: 'buff', k: 'strength', v: 1 }, { t: 'buff', k: 'dexterity', v: 1 }] },
      guard: { name: '虚壁', intent: 'defend', blk: 10 },
      /* 保留一手减益：让它有"逼你算账"的时刻，但不抢 buff 的位置 */
      wither: { name: '枯萎凝视', intent: 'debuff', fx: [{ t: 'debuff', k: 'vulnerable', v: 2 }] },
    },
    /* AI 严格交替：每两轮必出一次 buff（固定成长），中间夹一次攻击/护盾/减益。
       用固定 pattern 而不是 rng —— 成长型 Boss 一旦靠运气滚起来，方差会失控。 */
    ai: (e, t) => ['crush', 'loom', 'guard', 'loom', 'wither', 'loom'][t % 6],
    /* 产品指定：**每轮行动结束后**获得 2 点虚血。与招式无关 —— 哪怕这轮它在加甲/减益也照拿。
       见 battle.js 的 enemyTurn 里 `afterAct` 那一段。 */
    afterAct: { vhp: 2 },
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
      onslaught: { name: '连环撕裂', intent: 'attack', dmg: 6, hits: 3 },
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
  /* ⚠️ 遭遇战强度的两条硬约束（2026-10-17 加，测试 AM 段守着）：
     ① **单体递增**：同一层里 weak ≤ strong ≤ elite ≤ boss 的"单只怪最重一击"必须递增。
     ② **合计封顶**：一个遭遇里所有怪同时打最重一招的总和，不得超过该层上限
        （`ENCOUNTER_DMG_CAP`）。
     为什么加：玩家实测第 1 层开局就撞上**两只吸血蝙蝠**（4×2 各一发 = 16 点/回合），
     比该层 Boss 的单回合输出还高 —— 而那时玩家只有 5 张牌。梯度应当是
     "从地图开始到临近 Boss 逐步加压"，不是"开局随机抽到最狠的那一档"。
     改数值后跑 `node tools/enemy-damage-report.mjs` 与测试 AM 段复核。 */
  1: {
    /* 第 1 层合计上限 14（`ENCOUNTER_DMG_CAP`）。这里的每个组合都是按
       "最重一击 × 层级倍率，逐只相加 ≤ 14" 算过的 —— 改数值请重跑测试 AM2。
       注意 weak 档里已经有 slime(9)/spider(9) 这两个单体峰值，
       所以 strong 档必须至少保持 9 的单体，否则 AM1（单体递增）会红。 */
    weak: [['slime'], ['bat'], ['spider'], ['worm'], ['ghost', 'bat'], ['grave_rat']],
    strong: [['slime', 'ghost'], ['guard'], ['spider', 'ghost'], ['ghost', 'spider'], ['worm', 'guard']],
    elite: [['slime_big'], ['skeleton_king'], ['skeleton_king', 'ghost']],
    boss: [['boss_eye']],
  },
  2: {
    weak: [['crabdemon'], ['monk'], ['witch'], ['bog_walker']],
    /* 三小怪关卡（2026-10-17）：攻击意图每轮 ≤2，靠三只怪的轮序错开保证。
       单轮合计 = 盾兵(7) + 弩手(9) = 16 ≤ cap 24；碑灵不攻击。
       这三只**都没有召唤能力** —— 多出第四只就会破掉"≤2 攻击意图"的约束。 */
    strong: [['golem'], ['dwarf'], ['guard_elite'], ['squad_singer', 'squad_shield', 'squad_crossbow'], ['witch', 'witch']],
    elite: [['spider_queen'], ['lich'], ['witch', 'witch']],
    /* 第 2 层两个 Boss **平分出现概率**（与第 3 层同一套做法：
       往这个列表里加条目即可继续平分）。 */
    boss: [['boss_tyrant'], ['boss_hollow']],
  },
  3: {
    weak: [['demonling'], ['noble'], ['statue'], ['bone_choir'], ['cinder_wraith']],
    /* 互补双怪「守碑人 + 无名剑士」在这里。
       单轮合计最坏 = 守碑人 11 + 剑士 16(6×2 或 9+力量) ≈ 27 ≤ cap 34。 */
    strong: [['warrior', 'demonling'], ['statue', 'noble'], ['ward_keeper', 'sword_nameless'],
             ['gargoyle'], ['soul_lantern', 'noble']],
    /* 深渊之喉 2026-10-17 从第 4 层搬到这里（数值已按第 3 层重配）。 */
    elite: [['gargoyle'], ['lich'], ['statue', 'demonling'], ['abyss_priest'], ['abyss_maw']],
    // 第 3 层的两个 Boss **平分出现概率** —— 往这个列表里加条目即可继续平分
    boss: [['boss_lord'], ['boss_frostqueen']],
  },
  4: {
    weak: [['demonling', 'demonling'], ['noble', 'demonling'], ['void_herald'], ['abyss_spawn']],
    /* 互补双怪「噬魂藤 + 牵丝者」：这一对的最优解与第 3 层那对**相反** ——
       牵丝者脆、被喂的藤才是威胁，所以这里先秒牵丝者。
       单轮合计最坏 = 藤 22(11×2) + 牵丝者 14 + 2 力量成长 ≈ 38 ≤ cap 44。 */
    strong: [['warrior', 'noble'], ['soul_vine', 'thread_puller'], ['statue', 'warrior'],
             ['warrior', 'demonling'], ['void_shard', 'demonling']],
    // 深渊之喉搬去第 3 层后，这里补一个"双精英"维持精英池数量
    elite: [['gargoyle', 'demonling'], ['spider_queen', 'lich'], ['gargoyle', 'statue'], ['warrior', 'gargoyle']],
    boss: [['boss_abyss']],
  },
};

/** 每层「单回合总伤害」上限（方案 B）。
 *  第 1 层定 **14**（不是 16）：16 正好等于"两只吸血蝙蝠"的合计，也就是玩家投诉的那个数 ——
 *  上限卡在边界上等于没管。14 能让开局只出现"一只蝙蝠 + 一只小怪"这种量级。
 *  后续层按 ≈1.5 倍递增，与 ACT_ATK_STEP 的曲线一致。 */
export const ENCOUNTER_DMG_CAP = { 1: 14, 2: 24, 3: 34, 4: 44 };

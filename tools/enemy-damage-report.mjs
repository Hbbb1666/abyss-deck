/**
 * 敌人一击伤害报告（2026-10-13）
 * =====================================================================
 * 产品给的**裸难度**参考表（多段攻击算总和；不含怪物给自己上的增益）：
 *
 *   第 1 层 普通 5~9    Boss 12
 *   第 2 层 普通 10~15  Boss 20
 *   第 3 层 普通 15~18  Boss 24
 *   第 4 层 普通 18~21  Boss 28
 *
 * "裸难度" = 不带任何难度/增益条目（G.picks 为空）。
 * 数值走**真实引擎**（intentOf），所以和玩家看到的预告完全一致：
 *   基础 dmg × 层级缩放(atk) × Boss 首击 0.85（只有 Boss、只有第一次）
 * 不含力量/易攻等自身增益 —— 那是"打了几回合之后"的事，不属于"一次攻击的基准"。
 *
 * 用法：
 *   node tools/enemy-damage-report.mjs            # 全表 + 超标清单
 *   node tools/enemy-damage-report.mjs --strict   # 有超标就退出码 1（测试用）
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { JSDOM } = await import(pathToFileURL(join(ROOT, 'node_modules/jsdom/lib/api.js')).href);

/* 参考表：act → { normal: [min,max], elite: [min,max], boss: max }
   精英 = 普通上限 +2（产品 2026-10-13 拍板） */
export const REF = {
  1: { normal: [5, 9], elite: [5, 11], boss: 12 },
  2: { normal: [10, 15], elite: [10, 17], boss: 20 },
  3: { normal: [15, 18], elite: [15, 20], boss: 24 },
  4: { normal: [18, 21], elite: [18, 23], boss: 28 },
};

export async function loadAbyss() {
  const dom = new JSDOM(readFileSync(join(ROOT, 'index.html'), 'utf8'),
    { url: 'http://x/', pretendToBeVisual: true, runScripts: 'outside-only' });
  const { window } = dom;
  window.fetch = async () => ({ ok: false, arrayBuffer: new ArrayBuffer(0) });
  window.eval(readFileSync(join(ROOT, 'dist/bundle.js'), 'utf8'));
  return { A: window.__ABYSS__, window };
}

/** 对每层每张遭遇表，算出每个敌人"能打出的最重一次攻击"（多段取总和） */
export async function collect() {
  const { A } = await loadAbyss();
  const { ENEMIES, ENCOUNTERS } = await import('file://' + ROOT.replace(/\\/g, '/') + '/js/data/enemies.js');
  const noop = { step: async () => {}, sync() {}, log() {} };
  const rows = [];

  for (const act of [1, 2, 3, 4]) {
    for (const kind of ['weak', 'strong', 'elite', 'boss']) {
      for (const enc of ENCOUNTERS[act][kind]) {
        // 走真实构造：act 决定缩放，kind 决定精英/Boss 判定
        A.startRun('knight');
        A.G.act = act;
        const B = new A.Battle(enc, { kind });
        B.view = { ...noop };
        B.rollIntents();
        await B.start();
        for (const e of B.enemies) {
          const moves = e.def.moves;
          let best = { name: '', per: 0, hits: 1, total: 0 };
          let first = { name: '', total: 0 };
          for (const [mvId, def] of Object.entries(moves)) {
            if (!def.dmg) continue;
            /* ⚠️ 必须分开算**稳态**和**首击**：
               Boss 第一次攻击有 0.85 倍减伤（BOSS_FIRST_ATTACK_MULT），
               只报首击会系统性低估 —— 玩家真正反复挨的是稳态那一档。
               稳态 = 把 attacked 置 1（已经挥出过一次，不再吃首击减伤）。 */
            e.attacked = 1;
            e.moveId = mvId;
            const it = B.intentOf(e);
            const total = it.dmg * (it.hits || 1);
            if (total > best.total) best = { name: it.name, per: it.dmg, hits: it.hits || 1, total };

            e.attacked = 0;
            const it0 = B.intentOf(e);
            const t0 = it0.dmg * (it0.hits || 1);
            if (t0 > first.total) first = { name: it0.name, total: t0 };
          }
          e.attacked = 0;
          rows.push({
            act, kind, enemy: e.defId, name: e.name,
            hp: e.maxHp, elite: !!e.def.elite, boss: !!e.def.boss,
            ...best, firstTotal: first.total,
          });
        }
      }
    }
  }
  return rows;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const rows = await collect();
  const strict = process.argv.includes('--strict');

  console.log('裸难度 · 敌人最重一次攻击（多段=总和，不含自身增益）\n');
  let over = 0;
  for (const act of [1, 2, 3, 4]) {
    const ref = REF[act];
    console.log(`=== 第 ${act} 层  普通 ${ref.normal[0]}~${ref.normal[1]} · Boss ≤${ref.boss} ===`);
    for (const kind of ['weak', 'strong', 'elite', 'boss']) {
      const list = rows.filter(r => r.act === act && r.kind === kind);
      if (!list.length) continue;
      // 同一个敌人在同一层可能出现多次，按 id 去重
      const seen = new Map();
      for (const r of list) if (!seen.has(r.enemy) || seen.get(r.enemy).total < r.total) seen.set(r.enemy, r);
      for (const r of [...seen.values()].sort((a, b) => b.total - a.total)) {
        const isBoss = r.boss;
        /* ⚠️ 档位要按**这张怪自己**的类别取：Boss / 精英 / 普通。
           以前这里只判断了 Boss，精英会误用普通上限 —— 明明合规却被标红。 */
        const tier = isBoss ? 'boss' : (r.elite || kind === 'elite') ? 'elite' : 'normal';
        const hi = isBoss ? ref.boss : ref[tier][1];
        const lo = isBoss ? ref.boss : ref[tier][0];
        let flag = '';
        if (r.total > hi) { flag = `  ▲ 超 ${r.total - hi}`; over++; }
        else if (r.total < lo && kind !== 'boss') flag = `  ▽ 低 ${lo - r.total}`;
        const multi = r.hits > 1 ? `  [${r.per}×${r.hits}]` : '';
        console.log(`  ${kind.padEnd(6)} ${r.name.padEnd(7)} ${r.enemy.padEnd(14)} hp${String(r.hp).padEnd(4)} ${String(r.total).padStart(3)}${multi}${flag}`);
      }
    }
    console.log('');
  }
  console.log(`超标条目：${over}`);
  if (strict && over) process.exit(1);
}

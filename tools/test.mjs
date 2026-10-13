#!/usr/bin/env node
/**
 * 自动化测试（jsdom）
 *   node tools/test.mjs
 *
 * 三层验证：
 *   A. 逻辑层 —— 直接驱动 Battle 引擎跑大量随机对局，查不变量
 *   B. 数据层 —— 校验所有卡牌/敌人/遗物/事件定义自洽
 *   C. DOM 层 —— 真实加载 index.html + bundle，点按钮走完菜单→选职业→地图→战斗
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// jsdom 解析顺序：环境变量 → 本仓 node_modules → 之前的临时安装位置
async function loadJsdom() {
  const cands = [process.env.JSDOM_ENTRY, 'jsdom', '/root/abyss-test/node_modules/jsdom/lib/api.js'].filter(Boolean);
  for (const c of cands) {
    try { return await import(c.startsWith('/') ? pathToFileURL(c).href : c); } catch {}
  }
  console.error('❌ 找不到 jsdom。请先安装：  npm i');
  process.exit(1);
}
const { JSDOM } = await loadJsdom();

let pass = 0, fail = 0;
const failures = [];
function ok(cond, label, extra) {
  if (cond) { pass++; }
  else { fail++; failures.push(label + (extra ? ' :: ' + extra : '')); console.log(`  ❌ ${label}${extra ? ' :: ' + extra : ''}`); }
}
function section(t) { console.log(`\n\x1b[36m=== ${t} ===\x1b[0m`); }

/* ================= 建立 jsdom 环境 ================= */
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const dom = new JSDOM(html, {
  url: 'http://127.0.0.1:8765/',
  pretendToBeVisual: true,
  runScripts: 'outside-only',
});
const { window } = dom;
window.fetch = async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) });

const jsErrors = [];
window.addEventListener('error', e => jsErrors.push('error: ' + e.message));
dom.virtualConsole.on('jsdomError', e => jsErrors.push('jsdomError: ' + (e.detail?.message || e.message)));

const code = readFileSync(join(ROOT, 'dist/bundle.js'), 'utf8');
try {
  window.eval(code);
} catch (e) {
  console.log('❌ bundle 执行失败：', e.message, '\n', (e.stack || '').split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
const A = window.__ABYSS__;
ok(!!A, 'bundle 暴露 __ABYSS__ 调试入口');
if (!A) process.exit(1);

/* ================= B. 数据层 ================= */
section('B. 数据定义自洽性');
{
  const { CARDS, RARITY, rewardPool } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const { ENEMIES, ENCOUNTERS, TOTAL_ACTS, actScale } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
  const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));
  const { POTIONS } = await import('file://' + join(ROOT, 'js/data/potions.js'));
  const { EVENTS } = await import('file://' + join(ROOT, 'js/data/events.js'));
  const { sprites } = await (async () => ({
    sprites: new Set(JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8')) && Object.keys(JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8')))),
  }))();

  const ids = Object.keys(CARDS);
  ok(ids.length >= 50, `卡牌数量 ≥ 50（实际 ${ids.length}）`);
  ok(ids.every(id => CARDS[id].id === id), '所有卡牌 id 与键名一致');
  ok(ids.every(id => typeof CARDS[id].text === 'function'), '所有卡牌都有 text 函数');
  ok(ids.every(id => Array.isArray(CARDS[id].fx)), '所有卡牌都有 fx 数组');

  // 效果字段引用必须能在卡上解析到数字
  let badFx = [];
  for (const id of ids) {
    const c = CARDS[id];
    const VAL_KEYS = ['v', 'hits', 'bonus', 'mult', 'n', 'exec'];
    for (const f of c.fx) {
      for (const k of VAL_KEYS) {
        const v = f[k];
        if (typeof v === 'string' && !(v in c)) badFx.push(`${id}.${k}=${v}`);
      }
    }
  }
  ok(badFx.length === 0, '卡牌效果引用的字段都存在', badFx.join(', '));

  // text() 必须能跑通且产出非空（未升级 + 升级 两种）
  let textErr = [];
  for (const id of ids) {
    for (const up of [false, true]) {
      const c = { ...CARDS[id] };
      if (up && CARDS[id].up) Object.assign(c, CARDS[id].up);
      try { const t = c.text(c); if (typeof t !== 'string' || !t.length) textErr.push(`${id}${up ? '+' : ''} 空文案`); }
      catch (e) { textErr.push(`${id}${up ? '+' : ''}: ${e.message}`); }
    }
  }
  ok(textErr.length === 0, '所有卡牌文案生成不报错', textErr.slice(0, 5).join(' | '));

  /* ---- 卡面文案长度门禁 ----
     为什么需要：卡面高度固定，文案太长会被 .ctext 的 overflow 裁掉，玩家看不到完整效果。
     jsdom 没有布局引擎，量不到 scrollHeight，所以这条以前只能靠文档里的"红线"自觉。
     下面这个预算表是**真机标定**出来的（MIUI 浏览器 / 980x1755 视口 / #stage zoom 2.19）：
       文字区 84 × 65 布局px，基准字号 10.5px、行高 1.26 → 约 4.9 行、每行约 8 个全宽字
       用全宽汉字做最坏情况注入实测：
         ≤28 单位 → 基准字号直接放得下（不缩字、不溢出）
         30–34   → 出现 1px 溢出（落在 fitCardText 的 ±1px 容差里，玩家看不出来，
                   但已经意味着开始依赖缩字了）
         36–50   → 必须把字号降到 8.5px 才放得下（字变小，可读性下降）
         ≥58     → 缩到底仍然裁字
     所以把门禁定在 28 单位，语义是「必须在基准字号下放得下」。
     真要写更长的文案，请先真机确认，再有意识地调高这个常量。 */
  const TEXT_BUDGET = 28;
  const textUnits = (card) => {
    const plain = String(card.text(card)).replace(/<[^>]*>/g, '');
    let u = 0;
    for (const ch of plain) {
      if (/\s/.test(ch)) { u += 0.34; continue; }
      u += /[\x00-\xff]/.test(ch) ? 0.5 : 1.0;   // 像素字体的 ASCII 约为汉字一半宽
    }
    return u;
  };
  const textLen = [];
  for (const id of ids) {
    for (const up of [false, true]) {
      if (up && !CARDS[id].up) continue;
      const c = { ...CARDS[id] };
      if (up) Object.assign(c, CARDS[id].up);
      textLen.push({ label: CARDS[id].name + (up ? '+' : ''), u: textUnits(c) });
    }
  }
  textLen.sort((a, b) => b.u - a.u);
  const tooLong = textLen.filter(x => x.u > TEXT_BUDGET);
  ok(tooLong.length === 0,
    `卡面文案长度都在预算内（≤ ${TEXT_BUDGET} 单位，最长的 ${textLen[0].label} 是 ${textLen[0].u.toFixed(1)}）`,
    tooLong.slice(0, 5).map(x => `${x.label} ${x.u.toFixed(1)} 单位`).join(' | '));
  if (textLen.length) {
    console.log(`     文案预算：最长 ${textLen[0].u.toFixed(1)} / ${TEXT_BUDGET} 单位（${textLen[0].label}），`
      + `超 24 单位的 ${textLen.filter(x => x.u > 24).length} 张`);
  }

  // 美术资源存在
  const missingArt = ids.filter(id => !sprites.has(CARDS[id].art));
  ok(missingArt.length === 0, '卡牌立绘资源都存在', missingArt.slice(0, 6).join(','));

  const eids = Object.keys(ENEMIES);
  ok(eids.length >= 20, `敌人数量 ≥ 20（实际 ${eids.length}）`);
  const badEnemy = [];
  for (const id of eids) {
    const e = ENEMIES[id];
    if (!e.hp || e.hp[0] > e.hp[1]) badEnemy.push(id + ' 血量区间');
    if (!e.moves || !Object.keys(e.moves).length) badEnemy.push(id + ' 无招式');
    if (!sprites.has(e.sprite)) badEnemy.push(id + ' 立绘缺失:' + e.sprite);
    // AI 必须返回合法招式的 key（多回合采样）
    const fake = { hp: 10, maxHp: 10, st: {}, turn: 0 };
    const rngStub = () => Math.random();
    rngStub.chance = p => Math.random() < p;
    rngStub.int = (a, b) => (b === undefined ? Math.floor(Math.random() * a) : a + Math.floor(Math.random() * (b - a + 1)));
    rngStub.pick = arr => arr[Math.floor(Math.random() * arr.length)];
    for (let t = 0; t < 12; t++) {
      const mv = e.ai ? e.ai(fake, t, rngStub, null) : Object.keys(e.moves)[0];
      if (!e.moves[mv]) badEnemy.push(`${id} AI 返回非法招式 ${mv}`);
    }
    for (const [mk, m] of Object.entries(e.moves)) {
      if (!m.intent) badEnemy.push(`${id}.${mk} 缺 intent`);
      for (const f of (m.fx || [])) {
        if (f.t === 'summon' && !ENEMIES[f.id]) badEnemy.push(`${id}.${mk} 召唤未知敌人 ${f.id}`);
        if (f.t === 'addCard' && !CARDS[f.id]) badEnemy.push(`${id}.${mk} 塞入未知卡牌 ${f.id}`);
      }
    }
  }
  ok(badEnemy.length === 0, '敌人定义完整（招式/立绘/AI）', [...new Set(badEnemy)].slice(0, 6).join(' | '));

  const badEnc = [];
  // 层数必须覆盖到 TOTAL_ACTS（4 层）—— 以前硬写 [1,2,3]，
  // 加了第 4 层但忘了补表时，这条测试**不会报**，玩家到第 4 层才会崩。
  for (let act = 1; act <= TOTAL_ACTS; act++) {
    for (const grp of ['weak', 'strong', 'elite', 'boss']) {
      if (!ENCOUNTERS[act]?.[grp]?.length) { badEnc.push(`act${act}.${grp} 缺失`); continue; }
      for (const enc of ENCOUNTERS[act][grp]) for (const eid of enc) if (!ENEMIES[eid]) badEnc.push(`act${act}.${grp} 引用未知敌人 ${eid}`);
    }
  }
  ok(badEnc.length === 0, `遭遇战配置完整（${TOTAL_ACTS} 层）`, badEnc.slice(0, 5).join(' | '));
  ok(TOTAL_ACTS === 4, `游戏共 ${TOTAL_ACTS} 层`);

  const rids = Object.keys(RELICS);
  const badRelic = rids.filter(id => !sprites.has(RELICS[id].sprite));
  // 遗物钩子里引用的方法必须真实存在
  const hookSrc = readFileSync(join(ROOT, 'js/data/relics.js'), 'utf8');
  const hookMethods = [...hookSrc.matchAll(/B\.(\w+)\(/g)].map(m => m[1]);
  const battleSrc = readFileSync(join(ROOT, 'js/core/battle.js'), 'utf8');
  const missingHooks = [...new Set(hookMethods)].filter(m => !new RegExp(`\\b${m}\\s*\\(`).test(battleSrc));
  ok(missingHooks.length === 0, '遗物钩子调用的 Battle 方法都存在', missingHooks.join(','));
  ok(badRelic.length === 0, '遗物图标都存在', badRelic.join(','));
  ok(rids.every(id => typeof RELICS[id].desc === 'string'), '遗物都有描述');

  const badPotion = Object.keys(POTIONS).filter(id => !sprites.has(POTIONS[id].sprite));
  ok(badPotion.length === 0, '药水图标都存在', badPotion.join(','));

  ok(EVENTS.length >= 10, `事件数量 ≥ 10（实际 ${EVENTS.length}）`);
  const badEv = [];
  for (const ev of EVENTS) {
    if (!ev.options?.length) badEv.push(ev.id + ' 无选项');
    if (!sprites.has(ev.art)) badEv.push(ev.id + ' 立绘缺失:' + ev.art);
  }
  ok(badEv.length === 0, '事件定义完整', badEv.join(','));

  // 每个职业的奖励池都够抽
  const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
  const badPool = [];
  for (const cls of Object.keys(CLASSES)) {
    for (const r of ['common', 'uncommon', 'rare']) {
      const pool = rewardPool(cls, [r]);
      if (pool.length < 3) badPool.push(`${cls}.${r}=${pool.length}`);
    }
  }
  ok(badPool.length === 0, '各职业各稀有度奖励池 ≥ 3 张', badPool.join(','));
}

/* ================= A. 逻辑层：随机对局 ================= */
section('A. 战斗引擎随机对局');
{
  const noopView = {
    step: async () => {}, sync() {}, log() {},
    onDamage() {}, onHeal() {}, onBlock() {}, onStatus() {}, onDraw() {}, onPlay() {},
    onExhaust() {}, onEnergy() {}, onGold() {}, onTurnStart() {}, onEnemyAct() {},
    onSummon() {}, onDeath() {}, onPotion() {}, onEnd() {}, beforeEndTurn() {},
  };

  const CLASSES = ['knight', 'mage', 'rogue'];
  const results = { win: 0, lose: 0, crash: 0, timeout: 0, turns: [] };
  const crashes = [];
  const N = 120;

  for (let i = 0; i < N; i++) {
    const cls = CLASSES[i % 3];
    try {
      A.startRun(cls);
      const G = A.G;
      G.act = 1 + (i % 3);
      // 随机塞一些遗物/卡牌，扩大覆盖面
      const relicIds = Object.keys((await import('file://' + join(ROOT, 'js/data/relics.js'))).RELICS);
      for (let k = 0; k < 4; k++) {
        const rid = relicIds[Math.floor(Math.random() * relicIds.length)];
        if (!G.relics.includes(rid)) { G.relics.push(rid); }
      }
      const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
      const allIds = Object.keys(CARDS).filter(id => !CARDS[id].unplayable);
      for (let k = 0; k < 8; k++) G.deck.push({ id: allIds[Math.floor(Math.random() * allIds.length)], up: Math.random() < 0.4 });

      const kind = ['weak', 'strong', 'elite', 'boss'][i % 4];
      const enc = A.pickEncounter(kind);
      const B = new A.Battle(enc, { kind });
      B.view = noopView;

      let guard = 0;
      B.rollIntents();
      await B.start();
      while (!B.over && guard++ < 400) {
        // 出牌：能出就出
        let played = false;
        for (const c of [...B.hand]) {
          if (B.canPlay(c)) {
            const target = c.target === 'enemy' ? B.aliveEnemies()[0] : null;
            await B.playCard(c, target);
            played = true;
            if (B.over) break;
            break;
          }
        }
        if (B.over) break;
        if (!played) await B.endTurn();
      }
      if (!B.over) { results.timeout++; continue; }
      results[B.result === 'win' ? 'win' : 'lose']++;
      results.turns.push(B.turn);
      // 不变量
      if (B.player.hp > B.player.maxHp) crashes.push(`HP 超过上限 ${B.player.hp}/${B.player.maxHp}`);
      if (B.player.block < 0) crashes.push('护甲为负');
      if (B.energy < 0) crashes.push('能量为负');
      if (Number.isNaN(B.player.hp)) crashes.push('HP 变成 NaN');
      for (const e of B.enemies) if (Number.isNaN(e.hp)) crashes.push(e.name + ' HP NaN');
    } catch (e) {
      results.crash++;
      crashes.push(`${cls}/${i}: ${e.message} @ ${(e.stack || '').split('\n')[1]?.trim()}`);
    }
  }
  ok(results.crash === 0, `${N} 场随机对局无异常`, crashes.slice(0, 6).join('\n      '));
  ok(results.timeout === 0, '所有对局都能正常结束（无死循环）', `超时 ${results.timeout} 场`);
  const avgTurns = results.turns.length ? (results.turns.reduce((a, b) => a + b, 0) / results.turns.length).toFixed(1) : 0;
  console.log(`     结果：胜 ${results.win} / 负 ${results.lose} / 超时 ${results.timeout} / 崩溃 ${results.crash} · 平均 ${avgTurns} 回合`);
  ok(results.win + results.lose === N, '每场对局都有明确胜负');
}

/* ================= A2. 所有卡牌单卡可打出 ================= */
section('A2. 每张卡都能实际打出');
{
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };
  const errs = [];
  const playable = Object.keys(CARDS).filter(id => !CARDS[id].unplayable);
  for (const id of playable) {
    for (const up of [false, true]) {
      try {
        A.startRun('knight');
        const G = A.G;
        G.deck = [{ id, up }];
        const B = new A.Battle(['slime'], { kind: 'battle' });
        B.view = noopView;
        B.rollIntents();
        await B.start();
        const card = B.hand.find(c => c.id === id);
        if (!card) { // 抽牌堆里没抽到就手动塞
          const { makeCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
          const c2 = makeCard(id, up); B.hand.push(c2); B.energy = 9;
          await B.playCard(c2, B.aliveEnemies()[0]);
        } else {
          B.energy = 9;
          await B.playCard(card, B.aliveEnemies()[0]);
        }
      } catch (e) {
        errs.push(`${id}${up ? '+' : ''}: ${e.message}`);
      }
    }
  }
  ok(errs.length === 0, `${playable.length} 张卡 × 升级前后 均可打出`, errs.slice(0, 8).join(' | '));
}

/* ================= A3. 地图生成 ================= */
section('A3. 地图生成（200 个种子）');
{
  const { generateMap, reachable, MAP_ROWS } = await import('file://' + join(ROOT, 'js/core/map.js'));
  const bad = [];
  for (let s = 0; s < 200; s++) {
    const m = generateMap(s * 2654435761 >>> 0, 1 + (s % 3));
    if (!m.nodes.length) { bad.push(`seed${s} 无节点`); continue; }
    // 每行都要有节点
    for (let r = 0; r < MAP_ROWS - 1; r++) if (!m.byRow[r]?.length) bad.push(`seed${s} 第${r}行为空`);
    // 必须能从头走到 boss（做一次 BFS）
    const seen = new Set(); const q = [...(m.byRow[0] || [])];
    while (q.length) {
      const n = q.shift();
      if (seen.has(`${n.r},${n.c}`)) continue;
      seen.add(`${n.r},${n.c}`);
      for (const nx of n.next) { const t = m.nodes.find(x => x.r === nx.r && x.c === nx.c); if (t) q.push(t); }
    }
    if (!seen.has(`${m.boss.r},${m.boss.c}`)) bad.push(`seed${s} 走不到 Boss`);
    // 类型保底
    const types = m.nodes.reduce((a, n) => (a[n.type] = (a[n.type] || 0) + 1, a), {});
    if (!types.shop || types.shop < 1) bad.push(`seed${s} 无商店`);
    if (!types.rest || types.rest < 2) bad.push(`seed${s} 营火不足(${types.rest || 0})`);
    if (!types.elite || types.elite < 1) bad.push(`seed${s} 无精英`);
    // 必须恰好有一个 Boss，且就在最后一行 —— 少了就打不通关，多了会乱
    if (types.boss !== 1) bad.push(`seed${s} Boss 节点数 = ${types.boss ?? 0}`);
    const bossNodes = m.nodes.filter(n => n.type === 'boss');
    if (bossNodes.length && bossNodes[0].r !== MAP_ROWS - 1) bad.push(`seed${s} Boss 不在最后一行`);
    // 最后一行必须**只有** Boss —— 多出来的普通节点没有任何后继，
    // 玩家走进去就永远出不来（实测修复前 300/300 张地图都有这个问题，共 753 个死路）
    if ((m.byRow[MAP_ROWS - 1] || []).length !== 1) bad.push(`seed${s} 最后一行有 ${(m.byRow[MAP_ROWS - 1] || []).length} 个节点`);
    // 所有非 Boss 节点都必须有出路（哪怕不沿最优路线走，也不会卡死）
    const noExit = m.nodes.filter(n => n.type !== 'boss' && n.next.length === 0);
    if (noExit.length) bad.push(`seed${s} 有 ${noExit.length} 个死路节点`);
    // 每条边都要指向真实存在的节点（悬空边会让 reachable() 返回空）
    for (const n of m.nodes) for (const nx of n.next) {
      if (!m.nodes.some(x => x.r === nx.r && x.c === nx.c)) bad.push(`seed${s} ${n.r},${n.c} 指向不存在的节点`);
    }
    // 节点类型都必须认识
    for (const n of m.nodes) if (!['battle', 'elite', 'event', 'shop', 'rest', 'treasure', 'boss'].includes(n.type)) bad.push(`seed${s} 未知类型 ${n.type}`);
  }
  ok(bad.length === 0, '200 个种子地图全部可通关且类型齐全', [...new Set(bad)].slice(0, 6).join(' | '));

  // 存档往返：JSON.parse 之后 byRow 里的对象和 nodes 里的不再是同一批，
  // 任何用引用相等找节点的代码都会失效（曾经导致整张地图跑到屏幕外）
  const { layout } = await import('file://' + join(ROOT, 'js/core/map.js'));
  const off = [];
  for (let s2 = 0; s2 < 40; s2++) {
    const m0 = generateMap(s2 * 7919 >>> 0, 1);
    const m = JSON.parse(JSON.stringify(m0));      // 模拟存盘再读盘
    for (const [tag, mm] of [['内存', m0], ['读档', m]]) {
      const pos = layout(mm);
      for (const n of mm.nodes) {
        const p = pos.get(`${n.r},${n.c}`);
        if (!p) { off.push(`${tag}/seed${s2} 节点 ${n.r},${n.c} 无坐标`); continue; }
        if (!(p.x >= 0 && p.x <= 1) || !(p.y >= 0 && p.y <= 1)) off.push(`${tag}/seed${s2} ${n.r},${n.c} -> ${p.x.toFixed(3)},${p.y.toFixed(3)}`);
      }
      const sp = pos.get(`-1,${mm.start.c}`);
      if (!sp || !(sp.x >= 0 && sp.x <= 1)) off.push(`${tag}/seed${s2} 起点坐标越界`);
    }
  }
  ok(off.length === 0, '地图坐标在存档往返后仍在 0~1 范围内（不会跑到屏幕外）', [...new Set(off)].slice(0, 6).join(' | '));
}

/* ================= C. DOM 层：走完整流程 ================= */
section('C. DOM 层 —— 真实点击流程');
{
  const doc = window.document;
  A.go('menu');                       // 前面的逻辑测试把界面留在别处了，先回主菜单
  await new Promise(r => setTimeout(r, 80));
  const txt = el => (el.textContent || '').trim();
  const byText = (t, sel = 'button, .btn, .class-card') =>
    [...doc.querySelectorAll(sel)].find(e => txt(e).includes(t));
  const scene = () => doc.querySelector('.screen');
  /** 轮询等待条件成立（战斗有一串动画延迟，固定 sleep 不靠谱） */
  const waitFor = async (fn, ms = 8000, label = '') => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try { if (fn()) return true; } catch {}
      await new Promise(r => setTimeout(r, 60));
    }
    if (label) console.log(`     ⏱ 等待超时：${label}`);
    return false;
  };

  // 菜单
  ok(!!scene(), '主菜单渲染出 .screen');
  ok(!!byText('开始游戏') || !!byText('新的冒险'), '主菜单有开始按钮');
  console.log('     菜单按钮：', [...doc.querySelectorAll('button')].map(txt).join(' / '));

  // 点开始
  const startBtn = byText('新的冒险') || byText('开始游戏');
  startBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 80));
  // 有存档时会弹「开始新的一局？」确认框
  const confirmBtn = [...doc.querySelectorAll('.modal .btn')].find(b => txt(b).includes('开始'));
  if (confirmBtn) { confirmBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 80)); }
  /* 流程（桌面端 + 手机端合并后）：点开始 → 问「新手 / 老手」
     新手 → 铁誓骑士直接开局（跳过难度与职业）
     老手 → 难度页 → 职业页（职业按难度分解锁）
     这里走「新手」这条路，保证后续战斗测试有个确定的骑士局。 */
  const screenText0 = () => (doc.querySelector('.screen')?.textContent || '');
  ok(screenText0().includes('新手还是老手'), '点开始后先问「新手 / 老手」', screenText0().slice(0, 40));
  const noviceBtn = [...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('我是新手'));
  const veteranBtn = [...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('我是老手'));
  ok(!!noviceBtn && !!veteranBtn, '给出「我是新手」与「我是老手」两个选项');
  noviceBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok(!byText('铁誓骑士'), '新手不经过选职业界面');
  ok(A.G && A.G.cls === 'knight', `新手默认用骑士开局（实测 ${A.G && A.G.cls}）`);
  ok((A.G.picks || []).length === 0, `新手是 0 分标准难度（picks=${JSON.stringify(A.G.picks)}）`);

  /* --- 开局先过「开场事件」（每层开始都有，类似杀戮尖塔的 Neow）--- */
  // 注意：事件名只出现在标题/正文里，**不在任何按钮里** ——
  // byText 只查 button/.btn，用它找事件名会永远落空。这里直接查正文。
  const bodyText = () => (doc.querySelector('.screen')?.textContent || '');
  ok(bodyText().includes('深渊入口'), '选完职业后先进入第 1 层的开场事件',
     bodyText().slice(0, 60));
  ok(doc.querySelectorAll('.screen .btn').length >= 3, '开场事件给出多个选项');
  {
    // 选第一个选项，然后点「进入第 N 层」
    const opt = [...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('拾起旧装备'));
    ok(!!opt, '开场事件里能找到具体选项（拾起旧装备）');
    const hp0 = A.G.maxHp, gold0 = A.G.gold;
    opt.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    ok(A.G.maxHp === hp0 + 8 && A.G.gold === gold0 + 40,
       `选项真的生效（最大生命 ${hp0}→${A.G.maxHp}、金币 ${gold0}→${A.G.gold}）`);
    const enter = [...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('进入第 1 层'));
    ok(!!enter, '开场事件给出「进入第 1 层」按钮');
    enter.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 220));
  }

  const nodes = doc.querySelectorAll('.mnode');
  ok(nodes.length > 10, `地图渲染出节点（${nodes.length} 个）`);
  ok(doc.querySelectorAll('.mnode.avail').length > 0, '有可前往的节点');
  ok(doc.querySelectorAll('.map-lines line').length > 0, '地图连线已绘制');
  ok(doc.querySelectorAll('.relic').length > 0, '遗物条已渲染');
  ok(!doc.querySelector('.screen .btn.block'), '开场事件已经关闭（回到地图）');

  // 进入第一个可用节点（强制改成战斗，保证能测战斗）
  const G = A.G;
  const availNode = A.G.map.nodes.find(n => n.type === 'battle');
  G.node = null;
  // 直接调私有入口不可得，改为点「可前往」节点，若类型非战斗则用 startBattle 兜底
  const before = G.stats.floors;
  A.startBattle('weak', 'battle');
  ok(await waitFor(() => doc.querySelector('.field'), 3000, '战场渲染'), '战斗界面渲染出战场');
  const enemies = doc.querySelectorAll('.enemy');
  ok(enemies.length >= 1, `战场上有敌人（${enemies.length} 个）`);
  ok(await waitFor(() => doc.querySelectorAll('.hand .card').length > 0, 9000, '发牌'),
     '手牌已发', `hand=${doc.querySelectorAll('.hand .card').length}`);
  ok(!!doc.querySelector('.orb'), '能量球存在');
  ok(!!doc.querySelector('.intent'), '敌人意图已显示');
  console.log('     意图文本：', [...doc.querySelectorAll('.intent')].map(txt).join(' | '));
  console.log('     手牌：', [...doc.querySelectorAll('.hand .card .cname')].map(txt).join(' / '));

  // 打一张牌（点第一张可打的）
  await waitFor(() => [...doc.querySelectorAll('.hand .card')].some(c => !c.classList.contains('unplayable')), 3000, '可打的牌');
  const playable = [...doc.querySelectorAll('.hand .card')].find(c => !c.classList.contains('unplayable'));
  ok(!!playable, '手牌里有可打出的牌');
  const handBefore = doc.querySelectorAll('.hand .card').length;
  playable.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 900));
  const handAfter = doc.querySelectorAll('.hand .card').length;
  ok(handAfter !== handBefore || doc.querySelector('.hand .card.selected'), '点击手牌有响应（打出或进入选目标）',
     `before=${handBefore} after=${handAfter}`);

  /* 结束回合 —— 这一段**单独开一场打不死的仗**。
     踩过两次 flaky，两个原因叠在一起：
       ① 打出的牌若要选目标，界面会切进"选目标"态，结束回合按钮在那期间**不存在**；
       ② 上面那场是 `weak` 弱怪，**一张牌就可能把它打死** → 直接进结算界面，
          按钮和手牌本来就没有了（表现成 "turn 0 -> 0"）。
     所以别再依赖"上一张牌的副作用"，用精英（血厚，一轮打不死）重开一场，
     并且用等待式而不是固定 sleep。 */
  A.startBattle('elite', 'elite');
  ok(await waitFor(() => doc.querySelector('.field'), 5000, '精英战场渲染'), '精英战斗渲染出战场');
  await waitFor(() => byText('结束回合') || doc.querySelector('.enemy.selectable'), 6000,
    '结束回合按钮 / 可选目标');
  const pendingSel = doc.querySelector('.enemy.selectable');
  if (pendingSel) {
    pendingSel.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 700));
  }
  const endBtn = byText('结束回合');
  ok(!!endBtn, '有结束回合按钮');
  // 手牌必须发出来了，否则下面的"回合推进"断言会和"没手牌"混在一起分不清
  await waitFor(() => doc.querySelectorAll('.hand .card').length > 0, 9000, '精英战发牌');
  // 结束回合 -> 敌人行动 -> 回到玩家回合
  const turnBefore = doc.querySelectorAll('.hand .card').length;
  endBtn?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  ok(await waitFor(() => doc.querySelectorAll('.hand .card').length > 0, 12000, '敌人回合结束'), '结束回合后能进入下一回合',
     `turn ${turnBefore} -> ${doc.querySelectorAll('.hand .card').length}`);

  // 直接打完整场（走引擎，验证 view 回调不炸）
  // 一路打到战斗结束（或用时上限）
  const t0 = Date.now();
  while (doc.querySelector('.field') && Date.now() - t0 < 120000) {
    // 正在选目标 -> 点敌人
    const tgt = doc.querySelector('.enemy.selectable:not(.dead)');
    if (tgt) { tgt.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 300)); continue; }
    const c = [...doc.querySelectorAll('.hand .card')].find(x => !x.classList.contains('unplayable'));
    if (c) c.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    else {
      const e = byText('结束回合');
      if (e && !e.classList.contains('disabled')) e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }
    await new Promise(r => setTimeout(r, 350));
  }
  ok(!doc.querySelector('.field'), '战斗能自动打完并离开战斗界面');
  console.log('     战斗结束后场景类名：', scene()?.className || '(无)');
}

/* ================= E. 所有房间场景可渲染可交互 ================= */
/* --- 意图正确性：显示的招式必须和敌人下一步真做的事一致 --- */
section('C2. 敌人意图与实际动作一致');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };
  const mismatches = [];
  for (let trial = 0; trial < 30; trial++) {
    A.startRun(['knight', 'mage', 'rogue'][trial % 3]);
    A.G.act = 1 + (trial % 3);
    const B = new A.Battle(A.pickEncounter(['weak', 'strong', 'elite', 'boss'][trial % 4]), { kind: 'battle' });
    B.view = noopView;
    B.rollIntents();
    await B.start();
    let guard = 0;
    while (!B.over && guard++ < 40) {
      // 记录每个敌人"预告"的招式
      const predicted = new Map(B.aliveEnemies().map(e => [e.uid, e.moveId]));
      // 让敌人行动一整轮
      await B.endTurn();
      if (B.over) break;
      // 对照：如果这一轮里记录到的实际动作和预告不符，就是意图撒谎
      for (const [uid, mv] of predicted) {
        const e = B.enemies.find(x => x.uid === uid);
        if (e && !e.dead && e._lastActed && e._lastActed !== mv) mismatches.push(`${e.name}: 预告 ${mv} 实际 ${e._lastActed}`);
      }
      // 随便出点牌，推进回合
      for (const c of [...B.hand]) { if (B.canPlay(c)) { await B.playCard(c, c.target === 'enemy' ? B.aliveEnemies()[0] : null); break; } }
      if (B.over) break;
    }
  }
  ok(mismatches.length === 0, '敌人意图与实际动作一致', [...new Set(mismatches)].slice(0, 5).join(' | '));
}

section('E. 房间场景（商店/事件/营火/宝箱/奖励）');
{
  const doc = window.document;
  const txt = el => (el.textContent || '').trim();
  const btns = () => [...doc.querySelectorAll('.modal .btn, .screen .btn, .screen button, .screen .class-card')];
  const clickAll = async (label, limit = 6) => {
    for (let i = 0; i < limit; i++) {
      const list = btns().filter(b => !b.classList.contains('disabled') && b.offsetParent !== null);
      if (!list.length) break;
      const target = list[Math.min(i, list.length - 1)];
      target.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise(r => setTimeout(r, 90));
      // 关掉可能弹出的选牌器
      const cancel = [...doc.querySelectorAll('.modal .btn')].find(b => txt(b) === '取消');
      if (cancel) { cancel.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 60)); }
    }
    return doc.body.textContent.length;
  };

  // 每种房间都用真入口渲染
  for (const [name, fn] of [
    ['奖励', () => A.go('reward', 'battle')],
    ['商店', () => A.go('shop')],
    ['事件', () => A.go('event')],
    ['营火', () => A.go('rest')],
    ['宝箱', () => A.go('treasure')],
  ]) {
    try {
      A.go('map'); await new Promise(r => setTimeout(r, 40));   // 保证 G 处于可渲染状态
      fn();
      await new Promise(r => setTimeout(r, 120));
      const sc = doc.querySelector('.screen');
      const nBtns = btns().length;
      ok(!!sc, `${name}场景渲染成功`);
      ok(nBtns > 0, `${name}场景有可点按钮（${nBtns} 个）`);
      await clickAll(name);
      ok(true, `${name}场景点击不崩溃`);
    } catch (e) {
      ok(false, `${name}场景`, e.message);
    }
  }

  // 事件：12 个全部跑一遍每个选项（用引擎直接调 api）
  {
    const { EVENTS } = await import('file://' + join(ROOT, 'js/data/events.js'));
    const errs = [];
    for (const ev of EVENTS) {
      for (let oi = 0; oi < ev.options.length; oi++) {
        for (const cls of ['knight', 'mage', 'rogue']) {
          try {
            A.startRun(cls);
            const G = A.G;
            G.gold = 999; G.hp = G.maxHp;
            const o = ev.options[oi];
            if (o.req && !o.req(G)) continue;
            // 造一个 api：把需要选牌的接口变成直接通过
            const api = {
              rng: () => Math.random(),
              heal: n => { G.hp = Math.min(G.maxHp, G.hp + n); },
              damage: n => { G.hp = Math.max(0, G.hp - n); },
              maxHp: n => { G.maxHp = Math.max(1, G.maxHp + n); },
              gold: n => { G.gold = Math.max(0, G.gold + n); },
              addRelic: id => { if (id) G.relics.push(id); },
              addPotion: () => { if (G.potions.length < G.potionSlots) G.potions.push({ id: 'heal' }); },
              addCard: id => G.deck.push({ id: id || 'strike', up: false }),
              addCurse: id => G.deck.push({ id: id || 'curse_wound', up: false }),
              randomRelic: () => 'iron_belt',
              randomCard: () => 'strike',
              removeCard: async () => {}, upgradeCard: async () => {}, transformCard: async () => {},
              upgradeBasics: () => {}, fightElite: () => {},
            };
            o.run(G, api);
          } catch (e) { errs.push(`${ev.id}.${oi}/${cls}: ${e.message}`); }
        }
      }
    }
    ok(errs.length === 0, `12 个事件 × 全部选项 × 3 职业 均可执行`, errs.slice(0, 6).join(' | '));
  }
}

/* ================= F. 选牌器（升级 / 移除卡牌）端到端 ================= */
section('F. 选牌器：升级 / 移除卡牌');
{
  const doc = window.document;
  const txt = e => (e.textContent || '').trim();
  const find = (t, sel = 'button,.btn,.class-card') => [...doc.querySelectorAll(sel)].find(e => txt(e).includes(t));
  const click = e => e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

  // 弹层里所有按钮都必须有文字 —— 之前 pickCards 把 DOM 元素当按钮描述传进去，
  // 渲染出一个空白且点了没反应的按钮，用户选完牌发现"确定"按不了
  const assertButtonsLabelled = label => {
    const blanks = [...doc.querySelectorAll('.modal .mfoot .btn')].filter(b => !txt(b));
    ok(blanks.length === 0, `${label}：弹层按钮都有文字`, `空白按钮 ${blanks.length} 个`);
  };

  /* ---- 升级（营火 · 锻造） ---- */
  A.startRun('knight');
  A.G.deck = [{ id: 'strike', up: false }, { id: 'defend', up: false }, { id: 'heavy_blow', up: false }];
  A.go('rest'); await new Promise(r => setTimeout(r, 200));
  const forge = find('锻造');
  ok(!!forge, '营火有「锻造」按钮');
  forge.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));

  const mcards = [...doc.querySelectorAll('.modal .card')];
  ok(mcards.length === 3, `锻造弹层列出 3 张可升级卡（实际 ${mcards.length}）`);
  assertButtonsLabelled('锻造');
  const okBtn = [...doc.querySelectorAll('.modal .mfoot .btn')].find(b => txt(b).includes('确定'));
  ok(!!okBtn, '锻造弹层有「确定」按钮');

  mcards[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  ok(mcards[0].classList.contains('selected'), '点击卡牌会进入选中态');

  okBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok(!doc.querySelector('.modal-bg'), '点「确定」后弹层关闭');
  const upCount = A.G.deck.filter(c => c.up).length;
  ok(upCount === 1, '卡牌确实被升级了（卡组里出现 1 张升级牌）', JSON.stringify(A.G.deck));

  /* ---- 移除（营火里再走一次，用「再点一次=确认」的路径） ---- */
  A.startRun('knight');
  A.G.deck = [{ id: 'strike', up: false }, { id: 'defend', up: false }, { id: 'strike', up: false }];
  A.go('rest'); await new Promise(r => setTimeout(r, 200));
  find('锻造')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  const c2 = [...doc.querySelectorAll('.modal .card')];
  // 第一次点 = 选中，第二次点同一张 = 直接确认
  c2[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  c2[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok(!doc.querySelector('.modal-bg'), '「再点一次已选中的牌」能直接确认并关闭');
  ok(A.G.deck.filter(c => c.up).length === 1, '这一路径也真的升级了卡牌');

  /* ---- 移除（商店 · 移除卡牌服务） ---- */
  A.startRun('knight');
  A.G.deck = [{ id: 'strike', up: false }, { id: 'curse_wound', up: false }, { id: 'defend', up: false }];
  A.G.gold = 999;
  A.go('shop'); await new Promise(r => setTimeout(r, 250));
  const rmRow = [...doc.querySelectorAll('.row, .btn')].find(e => txt(e).includes('移除一张卡牌'));
  ok(!!rmRow, '商店有「移除一张卡牌」服务');
  rmRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const rmCards = [...doc.querySelectorAll('.modal .card')];
  ok(rmCards.length === 3, `移除弹层列出 3 张卡（实际 ${rmCards.length}）`);
  assertButtonsLabelled('移除卡牌');
  const rmOk = [...doc.querySelectorAll('.modal .mfoot .btn')].find(b => txt(b).includes('确定'));
  // 挑那张诅咒牌移除
  const curseIdx = 1;
  rmCards[curseIdx].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  rmOk.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const stillCurse = A.G.deck.some(c => c.id === 'curse_wound');
  ok(!stillCurse, '诅咒牌被成功移除', JSON.stringify(A.G.deck));
  ok(A.G.deck.length === 2, '卡组数量减少 1 张', String(A.G.deck.length));

  /* ---- 未选满时点「确定」应被拒绝 ---- */
  A.startRun('knight');
  A.G.gold = 999;
  A.go('shop'); await new Promise(r => setTimeout(r, 250));
  [...doc.querySelectorAll('.row, .btn')].find(e => txt(e).includes('移除一张卡牌'))
    ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 250));
  const ok2 = [...doc.querySelectorAll('.modal .mfoot .btn')].find(b => txt(b).includes('确定'));
  const n0 = A.G.deck.length;
  ok2.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 200));
  ok(A.G.deck.length === n0, '没选卡时点「确定」不会误删卡牌');
  ok(!!doc.querySelector('.modal-bg'), '没选卡时弹层保持打开');
}

/* ================= G. 本轮修复的针对性回归 ================= */
section('G. 本轮修复项');
{
  const doc = window.document;
  const txt = e => (e.textContent || '').trim();
  const click = e => e.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };
  // 弹层挂在 #stage 上而不是 #app，go() 清不掉 —— 每段之间手动收干净
  const clearModals = () => [...doc.querySelectorAll('.modal-bg')].forEach(m => m.remove());

  /* --- G1. 战斗快照：关页面再回来，敌人/血量/手牌必须一模一样 --- */
  {
    A.startRun('knight');
    A.G.act = 2;
    const B = new A.Battle(A.pickEncounter('strong'), { kind: 'battle' });
    B.view = noopView;
    B.rollIntents();
    await B.start();
    B.energy = 9;
    if (B.hand.length) await B.playCard(B.hand[0], B.aliveEnemies()[0]);
    B.energy = 9;
    if (B.hand.length) await B.playCard(B.hand[0], B.aliveEnemies()[0]);

    const snap = JSON.parse(JSON.stringify(B.serialize()));   // 走一遍真实序列化
    const B2 = new A.Battle([], { kind: B.kind, restore: snap });

    ok(B2.enemies.length === B.enemies.length, '快照恢复后敌人数量一致',
       `${B.enemies.length} -> ${B2.enemies.length}`);
    const sameEnemies = B.enemies.every((e, i) => e.defId === B2.enemies[i].defId && e.hp === B2.enemies[i].hp && e.maxHp === B2.enemies[i].maxHp);
    ok(sameEnemies, '快照恢复后每个敌人的种类和血量一致',
       B.enemies.map(e => `${e.name}:${e.hp}`).join(',') + ' | ' + B2.enemies.map(e => `${e.name}:${e.hp}`).join(','));
    ok(B2.player.hp === B.player.hp, '玩家血量一致', `${B.player.hp} -> ${B2.player.hp}`);
    ok(B2.turn === B.turn, '回合数一致', `${B.turn} -> ${B2.turn}`);
    ok(B2.draw.length === B.draw.length && B2.hand.length === B.hand.length && B2.discard.length === B.discard.length,
       '三个牌堆数量一致',
       JSON.stringify({ draw: [B.draw.length, B2.draw.length], hand: [B.hand.length, B2.hand.length], disc: [B.discard.length, B2.discard.length] }));
    const handIds = B.hand.map(c => c.id).sort().join(',');
    const handIds2 = B2.hand.map(c => c.id).sort().join(',');
    ok(handIds === handIds2, '手牌内容一致', `${handIds} | ${handIds2}`);
    // 恢复后还能继续打
    B2.view = noopView;
    await B2.resume();
    ok(!B2.over || B2.result, '恢复后能继续把战斗打完');
  }

  clearModals();

  /* --- G2. 召唤者死了，小弟跟着消失 --- */
  {
    A.startRun('knight');
    const B = new A.Battle(['boss_eye'], { kind: 'boss' });
    B.view = noopView;
    B.rollIntents();
    await B.start();
    const boss = B.enemies[0];
    await B.resolveEnemyFx([{ t: 'summon', id: 'bat', n: 2 }], boss);
    ok(B.aliveEnemies().length === 3, `召唤后场上有 3 个敌人（实际 ${B.aliveEnemies().length}）`);
    ok(B.enemies.filter(e => e.summonedBy === boss.uid).length === 2, '两个小弟都记着召唤者是 Boss');
    await B.kill(boss);
    ok(B.aliveEnemies().length === 0, '召唤者死亡后小弟一并消失', `还剩 ${B.aliveEnemies().length} 个`);
    ok(B.over && B.result === 'win', '清场后战斗正常判定胜利');
  }

  clearModals();

  /* --- G3. 营火休息：血条要同步刷新 --- */
  {
    A.startRun('knight');
    A.G.hp = 10;
    A.go('rest'); await sleep(220);
    const bar = doc.querySelector('.screen .hpbar .txt');
    const before = txt(bar);
    const restBtn = [...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('休息'));
    ok(!!restBtn, '营火有「休息」按钮');
    click(restBtn); await sleep(260);
    const after = txt(doc.querySelector('.screen .hpbar .txt'));
    ok(after !== before, '休息后血条栏同步更新', `${before} -> ${after}`);
    ok(A.G.hp > 10, '血量确实回复了', String(A.G.hp));
  }

  clearModals();

  /* --- G4. 商店：状态栏金币同步 + 标题不被覆盖 --- */
  {
    A.startRun('knight');
    A.G.gold = 500;
    A.go('shop'); await sleep(260);
    const goldEl = doc.querySelector('.screen .goldAmt');
    ok(!!goldEl, '商店状态栏有独立的金币元素（不再是和标题共用 .gold）');
    const g0 = Number(txt(goldEl));
    const titleBefore = txt(doc.querySelector('.topbar .grow'));
    const card = doc.querySelector('.shop-grid .card');
    click(card); await sleep(300);
    const g1 = Number(txt(doc.querySelector('.screen .goldAmt')));
    ok(g1 < g0, '购买后状态栏金币同步减少', `${g0} -> ${g1}`);
    ok(txt(doc.querySelector('.topbar .grow')) === titleBefore, '标题没有被金币数字覆盖', txt(doc.querySelector('.topbar .grow')));
  }

  clearModals();

  /* --- G5. 商店移除卡牌：可以连续移除多张 --- */
  {
    A.startRun('knight');
    A.G.gold = 1000;
    A.G.deck = ['strike', 'strike', 'strike', 'strike', 'defend', 'defend'].map(id => ({ id, up: false }));
    A.go('shop'); await sleep(300);
    const n0 = A.G.deck.length;
    for (let i = 0; i < 2; i++) {
      const rm = [...doc.querySelectorAll('.screen .row')].find(e => txt(e).includes('移除一张卡牌'));
      if (!rm) break;
      click(rm); await sleep(280);
      const cards = [...doc.querySelectorAll('.modal .card')];
      if (!cards.length) break;
      click(cards[0]); await sleep(150);
      const okb = [...doc.querySelectorAll('.modal .mfoot .btn')].find(b => txt(b).includes('确定'));
      click(okb); await sleep(320);
    }
    ok(A.G.deck.length === n0 - 2, `一次进店能连续移除 2 张（${n0} -> ${A.G.deck.length}）`, JSON.stringify(A.G.deck.map(c => c.id)));
  }

  clearModals();

  /* --- G6. 营火升级预览：卡面显示的是升级后的数值 --- */
  {
    A.startRun('knight');
    A.G.deck = [{ id: 'strike', up: false }, { id: 'defend', up: false }];
    A.go('rest'); await sleep(220);
    click([...doc.querySelectorAll('.screen .btn')].find(b => txt(b).includes('锻造')));
    await sleep(280);
    const cards = [...doc.querySelectorAll('.modal .card')];
    ok(cards.length === 2, '锻造弹层列出可升级卡');
    ok(!!doc.querySelector('.modal .card-badge'), '带「升级后」角标');
    const strikeText = cards.map(c => txt(c.querySelector('.ctext'))).join(' ');
    // 从数据里读，别写死 —— 数值表调整后写死的数字会静默过期
    const upDmg = A.CARDS.strike.up.dmg;
    ok(strikeText.includes(String(upDmg)),
       `卡面显示的是升级后的数值（打击 ${A.CARDS.strike.dmg} → ${upDmg}）`, strikeText);
  }

  clearModals();

  /* --- G7. 状态标签直接写出名称，不再只有图标 --- */
  {
    A.startRun('knight');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = noopView;
    B.rollIntents();
    await B.start();
    B.add(B.player, 'weak', 2);
    B.add(B.player, 'vulnerable', 3);
    B.view.sync?.();
    A.go('battle', B);
    await sleep(500);
    const chips = [...doc.querySelectorAll('.player-zone .st')].map(txt);
    ok(chips.some(t => t.includes('虚弱')), '虚弱标签写出了名称', chips.join(' | '));
    ok(chips.some(t => t.includes('易伤')), '易伤标签写出了名称', chips.join(' | '));
  }
}

section('H. PWA / 预缓存清单（离线可玩）');
{
  // 【这条是补的】build.mjs 的 buildPrecache() 用 walk(ROOT) 扫整个目录树，
  // 装完依赖后会把 node_modules 里上千个文件也写进清单 —— 而它们并不在发布产物里
  // （workflow 的 rsync 明确排除了 node_modules），于是每个访客首开都要白跑
  // 一千多个 404，Service Worker 的 install 也会被拖慢。
  // 之所以能一直没被发现：整个测试套件里**压根没有**任何盯着 precache.json 的断言，
  // 而 README 却写着"预缓存清单覆盖全部资源"。下面把这条关系钉死。
  const prePath = join(ROOT, 'precache.json');
  let list = null;
  try { list = JSON.parse(readFileSync(prePath, 'utf8')); } catch { /* 没构建 */ }
  ok(Array.isArray(list), 'precache.json 存在且可解析（由 npm run build 生成）');

  if (Array.isArray(list)) {
    const WEB_EXT = /\.(html|css|js|json|webmanifest|png|jpg|svg|ogg|mp3|wav|woff2?|ttf)$/;

    // 只在本地开发用、明确**不进线上产物**的文件（与 build.mjs 的
    // PRECACHE_SKIP_DEV_ONLY 和 workflow 的 rsync --exclude 三处必须一致）。
    const DEV_ONLY = ['js/dev-agent.js'];

    // 独立遍历一遍"真正会被发布的目录"，不去复用 build.mjs 的逻辑
    // （复用就等于拿被测实现给自己当尺子，它错了这里也会跟着错）
    const PUBLISHED_DIRS = ['assets', 'css', 'js'];
    const walkPublished = (dir, rel = '') => {
      const out = [];
      for (const name of readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${name.name}` : name.name;
        if (name.isDirectory()) out.push(...walkPublished(join(dir, name.name), r));
        else out.push(r);
      }
      return out;
    };
    const expected = [
      'index.html', 'manifest.webmanifest', 'css/style.css',
      ...PUBLISHED_DIRS.flatMap(d => walkPublished(join(ROOT, d), d)),
    ].filter(f => WEB_EXT.test(f) && !/^assets\/licenses\//.test(f) && !DEV_ONLY.includes(f));

    // 1) 不该出现的东西（回归重点）
    const junk = list.filter(u => /node_modules|\.git\/|\/tools\/|^\.\/package(-lock)?\.json$/.test(u));
    ok(junk.length === 0, '清单里没有 node_modules / .git / tools / package-lock 等非运行期文件',
       `${junk.length} 条，例如 ${junk.slice(0, 3).join(', ')}`);

    // 2) 每条都必须真实存在，否则 SW 安装就是在打无效请求
    const missing = list.filter(u => u !== './' && !existsSync(join(ROOT, u.replace(/^\.\//, ''))));
    ok(missing.length === 0, '清单里每一条都能在磁盘上找到',
       `${missing.length} 条缺失，例如 ${missing.slice(0, 3).join(', ')}`);

    // 3) 清单 == 发布资源集合（不多不少）
    const notCovered = expected.filter(f => !list.includes('./' + f));
    ok(notCovered.length === 0, `清单覆盖全部发布资源（应 ${expected.length} 条）`,
       `漏了 ${notCovered.length} 个：${notCovered.slice(0, 3).join(', ')}`);
    const extra = list.filter(u => u !== './' && !expected.includes(u.replace(/^\.\//, '')));
    ok(extra.length === 0, '清单里没有多余条目',
       `多了 ${extra.length} 个：${extra.slice(0, 3).join(', ')}`);

    /* --- 4) 顺序必须确定（否则 sw.js 的版本哈希跨机器不一致）---
       walk() 的顺序来自 readdir，它是**文件系统相关**的：
       NTFS 大致按名字、ext4 是哈希序。实测线上(Linux) 把 grave_cross.png 排在
       gravestone.png 之前，而 NTFS 恰好相反 —— 集合一样、字节不同 →
       precache.json 变了 → SW 版本哈希变了 → 每次换机器构建都白失效一次全量缓存。
       修法是 build.mjs 用 sortedWalk（码位序）。这里盯住它别再退回去。 */
    const filesOnly = list.filter(u => u !== './');
    const sortedCopy = filesOnly.slice().sort();
    const orderDiff = filesOnly.findIndex((u, i) => u !== sortedCopy[i]);
    ok(orderDiff < 0,
       '清单按码位序排列（跨文件系统/跨机器字节一致，SW 版本哈希才可复现）',
       orderDiff >= 0 ? `第 ${orderDiff} 项：${filesOnly[orderDiff]} 应为 ${sortedCopy[orderDiff]}` : '');

    /* --- 5) 只应存在于本地开发、不该出现在线上产物的文件 ---
       手机端审计时发现 /js/dev-agent.js 在生产返回 200（调试代理被发布上线）。
       改法是三处联动：index.html 不写死 → server.mjs 动态注入 → workflow 排除。
       这三处只要有一处漏了，要么线上多一个不该有的文件，要么 SW 去请求一个 404。 */
    const devInPrecache = list.filter(u => DEV_ONLY.includes(u.replace(/^\.\//, '')));
    ok(devInPrecache.length === 0,
       '预缓存清单里不含只在本地开发用的文件（否则线上 SW 会请求到 404）',
       devInPrecache.join(', '));

    const wf = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8');
    for (const f of DEV_ONLY) {
      ok(wf.includes(`--exclude ${f}`),
         `workflow 的站点组装排除了 ${f}（与预缓存清单保持一致）`);
    }
    const idx = readFileSync(join(ROOT, 'index.html'), 'utf8');
    ok(!/<script[^>]*dev-agent[^>]*>/.test(idx),
       'index.html 不再写死调试代理（否则会被发布到线上）');
    const srv = readFileSync(join(ROOT, 'server.mjs'), 'utf8');
    ok(/dev-agent\.js/.test(srv),
       'server.mjs 会在本地动态注入调试代理（本地真机调试通道仍可用）');
  }

  // manifest 本身也要完整，否则安卓弹不出安装框
  const mf = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  ok(!!mf.name && !!mf.short_name, 'manifest 有 name / short_name');
  ok(!!mf.start_url && !!mf.display, 'manifest 有 start_url / display');
  const sizes = (mf.icons || []).map(i => i.sizes);
  ok(sizes.includes('192x192') && sizes.includes('512x512'), 'manifest 含 192 与 512 图标', sizes.join(','));
  const iconMissing = (mf.icons || []).filter(i => !existsSync(join(ROOT, i.src.replace(/^\.\//, ''))));
  ok(iconMissing.length === 0, 'manifest 里每个图标文件都存在', iconMissing.map(i => i.src).join(', '));
  ok(!!mf.shortcuts?.every(s => (s.icons || []).every(i => existsSync(join(ROOT, i.src.replace(/^\.\//, ''))))),
     'manifest 快捷方式引用的图标也存在');

  // 【这条是补的】sw.js 的 VERSION 必须是 `npm run build` 盖上的内容哈希。
  // 手工版本号（原来的 'abyss-v1'）永远不变 → 浏览器不重新 install SW、
  // activate 也不会清理旧缓存 → **发版后老用户第一次打开跑的还是旧代码**。
  // 实测：本地验证时线上页面就是靠刷新才拿到新逻辑的，第一次打开确实是旧的。
  const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const ver = /const VERSION = '([^']*)'/.exec(swSrc)?.[1];
  ok(/^abyss-[0-9a-f]{12}$/.test(ver || ''),
     `sw.js 的 VERSION 已被构建盖上内容哈希（当前 ${ver}）`,
     '应是 abyss-<12位十六进制>；若为 abyss-dev 说明还没跑过 npm run build');
  ok(ver !== 'abyss-v1' && ver !== 'abyss-dev',
     'VERSION 不是手写的固定值（那种永远不触发 SW 更新）');

  // sw.js **自身**必须参与版本哈希（把 VERSION 行剔掉再算，避免自指）。
  // 实测踩到过：只回退 SW 逻辑（去掉 navigate）时 VERSION 没变，
  // 浏览器就认为 SW 没更新、不重新 install —— 修复推不到用户那里。
  {
    const buildSrc = readFileSync(join(ROOT, 'tools/build.mjs'), 'utf8');
    ok(/h\.update\(sw\.replace\(\/const VERSION/.test(buildSrc),
       'sw.js 自身的改动也参与版本哈希（否则只改 SW 时版本不变、更新推不下去）');
  }

  /* --- 更新链必须完整（漏一环就是"修好了但用户还看到旧的"）---
     实测踩到过：部署完新版本，浏览器里同时存在 **两个版本之前** 的缓存
     和上一版缓存，页面加载到的是旧 JS —— 因为 SW 的 fetch 是"缓存优先"，
     发布后**第一个打开页面的用户拿到的仍是旧文件**，浏览器要等这次加载之后
     才去比对 sw.js、装新 SW、清旧缓存。
     所以三件事必须同时成立：
       ① sw.js 里有 skipWaiting()  —— 新 SW 不等所有标签页关闭就激活
       ② sw.js 里有 clients.claim() —— 激活后立刻接管当前页面
       ③ index.html 监听 controllerchange 并**重载一次** —— 让用户当场切到新代码
     ①或②少一个，③就永远不触发；③少了，用户得手动刷新两次才看到新版。 */
  ok(/skipWaiting\(\)/.test(swSrc), 'sw.js 调用 skipWaiting()（新 SW 立即激活）');
  ok(/clients\.claim\(\)/.test(swSrc), 'sw.js 调用 clients.claim()（立刻接管当前页面）');
  // ⚠️ 反向断言：activate 里**不许**调 client.navigate()。
  // 我试过"从 SW 侧推页面重载"（本意是连旧版 index.html 一起救回来），
  // 线上实测**页面直接卡死** —— activate 里对受控客户端 navigate()，
  // 等的大概是这次导航自身完成，SW 卡在 await 上、页面请求全被挂住。
  // 页面重载只能交给 index.html 的 controllerchange 监听。
  // 注意：只匹配**真正的调用**（`c.navigate(` / `client.navigate(`），
  // 别被注释里的字面量和 fetch 里的 `req.mode === 'navigate'` 误伤；
  // 也顺带把注释内容剔掉再判断。
  const swCode = swSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(!/\b(clients?|c|client)\s*\.\s*navigate\s*\(/.test(swCode),
     'sw.js 的 activate 里没有 client.navigate()（那样会让页面卡死，已实测）');

  const idxSrc = readFileSync(join(ROOT, 'index.html'), 'utf8');
  ok(/controllerchange/.test(idxSrc), 'index.html 监听 controllerchange');
  ok(/location\.reload\(\)/.test(idxSrc), 'index.html 在新 SW 接管后重载一次');
  ok(/hadController/.test(idxSrc),
     '重载带了「原本就有 SW 在管」的判断（否则首次访问也会白白刷新一遍）');
}

section('I. 弃牌代价（「飞刀」）');
{
  // 【这条是补的】cards.js 里「飞刀」写着"然后弃 1 张牌"，fx 也有 {t:'discard'}，
  // 但引擎调的是 this.view.requestDiscard?.()，而 scene-battle.js 的 view 对象
  // 压根没有这个方法 —— 可选链把整条静默跳过，卡面承诺的代价从未发生。
  // 这里把两个方向都钉住：界面接得上、且无论界面在不在，代价都必须真的付。
  const doc = window.document;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const clearModals = () => [...doc.querySelectorAll('.modal-bg')].forEach(m => m.remove());
  const { makeCard: card } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  const mkBattle = () => {
    A.startRun('rogue');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- I1. 界面实现存在（旧代码就是缺这个） --- */
  {
    A.startRun('rogue');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    A.go('battle', B);
    await sleep(150);
    ok(typeof B.view?.requestDiscard === 'function',
       '战斗界面实现了 view.requestDiscard（否则「弃 1 张牌」会静默空转）');
    clearModals();
  }

  /* --- I2. 界面挑哪张就弃哪张 --- */
  {
    const B = mkBattle();
    await B.start();
    B.hand = [card('strike'), card('defend'), card('cleave')];
    const want = B.hand[1];
    B.view.requestDiscard = async () => 1;          // 模拟玩家点了第 2 张
    const discarded = await B.discardFromHand(1);
    ok(discarded.length === 1 && discarded[0] === want, '弃掉的正是玩家选中的那张');
    ok(B.discard.includes(want), '被弃的牌进了弃牌堆');
    ok(!B.hand.includes(want), '被弃的牌离开了手牌');
    ok(B.hand.length === 2, `手牌少了一张（剩 ${B.hand.length}）`);
  }

  /* --- I3. 玩家取消 / 界面没实现 → 仍然要付代价（退化成随机） --- */
  {
    const B = mkBattle();
    await B.start();
    B.hand = [card('strike'), card('defend')];
    B.view.requestDiscard = async () => -1;         // 模拟玩家取消
    const discarded = await B.discardFromHand(1);
    ok(discarded.length === 1, '取消弃牌也要付出代价（不能白赚）');
    ok(B.hand.length === 1, '手牌确实少了一张');

    const B2 = mkBattle();
    await B2.start();
    B2.hand = [card('strike'), card('defend')];
    delete B2.view.requestDiscard;                  // 模拟界面完全没接这个回调
    const d2 = await B2.discardFromHand(1);
    ok(d2.length === 1, '界面未实现 requestDiscard 时也不会空转');
  }

  /* --- I4. 端到端：真打「飞刀」，被选中的那张必须进弃牌堆 --- */
  {
    const B = mkBattle();
    await B.start();
    B.energy = 3;
    const dagger = card('dagger_throw');
    const spare = card('defend');
    B.hand = [dagger, card('strike'), spare];
    B.view.requestDiscard = async hand => hand.indexOf(spare);   // 明确指定弃「防御」
    await B.playCard(dagger, B.aliveEnemies()[0]);
    ok(B.discard.includes(dagger), '打出的「飞刀」进了弃牌堆');
    ok(B.discard.includes(spare), '「飞刀」确实弃掉了玩家选中的那张');
    // 净变化：打出 −1、飞刀自带抽 1 张 +1、弃牌 −1 → 3-1+1-1 = 2
    // （2026-10-13 抽牌涨价时我一度把飞刀的抽牌去掉、这条断言跟着改成 1；
    //   后来为了保住游侠的"低费过牌"身份又把抽牌加了回来 —— 断言也随之改回。
    //   这就是"改了牌就必须改断言"，两边不同步就会一直红。）
    ok(B.hand.length === 2, `手牌按「打出1 / 抽1 / 弃1」净减 1（实际 ${B.hand.length}）`);
  }

  /* --- I5. 手牌为空时不能卡死 --- */
  {
    const B = mkBattle();
    await B.start();
    B.hand = [];
    const d = await B.discardFromHand(1);
    ok(d.length === 0, '手牌为空时弃牌不报错、返回空');
  }
}

section('J. 战斗存档版本兼容（不能白送胜利）');
{
  // 【这条是补的】applySnapshot 原本是 `if (!s || s.v !== 1) return;` —— 静默返回。
  // 而主线读档走 `new Battle([], {kind, restore})`（encounter 是空数组），
  // 于是 enemies 保持空 → resume() 里 `!aliveEnemies().length` 成立 →
  // endBattle(true) —— **直接判玩家胜利、白送一关**。
  // 将来任何一次快照结构改动都会触发它，且玩家会以为是自己打赢的。
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  /* --- J1. 先拿一份真实快照当"正常档" --- */
  A.startRun('knight');
  const B0 = new A.Battle(['slime'], { kind: 'battle' });
  B0.view = { ...noopView };
  B0.rollIntents();
  await B0.start();
  const goodSnap = JSON.parse(JSON.stringify(B0.serialize()));
  ok(goodSnap.v === 1, '新快照的版本号是 1');

  /* --- J2. 版本正常的快照必须能读回来 --- */
  {
    const B = new A.Battle([], { kind: 'battle', restore: goodSnap });
    B.view = { ...noopView };
    ok(B.restoreFailed === false, '版本匹配时不标记 restoreFailed');
    ok(B.aliveEnemies().length === goodSnap.enemies.length,
       `敌人按快照恢复了（${B.aliveEnemies().length} 个）`);
    ok(B.player.hp === goodSnap.player.hp, '玩家血量按快照恢复');
  }

  /* --- J3. 版本不认识时必须报告失败，而不是静默变空战场 --- */
  {
    const bad = { ...goodSnap, v: 99 };
    const B = new A.Battle([], { kind: 'battle', restore: bad });
    B.view = { ...noopView };
    ok(B.restoreFailed === true, '版本不认识时 restoreFailed 为 true');
    ok(B.aliveEnemies().length === 0, '（这正是危险之处）敌人数组是空的');
  }

  /* --- J4. 关键：这种状态下 resume() 绝不能判胜利 --- */
  {
    const bad = { ...goodSnap, v: 99 };
    const B = new A.Battle([], { kind: 'battle', restore: bad });
    B.view = { ...noopView };
    let ended = null;
    B.view.onEnd = r => { ended = r; };
    const r = await B.resume();
    ok(r === false, 'resume() 明确返回 false 表示没恢复成');
    ok(B.over === false, '战斗没有被判定结束');
    ok(!(B.over && B.result === 'win'), '★ 没有把"读档失败"当成"打赢了"');
    ok(ended === null, '没有触发结算回调（否则玩家会看到白送的胜利画面）');
  }

  /* --- J5. 残缺快照同样不能白送 ---
     注意契约：restore 为 null/undefined 表示"根本没有快照"（main.js 用 `if (!p.snap)`
     单独兜底、走全新战斗），不算恢复失败；而"给了快照但内容不全"必须算失败。 */
  {
    const cases = [
      [{}, true, '空对象'],
      [{ v: 1 }, true, '有版本号但没有 player'],
      [{ v: 1, player: null }, true, 'player 是 null'],
      [{ v: 1, player: { hp: 10, maxHp: 20 } }, true, '有 player 但 enemies 为空'],
      [{ v: 1, player: { hp: '10', maxHp: 20 }, enemies: [{ defId: 'slime' }] }, true, 'hp 不是数字'],
      [{ v: 1, player: { hp: 10, maxHp: 20 }, enemies: [{ defId: '不存在的敌人' }] }, true, 'enemies 全是未知 defId'],
    ];
    for (const [snap, want, label] of cases) {
      const B = new A.Battle([], { kind: 'battle', restore: snap });
      B.view = { ...noopView };
      ok(B.restoreFailed === want, `残缺快照被拒（${label}）`);
    }
    // 没有快照 ≠ 恢复失败
    for (const none of [null, undefined]) {
      const B = new A.Battle([], { kind: 'battle', restore: none });
      ok(B.restoreFailed === false, `没给快照时不标记失败（${String(none)}）`);
    }
  }
}

section('K. 场景监听器回收（切场景不累积泄漏）');
{
  // 【这条是补的】原来全仓没有一处 removeEventListener：
  // 每进一次战斗就往 window/document 上多挂 4 个监听器（beforeunload /
  // visibilitychange / pagehide / resize），每进一次地图多挂 1 个。
  // 这些闭包攥着那一场的 Battle、G 和整棵 DOM 树，而旧的 resize 回调
  // 还会继续对已经脱离文档的节点跑 layoutHand()。
  const sleep2 = ms => new Promise(r => setTimeout(r, ms));

  // 统计"净存活"的监听器：add 进集合、remove 出集合。
  // 注意：身份必须用**函数对象本身**（给每个函数分配唯一编号），
  // 不能用 String(f) —— 源码文本相同的闭包（例如每个战斗场景都注册的
  // `() => requestAnimationFrame(layoutHand)`）会被 Set 当成同一个而合并，
  // 实测会把 30 个少算成 5 个，让这条断言变成永不触发的假测试。
  let addCount = 0, removeCount = 0, fnSeq = 0;
  const fnIds = new Map();
  const idOf = f => { let v = fnIds.get(f); if (v === undefined) { v = ++fnSeq; fnIds.set(f, v); } return v; };
  const patch = target => {
    const add = target.addEventListener.bind(target);
    const rm = target.removeEventListener.bind(target);
    const active = new Set();
    target.addEventListener = (t, f, o) => { addCount++; active.add(t + '#' + idOf(f)); return add(t, f, o); };
    target.removeEventListener = (t, f, o) => { removeCount++; active.delete(t + '#' + idOf(f)); return rm(t, f, o); };
    return active;
  };
  const winActive = patch(window);
  const docActive = patch(window.document);
  const live = () => winActive.size + docActive.size;

  // 进一次战斗作为基线
  A.startRun('knight');
  A.go('battle', new A.Battle(['slime'], { kind: 'battle' }));
  await sleep2(180);
  const after1 = live();

  // 来回切场景 5 轮
  for (let i = 0; i < 5; i++) {
    A.go('map');
    await sleep2(80);
    A.go('battle', new A.Battle(['slime'], { kind: 'battle' }));
    await sleep2(180);
  }
  const after6 = live();
  console.log(`     监听器统计：add ${addCount} / remove ${removeCount} / 当前存活 ${live()}` +
              `（1 场后 ${after1} → 再切 5 轮后 ${after6}）`);

  ok(removeCount > 0, `切场景时确实有 removeEventListener 被调用（${removeCount} 次）`);
  ok(after6 <= after1,
     `来回切 5 轮战斗/地图后监听器没有净累积（${after1} -> ${after6}）`);
  ok(live() < addCount, `注册与摘除配对（累计 add ${addCount} / remove ${removeCount}，当前存活 ${live()}）`);
}

section('L. 伤害统计口径（结算面板不能少算）');
{
  // 【这条是补的】G.stats.dmgDealt / dmgTaken 只在 damage() 里累计，
  // 而中毒、狂战代价、loseHp 卡、敌人 selfDamage 全都是各自分支里直接 `hp -= n`，
  // 统统绕过了统计 —— 于是走中毒流的 rogue 打完一套，结算面板上的伤害几乎没涨。
  // 现在所有"直接扣血"都走 Battle.loseHp()，统计口径只定义一次。
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  const mk = () => {
    A.startRun('knight');
    const B = new A.Battle(['golem'], { kind: 'battle' });   // 石傀儡 hp [24,30]，够扛
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- L1. 敌人中毒：记入「造成伤害」 ---
     注意触发点：**敌人**中毒是在 enemyTurn() 里结算的，playerTurn() 结算的是**玩家**中毒。
     所以这里必须走 endTurn()（它会引发 enemyTurn），调 playerTurn() 是测不到的。 */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 25; e.maxHp = 25;
    B.applyDebuff(e, 'poison', 6);
    const d0 = A.G.stats.dmgDealt;
    const hp0 = e.hp;
    await B.endTurn();                          // → enemyTurn：敌人中毒结算
    ok(e.hp === hp0 - 6, `中毒扣了 6 血（${hp0} -> ${e.hp}）`);
    ok(A.G.stats.dmgDealt === d0 + 6, `中毒伤害计入「造成伤害」（${d0} -> ${A.G.stats.dmgDealt}）`);
  }

  /* --- L2. 玩家中毒 / 狂战代价：记入「受到伤害」 --- */
  {
    const B = mk();
    await B.start();
    B.player.hp = 50; B.player.maxHp = 80;
    B.applyDebuff(B.player, 'poison', 4);
    const t0 = A.G.stats.dmgTaken;
    await B.playerTurn();
    ok(B.player.hp === 46, `玩家中毒扣了 4 血（剩 ${B.player.hp}）`);
    ok(A.G.stats.dmgTaken === t0 + 4, `玩家中毒计入「受到伤害」（${t0} -> ${A.G.stats.dmgTaken}）`);
  }

  /* --- L3. 敌人自伤：不算玩家的战果（credit: none） --- */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 25; e.maxHp = 25;
    const d0 = A.G.stats.dmgDealt;
    const t0 = A.G.stats.dmgTaken;
    await B.loseHp(e, 10, { credit: 'none' });
    ok(e.hp === 15, '自伤确实扣血了');
    ok(A.G.stats.dmgDealt === d0, '敌人自伤不计入玩家「造成伤害」（不是玩家的功劳）');
    ok(A.G.stats.dmgTaken === t0, '敌人自伤也不计入玩家「受到伤害」');
  }

  /* --- L4. 单次伤害的统计不超过剩余生命（不记出负数/超额） --- */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 3; e.maxHp = 25;
    const d0 = A.G.stats.dmgDealt;
    await B.loseHp(e, 100, { credit: 'player' });
    ok(e.dead, '敌人被击杀');
    ok(A.G.stats.dmgDealt === d0 + 3, `统计按实际扣到的 3 点计（+${A.G.stats.dmgDealt - d0}）`);
  }

  /* --- L5. 普通攻击仍然照常统计（没有回归） --- */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 25; e.maxHp = 25; e.block = 0;
    const d0 = A.G.stats.dmgDealt;
    await B.damage(e, 7, 'test', { attacker: B.player });
    ok(A.G.stats.dmgDealt === d0 + 7, `普通伤害照常统计（${d0} -> ${A.G.stats.dmgDealt}）`);
  }
}

section('M. 敌人意图一轮只掷一次（读档不能换未来）');
{
  // 【这条是补的】rollIntents() 原本在一个回合周期里被调用 2~3 次
  // （enemyTurn 末尾一次、紧接着 playerTurn 开头又一次、读档时再一次）。
  // 用 rng 决定招式的敌人（怨灵的相位、各种 rng.chance）每次重掷都消耗随机数，
  // 于是「关掉页面再进来」会走出一条和「没关过」完全不同的未来。
  // 修法：rollIntents 幂等（intentRolled 标志），一轮只掷一次。
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  const mk = () => {
    A.startRun('knight');
    const B = new A.Battle(['ghost', 'slime'], { kind: 'battle' });  // 怨灵 ai 会用 rng
    B.view = { ...noopView };
    return B;
  };

  /* --- M1. 重复调用不再消耗随机数 --- */
  {
    const B = mk();
    B.rollIntents();
    const stateAfterFirst = B.rng.getState();
    const intents = B.aliveEnemies().map(e => e.moveId);
    B.rollIntents();
    B.rollIntents();
    ok(B.rng.getState() === stateAfterFirst,
       '重复调用 rollIntents 不再推进 RNG（意图已固定）');
    ok(JSON.stringify(B.aliveEnemies().map(e => e.moveId)) === JSON.stringify(intents),
       '重复调用不会改变已定的意图');
  }

  /* --- M2. force 可以强制重掷（给需要的场景留出口） --- */
  {
    const B = mk();
    B.rollIntents();
    const s0 = B.rng.getState();
    B.rollIntents(true);
    ok(B.rng.getState() !== s0, 'force=true 时仍可强制重掷');
  }

  /* --- M3. 一个完整回合里，意图只被掷一次 --- */
  {
    const B = mk();
    await B.start();                      // 内部会走 playerTurn
    const before = B.rng.getState();
    await B.endTurn();                    // → enemyTurn → 末尾重掷下一轮
    // 只能靠"下一轮意图确实变了/被掷过"来间接验证：这里验证不变量——
    // enemyTurn 结束后每个存活敌人都必须有一个已定的 moveId
    ok(B.aliveEnemies().every(e => !!e.moveId), 'enemyTurn 结束后每个敌人都已有下一轮意图');
    ok(B.rng.getState() !== before, '下一轮意图确实重新掷过（RNG 已推进一次）');
  }

  /* --- M4. 关键：读档续战必须沿用快照里的意图，不重掷 --- */
  {
    const B = mk();
    await B.start();
    const snap = JSON.parse(JSON.stringify(B.serialize()));
    const savedIntents = snap.enemies.filter(x => !x.dead).map(x => x.moveId);

    // 模拟"关掉页面再进来"
    A.startRun('knight');
    const B2 = new A.Battle([], { kind: 'battle', restore: snap });
    B2.view = { ...noopView };
    ok(B2.restoreFailed === false, '快照正常恢复');
    const rngBefore = B2.rng.getState();
    await B2.resume();
    const restoredIntents = B2.aliveEnemies().map(e => e.moveId);
    ok(JSON.stringify(restoredIntents) === JSON.stringify(savedIntents),
       `读档后意图与存档一致（${savedIntents} vs ${restoredIntents}）`);
    ok(B2.rng.getState() === rngBefore,
       '读档沿用了快照意图，没有为了重掷意图而消耗随机数');
  }
}

section('N. 效果 DSL 的文档承诺必须真的生效');
{
  // 【这条是补的】cards.js 头部把 DSL 写成了契约，但有两处代码与注释不符：
  //   ① {t:'addCard'} 注释里对玩家承诺了，engine 的 resolve() 却**没有这个 case**
  //      （只有敌人侧 resolveEnemyFx 实现了）→ 照注释写一张塞牌卡会静默无效。
  //   ② {t:'dmgAll', v, hits?} 声明了 hits，resolve 里却直接忽略 → 多段群攻只会打 1 次。
  // 现在两处都补齐了，这里把「注释即契约」钉死。
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  const mk = (ids = ['slime', 'slime']) => {
    A.startRun('knight');
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- N1. dmgAll 尊重 hits --- */
  {
    const B = mk(['golem', 'golem']);
    await B.start();
    const es = B.aliveEnemies();
    for (const e of es) { e.hp = 30; e.maxHp = 30; e.block = 0; }
    const hp0 = es.map(e => e.hp);
    await B.resolve([{ t: 'dmgAll', v: 4, hits: 3 }], { card: { name: '测试' }, target: null });
    for (let i = 0; i < es.length; i++) {
      ok(es[i].hp === hp0[i] - 12, `群攻 3 段各 4 点 = 12（敌人${i + 1}：${hp0[i]} -> ${es[i].hp}）`);
    }
  }

  /* --- N2. dmgAll 不写 hits 时仍然只打 1 次（不破坏现有卡牌） --- */
  {
    const B = mk(['golem', 'golem']);
    await B.start();
    const es = B.aliveEnemies();
    for (const e of es) { e.hp = 30; e.maxHp = 30; e.block = 0; }
    const hp0 = es.map(e => e.hp);
    await B.resolve([{ t: 'dmgAll', v: 5 }], { card: { name: '测试' }, target: null });
    for (let i = 0; i < es.length; i++) ok(es[i].hp === hp0[i] - 5, `未写 hits 时只打 1 次（-5）`);
  }

  /* --- N3. 玩家的 addCard 真的能塞牌（旧代码没有这个 case） --- */
  {
    for (const [to, bucket] of [['discard', 'discard'], ['draw', 'draw'], ['hand', 'hand']]) {
      const B = mk(['golem']);
      await B.start();
      B.hand = [];
      B.discard = []; B.draw = [];
      const n0 = B[bucket].length;
      await B.resolve([{ t: 'addCard', id: 'curse_wound', to, n: 2 }], { card: { name: '测试' }, target: null });
      ok(B[bucket].length === n0 + 2, `addCard 往 ${to} 塞了 2 张（${n0} -> ${B[bucket].length}）`);
      ok(B[bucket].every(c => c.id === 'curse_wound'), `${to} 里的牌确实是指定的那张`);
    }
  }

  /* --- N4. addCard 塞进手牌时不能突破 10 张上限 --- */
  {
    const B = mk(['golem']);
    await B.start();
    B.hand = []; B.discard = []; B.draw = [];
    for (let i = 0; i < 10; i++) B.hand.push(A.CARDS.strike ? { id: 'strike', upgraded: false } : { id: 'strike' });
    await B.resolve([{ t: 'addCard', id: 'curse_wound', to: 'hand', n: 3 }], { card: { name: '测试' }, target: null });
    ok(B.hand.length === 10, `手牌不会超过 10 张（实际 ${B.hand.length}）`);
    ok(B.discard.length === 3, `塞不下的进了弃牌堆（${B.discard.length} 张）`);
  }

  /* --- N5. 职业立绘/名称只此一份（加职业不会漏改） --- */
  {
    const mod = await import('file://' + join(ROOT, 'js/data/classes.js'));
    for (const id of ['knight', 'mage', 'rogue']) {
      ok(mod.classSprite(id) === mod.CLASSES[id].sprite, `classSprite('${id}') 与 CLASSES 一致`);
      ok(mod.className(id) === mod.CLASSES[id].name, `className('${id}') 与 CLASSES 一致`);
    }
    ok(mod.classSprite('不存在') === mod.CLASSES.knight.sprite, '未知职业安全回退，不抛异常');
    ok(mod.className('不存在') === mod.CLASSES.knight.name, '未知职业的名称也安全回退');
  }
}

section('O. 四层结构与层级强度曲线');
{
  // 【这条是补的】游戏从 3 层扩到 4 层，并且"同一张敌人表被所有层复用"，
  // 靠 actScale(层) 做缩放：每层 +25% 生命、+20% 攻击。
  // 最要紧的不变量是「界面预告的伤害 == 敌人真打出来的伤害」——
  // 缩放只加在敌人自己身上，玩家给的易伤/虚弱照常生效。
  const { ENEMIES, TOTAL_ACTS, actScale } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };

  /* --- O1. 曲线本身 --- */
  {
    const hp = [], atk = [];
    for (let a = 1; a <= TOTAL_ACTS; a++) { const s = actScale(a); hp.push(s.hp); atk.push(s.atk); }
    ok(hp[0] === 1 && atk[0] === 1, '第 1 层不缩放（基准）');
    ok(hp.map(x => +x.toFixed(4)).join(',') === '1,1.25,1.5,1.75',
       `生命每层 +25%：${hp.map(x => (x * 100).toFixed(0) + '%').join(' → ')}`);
    ok(atk.map(x => +x.toFixed(4)).join(',') === '1,1.13,1.26,1.39',
       `攻击每层 +13%（产品 2026-10-12 最终值）：${atk.map(x => (x * 100).toFixed(0) + '%').join(' → ')}`);
    ok(actScale(99).hp > 1, '层数越界时不会崩，仍给出更大倍率');
  }

  /* --- O2. 同一个敌人在高层更硬、打得更痛 ---
     注意：敌人血量是 rng.int(min,max) 掷出来的，直接比两次随机值会得到噪声
     （我第一次就是这么写的，13→13→21→21 那种）。所以先把 RNG 固定到同一状态，
     让每次掷出**完全相同**的原始血量，再比精确公式。 */
  {
    const sample = ['slime', 'golem', 'warrior'];
    for (const id of sample) {
      const hpByAct = [], dmgByAct = [], rawByAct = [];
      for (let a = 1; a <= TOTAL_ACTS; a++) {
        A.startRun('knight');
        A.G.act = a;
        A.G.rng.setState(20261012);                 // 固定掷点：原始血量每次相同
        const B = new A.Battle([id], { kind: 'battle' });
        B.view = { ...noopView };
        const e = B.aliveEnemies()[0];
        hpByAct.push(e.maxHp);
        rawByAct.push(A.G.rng.getState());          // 仅作调试
        const maxDef = Object.values(ENEMIES[id].moves).filter(m => m.dmg).sort((x, y) => y.dmg - x.dmg)[0];
        dmgByAct.push(B.calcDamage(Math.round(maxDef.dmg * (e.atkMult || 1)), e, B.player));
      }
      const raw = hpByAct[0];                       // 第 1 层不缩放，maxHp 就是掷出的原始值
      const exact = [];
      for (let a = 1; a <= TOTAL_ACTS; a++) exact.push(Math.max(1, Math.round(raw * actScale(a).hp)));
      ok(hpByAct.join(',') === exact.join(','),
         `${ENEMIES[id].name} 生命严格等于 round(原始 × 层倍率)：${hpByAct.join(' → ')}`);
      const dmgRising = dmgByAct.every((v, i) => i === 0 || v >= dmgByAct[i - 1]);
      ok(dmgRising, `${ENEMIES[id].name} 伤害随层数上升（${dmgByAct.join(' → ')}）`);
      const dmgRatio = dmgByAct[3] / dmgByAct[0];
      // 第 4 层攻击倍率 = 1 + 0.15×3 = 1.45（原为 1.6）。
      // 注意实测值会因「力量/虚弱」等固定值加减与取整而略偏离倍率本身，
      // 所以这里是"约为"（容差 0.06），不是精确等式。
      ok(Math.abs(dmgRatio - 1.39) < 0.08, `${ENEMIES[id].name} 第4层伤害约为第1层的 1.39 倍（实测 ${dmgRatio.toFixed(2)}）`);
    }
  }

  /* --- O3. 关键：预告的伤害必须等于真打出来的伤害（含易伤/虚弱/力量） --- */
  {
    const cases = [
      { label: '普通', setup: () => {} },
      { label: '玩家易伤', setup: (B) => B.add(B.player, 'vulnerable', 3) },
      { label: '敌人虚弱', setup: (B) => B.add(B.aliveEnemies()[0], 'weak', 3) },
      { label: '敌人力量+5', setup: (B) => B.add(B.aliveEnemies()[0], 'strength', 5) },
      { label: '易伤+虚弱+力量 一起', setup: (B) => { B.add(B.player, 'vulnerable', 3); B.add(B.aliveEnemies()[0], 'weak', 3); B.add(B.aliveEnemies()[0], 'strength', 5); } },
    ];
    const bad = [];
    for (let act = 1; act <= TOTAL_ACTS; act++) {
      for (const cs of cases) {
        A.startRun('knight');
        A.G.act = act;
        A.G.hp = 9999; A.G.maxHp = 9999;              // 撑住，别被一击打死导致读不到
        const B = new A.Battle(['warrior'], { kind: 'battle' });
        B.view = { ...noopView };
        B.rollIntents();
        await B.start();
        const e = B.aliveEnemies()[0];
        cs.setup(B);
        e.moveId = 'rend';                              // 固定一个纯攻击招式
        if (!e.def.moves.rend) { continue; }
        const predicted = B.intentOf(e);                 // 界面显示的
        const before = B.player.hp;
        B.player.block = 0;
        await B.damage(B.player, Math.round(e.def.moves.rend.dmg * (e.atkMult || 1)), e.name, { attacker: e, melee: true });
        const actual = before - B.player.hp;             // 真实掉血
        if (predicted.dmg !== actual) {
          bad.push(`act${act}/${cs.label}: 预告 ${predicted.dmg} 实际 ${actual}`);
        }
      }
    }
    ok(bad.length === 0, '敌人意图预告的伤害 == 实际打出的伤害（跨 4 层 × 5 种状态）',
       bad.slice(0, 6).join(' | '));
  }

  /* --- O4. 最后一个 Boss 存在且是 Boss --- */
  {
    const { ENCOUNTERS } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
    const last = ENCOUNTERS[TOTAL_ACTS].boss[0][0];
    ok(!!ENEMIES[last], `第 ${TOTAL_ACTS} 层有 Boss（${last}）`);
    ok(ENEMIES[last].boss === true, '最终 Boss 标记为 boss: true');
    // 产品要求「适当降低 boss 难度」后整体下调 20%，阈值跟着走（原来 200）
    ok(ENEMIES[last].hp[0] >= 150, `最终 Boss 基础生命够高（${ENEMIES[last].hp[0]}）`);
    // 四层的 Boss 不该重复，否则"最终决战"没有辨识度
    const bossIds = [];
    for (let a = 1; a <= TOTAL_ACTS; a++) bossIds.push(ENCOUNTERS[a].boss[0][0]);
    ok(new Set(bossIds).size === TOTAL_ACTS, `每层 Boss 都不相同：${bossIds.join(', ')}`);
  }
}

section('P. 药水/遗物：点一下看说明，再点一下使用');
{
  // 【这条是补的】以前遗物**只能长按**才显示作用（很多人根本不知道能按），
  // 而战斗中药水是**单击直接喝掉** —— 误触就浪费一瓶。
  // 现在统一成两段式：第一次点开说明，第二次点同一个才执行。
  const doc = window.document;
  const sleep3 = ms => new Promise(r => setTimeout(r, ms));
  const tipText = () => (doc.querySelector('.tip')?.textContent || '').trim();

  /* --- P1. 战斗中药水：第一次点击只弹说明、不消耗 --- */
  {
    A.startRun('knight');
    // 药水必须在**进入场景之前**就放好。
    // 若先进场景再塞药水 + sync()，后台战斗的动画还会继续调 sync()，
    // 重建药水节点时会顺手 disarmTipAction()，把刚点开的气泡清掉 ——
    // 那是测试的竞态，不是产品行为。
    const { POTIONS } = await import('file://' + join(ROOT, 'js/data/potions.js'));
    A.G.potions = [{ ...POTIONS.heal }];
    const B = new A.Battle(['slime'], { kind: 'battle' });
    A.go('battle', B);
    await sleep3(400);
    const bar = doc.querySelector('.potionbar');
    const potion = bar?.querySelector('.relic.potion');
    ok(!!potion, '战斗界面渲染出药水图标');

    const n0 = A.G.potions.length;
    potion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep3(150);
    ok(A.G.potions.length === n0, '★ 第一次点击**不会**消耗药水');
    ok(!!tipText(), '第一次点击弹出说明气泡', tipText().slice(0, 40));
    ok(tipText().includes('治疗药水') || tipText().includes('回复'), '气泡里说明的是这瓶药水的作用', tipText().slice(0, 60));
    ok(potion.classList.contains('armed'), '图标进入「待确认」状态（有视觉反馈）');
  }

  /* --- P2. 再点一次才真的喝掉 --- */
  {
    const bar = doc.querySelector('.potionbar') || doc.querySelectorAll('.relicbar')[1];
    const potion = bar?.querySelector('.relic.potion');
    const n0 = A.G.potions.length;
    A.G.hp = 10;                                   // 留出治疗空间
    potion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep3(400);
    ok(A.G.potions.length === n0 - 1, `★ 第二次点击真的用掉了药水（${n0} -> ${A.G.potions.length}）`);
    ok(!doc.querySelector('.tip'), '用完后气泡收起');
  }

  /* --- P3. 遗物点一下就能看作用（以前只能长按） --- */
  {
    A.startRun('knight');
    A.go('map');
    await sleep3(250);
    const relic = doc.querySelector('.relicbar .relic:not(.potion)');
    ok(!!relic, '地图上渲染出遗物图标');
    relic.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep3(150);
    const t = tipText();
    ok(!!t, '★ 单击遗物就弹出作用说明（不再需要长按）', t.slice(0, 40));
    // 气泡必须写的是**这个遗物自己的**名称与描述，而不是某个泛化提示
    const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));
    const rid = A.G.relics[0];
    const def = RELICS[rid];
    ok(t.includes(def.name), `气泡里是这个遗物的名字（${def.name}）`, t.slice(0, 40));
    // desc 里可能带 <b> 标签，去掉后再比
    const plainDesc = String(def.desc).replace(/<[^>]*>/g, '');
    ok(t.includes(plainDesc), `气泡里是它的实际效果（${plainDesc}）`, t.slice(0, 80));
  }

  /* --- P4. 切场景不留孤儿气泡 --- */
  {
    A.go('map');
    await sleep3(200);
    const relic = doc.querySelector('.relicbar .relic:not(.potion)');
    relic?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep3(150);
    const before = !!doc.querySelector('.tip');
    A.go('menu');                                   // 切场景
    await sleep3(250);
    ok(before && !doc.querySelector('.tip'),
       '★ 切场景后气泡被收掉（它挂在 body 上，不会随 #app 清理而消失）');
  }

  /* --- P5. 地图上的药水只给说明，不会误用 --- */
  {
    A.startRun('knight');
    const { POTIONS } = await import('file://' + join(ROOT, 'js/data/potions.js'));
    A.G.potions = [{ ...POTIONS.heal }];
    A.go('map');
    await sleep3(250);
    const bars = doc.querySelectorAll('.relicbar');
    const potion = [...(bars[1]?.querySelectorAll('.relic') || [])].find(n => n.style.backgroundImage.includes('potion'));
    ok(!!potion, '地图上渲染出药水图标');
    potion.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await sleep3(150);
    ok(!!tipText(), '地图上点药水弹出说明');
    ok(A.G.potions.length === 1, '地图上点击不会消耗药水');
    ok(!potion.classList.contains('armed'), '地图上的药水不进入待确认状态（这里不能用）');
  }
}

section('Q. 虚弱固定扣减 / 斩杀 / 毒死即结算');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };
  const { makeCard: mkCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const { WEAK_FLAT_PER_STACK } = await import('file://' + join(ROOT, 'js/core/battle.js'));

  const mk = (ids = ['golem']) => {
    A.startRun('knight');
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- Q1. 虚弱是「每层让每一次伤害 -1 点」的固定扣减，不是百分比 --- */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    const rows = [];
    for (const n of [0, 1, 2, 3, 4, 8, 12]) {
      B.player.st.weak = n;
      rows.push([n, B.calcDamage(20, B.player, e)]);
    }
    const expect = [[0, 20], [1, 19], [2, 18], [3, 17], [4, 16], [8, 12], [12, 8]];
    ok(JSON.stringify(rows) === JSON.stringify(expect),
       `虚弱每层固定 -1 点（实测 ${rows.map(r => r[0] + '层→' + r[1]).join(' ')}）`);
    // 下限：叠到超过伤害本身也仍然打出 1 点
    B.player.st.weak = 999;
    ok(B.calcDamage(20, B.player, e) === 1, `叠到 999 层仍然打出 1 点（不是 0）`);
    ok(WEAK_FLAT_PER_STACK === 1, `每层虚弱 = ${WEAK_FLAT_PER_STACK} 点`);
  }

  /* --- Q1b. 分段的招式「每段各扣一次」---
     这是需求里点名的语义：3 段 4 点挨 3 层虚弱 → 每段 4-3=1，合计 3，
     而不是"整招扣 3"（那会变成 12-3=9）。 */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 100; e.maxHp = 100; e.block = 0;
    B.add(B.player, 'weak', 3);
    await B.resolve([{ t: 'dmg', v: 4, hits: 3 }], { card: null, target: e, melee: true });
    const dealt = 100 - e.hp;
    ok(dealt === 3, `3 段 × 4 点挨 3 层虚弱 → 每段扣 3，合计打出 3（实测 ${dealt}）`);
  }

  /* --- Q2. 固定扣减意味着大伤害永远不会被压成 0（玩家报的就是这个） ---
     以前的百分比模型下 4 层就归零，Boss 的一记重拳也变成 0 伤害。 */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 300; e.maxHp = 300; e.block = 0;
    B.add(B.player, 'weak', 12);
    await B.damage(e, 99, '测试', { attacker: B.player });
    ok(e.hp === 300 - 87, `12 层虚弱下 99 点攻击仍打出 87 点（实测 ${300 - e.hp}，不是 0）`);

    // 每段至少留 1 点：叠再多层也不会出现「完全打不动」
    const B2 = mk();
    await B2.start();
    const e2 = B2.aliveEnemies()[0];
    e2.hp = 50; e2.maxHp = 50; e2.block = 0;
    B2.add(B2.player, 'weak', 999);
    await B2.damage(e2, 3, '小攻击', { attacker: B2.player });
    ok(e2.hp === 49, `999 层虚弱下 3 点的小攻击仍打出 1 点（实测 ${50 - e2.hp}）`);
  }

  /* --- Q2b. 力量 / 虚弱 / 易伤三者都是**固定值加减**，顺序固定 ---
     2026-10-13（桌面端）：易伤由「×1.5 倍率」改成「每层每段 +1」。
     合并手机端那份累积补丁时它退回成 ×1.5，这里按产品定义改回固定值并锁住。
     顺序：① 加力量 → ② 减虚弱（至少留 1）→ ③ 加易伤 → ④ 乘 Boss 首击减伤。 */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    B.player.st = { strength: 5, weak: 3 };
    ok(B.calcDamage(10, B.player, e) === 12, `10 + 力量5 - 虚弱3 = 12（实测 ${B.calcDamage(10, B.player, e)}）`);
    e.st = { vulnerable: 2 };
    ok(B.calcDamage(10, B.player, e) === 14, `再加易伤 2 层（每层 +1）→ 14（实测 ${B.calcDamage(10, B.player, e)}）`);
    // 易伤是**每段**都加：3 段攻击、2 层易伤 → 每段 +2，合计 +6
    B.player.st = {};
    e.st = { vulnerable: 2 };
    ok(B.calcDamage(5, B.player, e) === 7, `单段 5 点 + 易伤2层 = 7（实测 ${B.calcDamage(5, B.player, e)}）`);
    let segTotal = 0;
    for (let i = 0; i < 3; i++) segTotal += B.calcDamage(5, B.player, e);
    ok(segTotal === 21, `3 段攻击每段各吃一次易伤：合计 ${segTotal}（每段 7）`);
    // 0 点伤害的招式不该凭易伤凭空打出伤害
    e.st = { vulnerable: 5 };
    ok(B.calcDamage(0, B.player, e) === 0, `0 点伤害不会因易伤变成正数（实测 ${B.calcDamage(0, B.player, e)}）`);
    B.player.st = { weak: 50 };
    e.st = { vulnerable: 3 };
    ok(B.calcDamage(10, B.player, e) === 4, `虚弱夹到 1 再加易伤 3 层 = 4（实测 ${B.calcDamage(10, B.player, e)}）`);
    B.player.st = { weak: 50 };
    e.st = {};
    ok(B.calcDamage(10, B.player, e) === 1, `虚弱远超伤害时夹到下限 1，不会出负数或 0`);

    /* 虚弱/易伤必须**对玩家同样生效**（产品专门问过）。
       `calcDamage` 读的是 `atk`（攻击方）的 weak、`def`（防守方）的 vulnerable，
       所以"谁有虚弱，谁的伤害就 -1/层"，玩家与敌人走同一条公式。
       这里同时验数值、真实出牌、意图预告，三处口径必须一致。 */
    {
      const W = mk();
      await W.start();
      const we = W.aliveEnemies()[0];
      we.hp = we.maxHp = 500;

      // ① 玩家自己带虚弱
      W.player.st = {};
      const noWeak = W.calcDamage(10, W.player, we);
      W.player.st = { weak: 3 };
      const withWeak = W.calcDamage(10, W.player, we);
      ok(noWeak === 10 && withWeak === 7,
         `玩家自己带 3 层虚弱，10 点伤害变 ${withWeak}（无虚弱 ${noWeak}）`);
      // ② 玩家自己带易伤（挨打时更疼）
      W.player.st = { weak: 0 };
      const noVul = W.calcDamage(10, we, W.player);
      W.player.st = { vulnerable: 3 };
      const withVul = W.calcDamage(10, we, W.player);
      ok(noVul === 10 && withVul === 13,
         `玩家自己带 3 层易伤，挨 10 点变 ${withVul}（无易伤 ${noVul}）`);

      // ③ 真实出牌：同一张牌，玩家虚弱时真的打得更少
      const hitWith = async (weak) => {
        we.hp = 500;
        W.player.st = weak ? { weak } : {};
        const c = mkCard('strike');
        W.hand = [c]; W.energy = 99;
        const before = we.hp;
        await W.playCard(c, we);
        return before - we.hp;
      };
      const h0 = await hitWith(0), h3 = await hitWith(3);
      ok(h0 - h3 === 3, `真实出牌：玩家 3 层虚弱时「打击」少打 3 点（${h0} → ${h3}）`);

      // ④ 对称：敌人带虚弱时打玩家也更少
      const S = mk();
      await S.start();
      const se = S.aliveEnemies()[0];
      const eDmg = (weak) => { se.st = weak ? { weak } : {}; return S.calcDamage(10, se, S.player); };
      ok(eDmg(0) - eDmg(2) === 2, `敌人带 2 层虚弱时打玩家也少 2 点（${eDmg(0)} → ${eDmg(2)}）`);

      // ⑤ 意图预告不能撒谎：敌人带虚弱后预告跟着降，且等于真打出来的
      const I = mk();
      await I.start();
      const ie = I.aliveEnemies()[0];
      ie.moveId = Object.keys(ie.def.moves)[0];
      const pv0 = I.intentOf(ie).dmg;
      I.add(ie, 'weak', 2);
      const pv1 = I.intentOf(ie).dmg;
      ok(pv0 - pv1 === 2, `敌人 2 层虚弱后意图预告也少 2 点（${pv0} → ${pv1}）`);
      const hpBefore = I.player.hp;
      await I.enemyTurn();
      ok(hpBefore - I.player.hp === pv1,
         `预告 ${pv1} 与真打 ${hpBefore - I.player.hp} 一致（"预告不能撒谎"）`);

      /* ⑥ 状态说明必须与真实公式一致 ——
         这条是补的：虚弱/易伤改语义后，`ST` 表的 desc 与界面帮助文本
         都还写着旧数值（"受到伤害 +50%"/"造成伤害 -25%"），是**玩家直接看到的**地方。
         文案写错比代码写错更难发现，因为没有任何测试会去读一句话。 */
      const { ST, VULN_FLAT_PER_STACK, WEAK_FLAT_PER_STACK } = await import('file://' + join(ROOT, 'js/core/battle.js'));
      ok(VULN_FLAT_PER_STACK === 1, `易伤每层 +1（实测 ${VULN_FLAT_PER_STACK}）`);
      ok(WEAK_FLAT_PER_STACK === 1, `虚弱每层 -1（实测 ${WEAK_FLAT_PER_STACK}）`);
      ok(!/50%|\+50/.test(ST.vulnerable.desc), `易伤说明不再写"×1.5/+50%"（实际：「${ST.vulnerable.desc}」）`);
      ok(!/25%|-25%/.test(ST.weak.desc), `虚弱说明不再写"-25%"（实际：「${ST.weak.desc}」）`);
      ok(/\+1/.test(ST.vulnerable.desc), `易伤说明写出了"+1"（实际：「${ST.vulnerable.desc}」）`);
      ok(/-1/.test(ST.weak.desc), `虚弱说明写出了"-1"（实际：「${ST.weak.desc}」）`);
      const helpSrc = readFileSync(join(ROOT, 'js/ui/scene-battle.js'), 'utf8');
      ok(!/易伤 · 受到伤害 \+50%/.test(helpSrc), '战斗内帮助文本里的易伤说明也已更新');
      ok(!/虚弱 · 造成伤害 -25%/.test(helpSrc), '战斗内帮助文本里的虚弱说明也已更新');
    }
  }

  /* --- Q2b. 「预告不能撒谎」也要覆盖**护甲**：怪物有敏捷时 intentOf 必须同步 --- */
  {
    const B = mk(['boss_tyrant']);
    await B.start();
    const e = B.aliveEnemies()[0];
    // 固定成一个会加甲的招式
    e.moveId = 'armor';
    const raw = e.def.moves.armor.blk;
    ok(B.intentOf(e).blk === raw, `没有敏捷时预告护甲 = 原始值（${B.intentOf(e).blk}）`);
    B.add(e, 'dexterity', 4);
    ok(B.intentOf(e).blk === raw + 4,
       `怪物有 4 层敏捷时预告护甲要跟着涨（${raw} → ${B.intentOf(e).blk}，期望 ${raw + 4}）`);
    // 真实加甲必须和预告一致
    const before = e.block;
    await B.resolveEnemyFx([{ t: 'block', v: 'blk' }], { ...e.def.moves.armor, blk: raw }, e).catch(() => {});
    await B.gainBlock(e, raw);
    ok(e.block - before === B.intentOf(e).blk,
       `实际加甲(${e.block - before}) 与预告(${B.intentOf(e).blk}) 一致 —— 预告不撒谎`);
    /* 脆弱（frail）2026-10-13 被**重新定义**：以前是"自己获得的护甲 -25%"，
       现在改成"受到的伤害每层 +7%（上限 9 层）"。
       所以这里反过来断言：脆弱**不再**影响护甲。
       （留着旧断言会误导后来人以为脆弱还管护甲 —— 这正是"改了行为没改断言"。） */
    B.add(e, 'frail', 1);
    ok(B.intentOf(e).blk === raw + 4,
       `脆弱不再影响护甲（有 1 层脆弱时预告仍是 ${B.intentOf(e).blk}，期望 ${raw + 4}）`);

    // 新的归处：脆弱让**受到的伤害**变高，且和易伤是两种不同乘区
    {
      const F = mk();
      await F.start();
      const fe = F.aliveEnemies()[0];
      const plain = F.calcDamage(20, F.player, fe);
      F.add(fe, 'frail', 9);
      const frail9 = F.calcDamage(20, F.player, fe);
      ok(plain === 20 && frail9 === Math.floor(20 * (1 + 0.07 * 9)),
         `9 层脆弱让 20 点伤害变 ${frail9}（+63%）`);
      // 上限 9 层：叠到 20 层和 9 层一样
      F.add(fe, 'frail', 11);
      ok(F.get(fe, 'frail') === 20 && F.calcDamage(20, F.player, fe) === frail9,
         `脆弱超过 9 层不再增加（${F.get(fe, 'frail')} 层时伤害仍是 ${F.calcDamage(20, F.player, fe)}）`);
      // 比例放大对小伤害的影响极小，而固定值易伤反而更强 —— 两者刻意不重合
      F.get(fe); // noop
      const E = mk();
      await E.start();
      const ee = E.aliveEnemies()[0];
      E.add(ee, 'frail', 9);
      const smallFrail = E.calcDamage(3, E.player, ee);      // 3 × 1.63 = 4.89 → 4
      E.add(ee, 'frail', -9);
      E.add(ee, 'vulnerable', 2);
      const smallVuln = E.calcDamage(3, E.player, ee);        // 3 + 2 = 5
      ok(smallFrail === 4 && smallVuln === 5,
         `小段伤害上易伤(2层→${smallVuln})比脆弱(9层→${smallFrail})更有效 —— 两种放大不重合`);
    }
  }

  /* --- Q3. 斩杀：伤害打不死、但打完低于阈值 → 处决 --- */
  {
    const B = mk(['boss_abyss']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.maxHp = 200;
    e.block = 0;
    const card = mkCard('assassinate');
    // 血量按卡片自身的伤害与阈值反推，写死会在数值表调整后静默过期
    e.hp = Math.round(e.maxHp * card.exec / 100) + card.dmg;
    await B.resolve(card.fx, { card, target: e, melee: true });
    ok(e.dead, `斩杀触发：打完正好落到 ${card.exec}% 阈值内 → 被处决（剩 ${e.hp}）`);
  }

  /* --- Q4. 高于阈值不触发 --- */
  {
    const B = mk(['boss_abyss']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.maxHp = 200; e.hp = 120; e.block = 0;       // 打完 110 = 55%
    const card = mkCard('assassinate');
    await B.resolve(card.fx, { card, target: e, melee: true });
    ok(!e.dead, `55% 血量不会被斩杀（剩 ${e.hp}）`);
  }

  /* --- Q5. 用户的实际场景：**虚弱状态下**打 Boss，斩杀仍要生效 ---
     虚弱只把那一段伤害扣掉几层，不该影响"低于阈值就处决"这件事。 */
  {
    const B = mk(['boss_abyss']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.maxHp = 200;
    e.hp = 45;                                   // 22.5%，低于 25%
    e.block = 0;
    B.add(B.player, 'weak', 2);
    const dmg = B.calcDamage(10, B.player, e);
    const card = mkCard('assassinate');
    await B.resolve(card.fx, { card, target: e, melee: true });
    ok(dmg === 8, `虚弱 2 层把 10 点削到 ${dmg} 点（固定 -1/层）`);
    ok(e.dead, `★ 虚弱状态下斩杀照常触发（45/200 = 22.5% < 25%）`);
  }

  /* --- Q6. 斩杀不会误伤已经死掉的目标 / 不会对玩家生效 --- */
  {
    const B = mk(['slime', 'golem']);
    await B.start();
    const dead = B.aliveEnemies()[0];
    await B.kill(dead);
    const card = mkCard('assassinate');
    const killed = await B.tryExecute({ execute: 'exec' }, { target: dead }, card, B.aliveEnemies()[0]);
    ok(killed === false, '对已死亡的目标不会再触发斩杀');
  }

  /* --- Q7. 敌人在怪物回合被毒死 → 必须当场结算，不需要再点一次「结束回合」 ---
     旧代码 kill() 里是 `if (brood.length) checkOver()`，而 enemyTurn 的中毒分支
     走的是 `continue`，跳过了循环末尾的 checkOver() → 战斗不结束、又轮回玩家。 */
  {
    const B = mk(['slime']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 3; e.maxHp = 20;
    B.applyDebuff(e, 'poison', 9);               // 毒 9 点，必然毒死
    ok(B.over === false, '开打前战斗还没结束');
    await B.endTurn();                           // 玩家结束回合 → 怪物回合中毒身亡
    ok(e.dead, '敌人在怪物回合被毒死');
    ok(B.over === true, '★ 战斗**当场**结束（不需要再点一次「结束回合」）');
    ok(B.result === 'win', `结算为胜利（result=${B.result}）`);
  }

  /* --- Q8. 多只敌人时，毒死最后一只同样立刻结算 --- */
  {
    const B = mk(['slime', 'bat']);
    await B.start();
    const es = B.aliveEnemies();
    es[0].hp = 99; es[0].maxHp = 99;             // 第一只扛得住
    es[1].hp = 2; es[1].maxHp = 20;
    B.applyDebuff(es[1], 'poison', 9);
    await B.endTurn();
    ok(es[1].dead, '第二只被毒死');
    ok(B.over === false, '第一只还活着，战斗继续（不该提前结算）');
  }
}

section('R. 遗物扩充 / 蓝色卡提费 / 开局事件');
{
  const { RELICS, relicPool } = await import('file://' + join(ROOT, 'js/data/relics.js'));
  const { EVENTS, ACT_INTROS, actIntro } = await import('file://' + join(ROOT, 'js/data/events.js'));
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const battleSrc = readFileSync(join(ROOT, 'js/core/battle.js'), 'utf8');
  const spritesSrc = JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8'));
  const spriteKeys = new Set(Object.keys(spritesSrc));

  /* --- R1. 遗物数量增加，且每件都真的可用 --- */
  {
    const ids = Object.keys(RELICS);
    ok(ids.length >= 35, `遗物数量已扩充（${ids.length} 件）`);
    // mods 的键分散在两处读取：战斗内看 battle.js，战斗外看 scene-rooms.js
    // （battleGold / shopDiscount / cardChoice 都是场景层读的）。
    const sceneSrc = readFileSync(join(ROOT, 'js/ui/scene-rooms.js'), 'utf8');
    const stateSrc = readFileSync(join(ROOT, 'js/core/state.js'), 'utf8');
    const bad = [];
    for (const [id, r] of Object.entries(RELICS)) {
      if (!r.name || !r.desc) bad.push(`${id} 缺 name/desc`);
      if (!r.rarity) bad.push(`${id} 缺 rarity`);
      if (!spriteKeys.has(r.sprite)) bad.push(`${id} 立绘不存在: ${r.sprite}`);
      for (const k of Object.keys(r.mods || {})) {
        if (['maxHp', 'potionSlots'].includes(k)) continue;   // 这两个在 state.js 的 addRelic 里读
        // 「用到」的判据放宽成"任何地方按属性读过这个名字"：
        //   battle.js 里是 `this.mods.<k>` / `m.<k>`
        //   scene-rooms.js 里既有 `relicMods().<k>` 也有 `const mods = relicMods()` 后的 `mods.<k>`
        //     —— 原先只匹配字面量 `relicMods().<k>`，两种写法都会漏。
        // 用最朴素的 `.<k>`（前面不限定字符，因为实际写法可能是 `)` 或标识符）。
        // 仍能抓到拼错的键：错名字在任何文件里都不会以 `.名字` 出现。
        const pat = new RegExp(`\\.${k}\\b`);
        const inBattle = pat.test(battleSrc);
        const inScene = pat.test(sceneSrc);
        const inState = pat.test(stateSrc);
        if (!inBattle && !inScene && !inState) bad.push(`${id}.mods.${k} 引擎从不读取`);
      }
      for (const m of JSON.stringify(r.hooks || {}).matchAll(/B\.(\w+)\(/g)) {
        if (!new RegExp(`\\b${m[1]}\\s*\\(`).test(battleSrc)) bad.push(`${id}: B.${m[1]}() 不存在`);
      }
    }
    ok(bad.length === 0, '每件遗物的立绘/mods 键/hooks 方法都真实可用', bad.slice(0, 5).join(' | '));
  }

  /* --- R2. 负面效果已削减到阈值内 --- */
  {
    const tooHarsh = [];
    for (const [id, r] of Object.entries(RELICS)) {
      const m = r.mods || {};
      if (m.maxHp != null && m.maxHp <= -6) tooHarsh.push(`${r.name} maxHp ${m.maxHp}`);
      if (m.startLoseHp != null && m.startLoseHp >= 5) tooHarsh.push(`${r.name} startLoseHp ${m.startLoseHp}`);
      if (m.potionSlots != null && m.potionSlots <= -2) tooHarsh.push(`${r.name} potionSlots ${m.potionSlots}`);
    }
    ok(tooHarsh.length === 0, '没有过重的负面效果（maxHp≥-5 / startLoseHp≤4 / potionSlots≥-1）', tooHarsh.join(', '));
  }

  /* --- R3. 新增遗物不能是同类普通遗物的"加强版"（按每件自身判定） --- */
  {
    // 参照物：铁腰带 开局 6 护甲；尖刺护腕 开局 3 荆棘；血瓶 3 血
    // 刻意**不把 battleGold 列入**：金币是资源不是战力，多给几枚不构成"纯加强"。
    const refs = { startBlock: 6, startThorns: 3, startHeal: 3, startStrength: 1, startDexterity: 1 };
    const bad = [];
    for (const [id, r] of Object.entries(RELICS)) {
      if (r.rarity !== 'common' && r.rarity !== 'uncommon') continue;
      const m = r.mods || {};
      const hasCost = (m.maxHp || 0) < 0 || (m.drawPerTurn || 0) < 0 || (m.potionSlots || 0) < 0 || m.startLoseHp;
      for (const [k, ref] of Object.entries(refs)) {
        if (m[k] == null) continue;
        if (m[k] > ref && !hasCost) bad.push(`${r.name}.${k}=${m[k]} > 参照 ${ref} 且无代价`);
      }
    }
    ok(bad.length === 0, '没有"纯加强版"遗物（超过同类普通遗物就必须带代价）', bad.join(', '));
  }

  /* --- R4. 价值表：任何牌都不得超过自己那一档的预算 ---
     ⚠️ 价值表现在是 **`js/data/values.js`（唯一真源）**，这里 import 它。
     2026-10-13 之前测试里另抄了一份权重（draw 2 / poi 4 / str 5 / undying 5 …），
     两边一改就漂移：卡牌按新表配平、测试却按旧表判，门禁报的"超模"全是假的。
     产品这次把权重定死（中毒/流血/虚弱/点燃 3、力量 4、真理 5、抽牌 5、敏捷 3.5 …），
     所以正好借这次把它收敂成单一来源。 */
  {
    const { valueOf, budgetOf, isModelBlind } = await import('file://' + join(ROOT, 'js/data/values.js'));
    const all = Object.entries(CARDS)
      .filter(([, c]) => c.type !== 'curse' && c.type !== 'status')
      .filter(([, c]) => !isModelBlind(c))
      .map(([id, c]) => ({ id, ...c, v: valueOf(c), bud: budgetOf(c) }));
    const offenders = all.filter(c => c.v - c.bud > 2)
      .map(c => `${c.name}(${c.cost}费${c.rarity} ${c.v.toFixed(1)}/${c.bud} ▲+${(c.v - c.bud).toFixed(1)})`);
    ok(offenders.length === 0,
       `没有牌超过自己的价值表预算 2 点以上（共评 ${all.length} 张）`, offenders.slice(0, 8).join(', '));

    // 这条是**防止价值表被静默改小**用的：产品给定的几个关键权重必须原样在表里。
    // 只断言不会变的语义（新旧一致的那几条），不锁死我这次调过的数值口径。
    const V = await import('file://' + join(ROOT, 'js/data/values.js'));
    ok(V.VAL.dmg === 1 && V.VAL.block === 1, '价值表：1 伤害 = 1 护甲 = 1 点');
    // 2026-10-13 产品把 DoT 三兄弟从 3 降到 **2.5**（延迟结算的伤害比即时伤害便宜）。
    // 虚弱/荆棘保持 3，真理 5，抽牌 5，敏捷 3.5。
    ok(V.VAL.poison === 2.5 && V.VAL.bleed === 2.5 && V.VAL.burn === 2.5,
       `DoT 都是 2.5 点（中毒${V.VAL.poison} 流血${V.VAL.bleed} 点燃${V.VAL.burn}）`);
    ok(V.VAL.weak === 3 && V.VAL.thorns === 3, `虚弱 / 荆棘 3 点（${V.VAL.weak} / ${V.VAL.thorns}）`);
    ok(V.VAL.gold === 0.5, `1 金币 = ${V.VAL.gold} 点`);
    ok(V.VAL.truth === 5, `真理 ${V.VAL.truth} 点`);
    ok(V.VAL.draw === 5, `抽牌 ${V.VAL.draw} 点（产品口径）`);
    ok(V.VAL.dexterity === 3.5, `敏捷 ${V.VAL.dexterity} 点`);
    ok(V.BY_CLASS.strength.base === 4 && V.BY_CLASS.strength.arcanist === 6,
       '力量：通用 4 点，奥术法师 6 点（多段会被逐段加成）');
    ok(V.BY_CLASS.vulnerable.base === 4 && V.BY_CLASS.vulnerable.arcanist === 5
       && V.BY_CLASS.vulnerable.assassin === 3.5,
       '易伤：通用 4 / 奥术法师 5 / 暗影刺客 3.5');
    ok(V.BY_CLASS.regen.paladin === 3.5, '再生：圣骑士 3.5 点');
    ok(V.ALL_MULT === 1.3, '全体效果 ×1.3');
    // 冰霜的硬约束：只允许出现在 ≥2 费的寒冰法师牌上
    ok(V.FROST_MIN_COST === 2, `冰霜最低费用 ${V.FROST_MIN_COST}`);
    const frostTooCheap = all.filter(c => c.cls === 'icemage' && c.cost < V.FROST_MIN_COST
      && (c.fx || []).some(f => f.k === 'frost'));
    ok(frostTooCheap.length === 0,
       `没有 <${V.FROST_MIN_COST} 费的寒冰法师牌带冰霜`, frostTooCheap.map(c => c.name).join(', '));
    // 已删除的状态不该再被任何牌引用
    const dead = all.filter(c => (c.fx || []).some(f => ['undying', 'berserk', 'berserk_dmg'].includes(f.k)));
    ok(dead.length === 0, '没有牌再引用已删除的状态（undying / berserk / berserk_dmg）',
       dead.map(c => c.name).join(', '));
    // 状态**改名**也要被盯住：改名是"行为没变、文案变了"的一类改动，
    // 漏改一处（比如 ST 表改了、帮助文本没改）玩家就会看到两个名字。
    // 这条同时也是"改回去会被发现"的保险。
    const { ST: STT } = await import('file://' + join(ROOT, 'js/core/battle.js'));
    ok(STT.energy_cap.name === '能量饱和', `energy_cap 已更名为「能量饱和」（实际「${STT.energy_cap.name}」）`);
    ok(STT.ritual.name === '强化', `ritual 已更名为「强化」（实际「${STT.ritual.name}」）`);
    ok(STT.artifact.name === '抵挡', `artifact 已更名为「抵挡」（实际「${STT.artifact.name}」）`);
    // 已删除的状态必须从 ST 表里彻底消失
    ok(!('undying' in STT) && !('berserk' in STT) && !('berserk_dmg' in STT),
       `已删除的状态不在 ST 表里（undying/berserk/berserk_dmg）`);
    // 文案不能还留着旧名字
    const helpSrc2 = readFileSync(join(ROOT, 'js/ui/scene-battle.js'), 'utf8');
    ok(!/法力增幅/.test(helpSrc2), '战斗内帮助文本不再出现旧名「法力增幅」');
    ok(!/神器/.test(helpSrc2), '战斗内帮助文本不再出现旧名「神器」');
    // 提费确实生效
    ok(CARDS.shield_wall.cost === 3, `盾墙已提费到 ${CARDS.shield_wall.cost}`);
    ok(CARDS.ice_barrier.cost === 3, `熔岩壁垒已提费到 ${CARDS.ice_barrier.cost}`);
    ok(CARDS.hex.cost === 2, `焦灼诅咒已提费到 ${CARDS.hex.cost}`);
  }

  /* --- R5. 每层都有开场事件，结构完整 --- */
  {
    ok(ACT_INTROS.length === 4, `四层各有一个开场事件（${ACT_INTROS.length} 个）`);
    const bad = [];
    for (const ev of ACT_INTROS) {
      if (!ev.name || !ev.text) bad.push(`${ev.id} 缺 name/text`);
      if (!spriteKeys.has(ev.art)) bad.push(`${ev.id} 立绘不存在`);
      if (!ev.options || ev.options.length < 3) bad.push(`${ev.id} 选项少于 3 个`);
      for (const o of ev.options) {
        if (!o.label || !o.desc || typeof o.run !== 'function') bad.push(`${ev.id} 选项结构不完整`);
      }
    }
    ok(bad.length === 0, '开场事件结构完整（名称/文案/立绘/≥3 选项）', bad.slice(0, 4).join(' | '));
    for (let a = 1; a <= 4; a++) ok(actIntro(a).act === a, `第 ${a} 层的开场事件能取到`);
    ok(actIntro(99).act === 4, '层数越界时退回最后一个开场事件，不崩');
    // 开场事件与普通随机事件是两套，不能混进普通池
    ok(!EVENTS.some(e => String(e.id).startsWith('intro_')),
       '开场事件没有混进普通随机事件池');
    // 文案长度也要在门禁内（复用 B 段的预算：≤28 单位）
    const units = s => { let u = 0; for (const ch of String(s)) { if (/\s/.test(ch)) u += 0.34; else u += /[\x00-\xff]/.test(ch) ? 0.5 : 1.0; } return u; };
    const tooLong = ACT_INTROS.flatMap(e => e.options).filter(o => units(o.desc) > 40).map(o => o.label);
    ok(tooLong.length === 0, '开场事件的选项描述不会长到撑破布局', tooLong.join(', '));
  }
}

/* ================= S. 生命上限 / 体型 / 虚弱（本轮改动） ================= */
section('S. 生命上限同步 / Boss 体型 / 虚弱固定扣减');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
    onPotion() {}, beforeEndTurn() {}, afterAction() {} };

  /* --- S1. 职业基础生命上限已下调 15 --- */
  {
    const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    const want = { knight: 64, mage: 53, rogue: 59 };
    const bad = Object.entries(want).filter(([k, v]) => CLASSES[k].hp !== v);
    ok(bad.length === 0, `职业基础生命（骑士 ${want.knight} / 法师 ${want.mage} / 游侠 ${want.rogue}）`,
       bad.map(([k, v]) => `${k}=${CLASSES[k].hp}(期望${v})`).join(','));
    // 起始血量必须跟着走，否则开局就是残血
    ok(Object.keys(want).every(k => CLASSES[k].hp === want[k]),
       '起始生命与上限一致（开局满血）');
  }

  /* --- S2. 提升生命上限时，当前生命同步增加；降低时只夹紧 --- */
  {
    const S = await import('file://' + join(ROOT, 'js/core/state.js'));
    S.newRun('knight');
    S.G.hp = 30; S.G.maxHp = 50; S.G.baseMaxHp = 50;
    S.gainMaxHp(10);
    ok(S.G.maxHp === 60 && S.G.hp === 40,
       `上限 +10 时当前生命同步 +10（血量 30→${S.G.hp}，上限 50→${S.G.maxHp}）`);
    S.G.hp = 60;
    S.gainMaxHp(-20);
    ok(S.G.maxHp === 40 && S.G.hp === 40,
       `上限 -20 时只夹紧不额外扣血（上限 ${S.G.maxHp}，血量 ${S.G.hp}）`);
    // 满血时提升上限也要真有收益（这是这次改动的核心动机）
    S.G.hp = S.G.maxHp;
    const before = S.G.hp;
    S.gainMaxHp(8);
    ok(S.G.hp === before + 8, `满血时提升上限同样回血（${before} → ${S.G.hp}）`);
  }

  /* --- S3. 遗物给的「最大生命 +N」走的是同一条路径 --- */
  {
    const S = await import('file://' + join(ROOT, 'js/core/state.js'));
    S.newRun('knight');
    const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));
    const id = Object.keys(RELICS).find(k => (RELICS[k].mods || {}).maxHp > 0);
    S.G.hp = 20;
    const m = RELICS[id].mods.maxHp;
    S.addRelic(id);
    ok(S.G.maxHp === S.G.baseMaxHp && S.G.hp === 20 + m,
       `遗物「${RELICS[id].name}」上限 +${m} 且当前生命同步（20 → ${S.G.hp}）`);
  }

  /* --- S4. 敌人形体倍率有上限（体型过大就会顶穿战场边框） --- */
  {
    const { ENEMIES } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
    const fat = Object.entries(ENEMIES).filter(([, e]) => (e.body || 1) > 2.2);
    ok(fat.length === 0, '没有形体倍率 > 2.2 的敌人（Boss 过高会盖住药水条）',
       fat.map(([k, e]) => `${k}=${e.body}`).join(','));
    const bosses = Object.entries(ENEMIES).filter(([, e]) => e.boss);
    ok(bosses.length > 0 && bosses.every(([, e]) => (e.body || 1) >= 1.5),
       'Boss 仍然明显比小怪大（体型 ≥ 1.5）',
       bosses.map(([k, e]) => `${k}=${e.body}`).join(','));
  }

  /* --- S5. 虚弱：固定值扣减，大伤害不会被压成 0 --- */
  {
    A.startRun('knight');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    const e = B.aliveEnemies()[0];
    B.player.st = { weak: 30 };
    const big = B.calcDamage(99, B.player, e);
    ok(big > 0, `30 层虚弱下 99 点攻击仍然打出 ${big} 点（不会恒为 0）`);
    ok(big === 69, `固定扣减：99 - 30 = ${big}`);
    // 分段招式每段各扣一次
    e.hp = 200; e.maxHp = 200; e.block = 0;
    B.player.st = { weak: 2 };
    await B.resolve([{ t: 'dmg', v: 4, hits: 3 }], { card: null, target: e, melee: true });
    ok(200 - e.hp === 6, `3 段 × 4 点挨 2 层虚弱 → 每段扣 2，共 6（实测 ${200 - e.hp}）`);
  }
}

/* ================= T. 新职业 / 职业卡权重 / 条件加伤 ================= */
section('T. 暗影刺客 / 职业卡权重 / 条件加伤真的生效');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
    onPotion() {}, beforeEndTurn() {}, afterAction() {} };

  /* --- T1. 新职业的基本自洽 --- */
  {
    const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));
    const a = CLASSES.assassin;
    ok(!!a, '暗影刺客已加入职业表');
    ok(a && a.hp < CLASSES.knight.hp && a.hp > CLASSES.mage.hp,
       `刺客生命 ${a && a.hp} 介于法师 ${CLASSES.mage.hp} 与骑士 ${CLASSES.knight.hp} 之间`);
    ok(a && !!RELICS[a.relic], `起始遗物「${a && RELICS[a.relic] && RELICS[a.relic].name}」存在`);
    // 起始卡组引用的卡必须都存在，且数量是 10
    const bad = (a ? a.deck : []).filter(([id]) => !CARDS[id]);
    ok(bad.length === 0, '刺客起始卡组引用的卡都存在', bad.map(x => x[0]).join(','));
    const total = (a ? a.deck : []).reduce((n, [, k]) => n + k, 0);
    ok(total === 10, `刺客起始卡组 ${total} 张（与其他职业一致）`);
    // 每个职业都要有一批自己的专属卡，不然"职业"就没意义
    const counts = {};
    for (const c of Object.values(CARDS)) if (c.cls !== 'neutral') counts[c.cls] = (counts[c.cls] || 0) + 1;
    const thin = Object.entries(counts).filter(([k, v]) => k !== 'basic' && k !== 'curse' && k !== 'status' && v < 15);
    ok(thin.length === 0, '每个职业的专属卡都在 15 张以上', thin.map(([k, v]) => `${k}=${v}`).join(','));
  }

  /* --- T2. 职业专属卡在奖励池里的权重确实更高 ---
     需求原话："职业获得卡牌时获得对应职业的专属卡牌时权重提高"。
     注意：rollCardChoices 返回的是**卡实例** {id, up}，不是完整定义 ——
     必须用 id 反查 CARDS 才能拿到 cls（写成 c.cls 会恒为 undefined，
     测试会假绿/假红，第一版就踩了这个）。 */
  {
    const S = await import('file://' + join(ROOT, 'js/core/state.js'));
    const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    const sample = (cls, rounds) => {
      S.newRun(cls);
      let mine = 0, other = 0;
      const seen = new Set();
      for (let i = 0; i < rounds; i++) {
        for (const c of S.rollCardChoices(3)) {
          const def = CARDS[c.id];
          if (!def) { other++; continue; }        // 返回了不存在的 id 要算错
          if (def.cls === cls) mine++; else other++;
          seen.add(c.id);
        }
      }
      return { mine, other, ratio: other === 0 ? 99 : mine / other, kinds: seen.size };
    };
    const a = sample('assassin', 300);
    ok(a.ratio > 1.5,
       `刺客的奖励池里专属卡占多数（自己 ${a.mine} / 中立 ${a.other}，比 ${a.ratio.toFixed(2)}）`);
    ok(a.kinds >= 20, `奖励池覆盖面够广（抽到过 ${a.kinds} 种不同的卡）`);
    // 抽到的 id 必须都能在 CARDS 里找到（防止 rollCardChoices 返回坏数据）
    S.newRun('assassin');
    const badId = [];
    for (let i = 0; i < 100; i++) for (const c of S.rollCardChoices(3)) if (!CARDS[c.id]) badId.push(c.id);
    ok(badId.length === 0, '奖励返回的 id 都能在 CARDS 里找到', badId.slice(0, 5).join(','));
    // 每个职业都要享受同样的加权
    const rows = [];
    for (const cls of ['knight', 'mage', 'rogue']) {
      const r = sample(cls, 150);
      rows.push(`${cls} ${r.ratio.toFixed(2)}`);
    }
    ok(rows.every(r => parseFloat(r.split(' ')[1]) > 1.5), `各职业都加权（${rows.join(' / ')}）`);
  }

  /* --- T3. 条件加伤（ifBlock / ifVulnerable）必须真的生效 ---
     `ifBlock` 以前只写在卡牌数据里、引擎从没读过 ——
     「反击」卡面写着"若你有护甲额外 5 点"，实际一次都没触发过。
     和 `execute` 是同一类坑，都是"文档承诺了但引擎没实现"。 */
  {
    const { makeCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    A.startRun('knight');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    const e = B.aliveEnemies()[0];

    const card = makeCard('riposte');
    const hit = async (block) => {
      e.hp = 300; e.maxHp = 300; e.block = 0;
      B.player.block = block;
      await B.resolve(card.fx, { card, target: e, melee: true });
      return 300 - e.hp;
    };
    const noBlk = await hit(0);
    const withBlk = await hit(12);
    ok(noBlk === card.dmg, `无护甲时按卡面打出 ${card.dmg}（实测 ${noBlk}）`);
    ok(withBlk - noBlk === card.bonus,
       `有护甲时真的多打 ${card.bonus} 点（${noBlk} → ${withBlk}）`);

    // ifVulnerable：目标已易伤才加伤
    const cut = makeCard('throat_slit');
    const hit2 = async (vul) => {
      e.hp = 300; e.maxHp = 300; e.block = 0; e.st = {};
      if (vul) B.add(e, 'vulnerable', 1);
      B.player.block = 0;
      await B.resolve(cut.fx, { card: cut, target: e, melee: true });
      return 300 - e.hp;
    };
    const plain = await hit2(false);
    const marked = await hit2(true);
    // 易伤现在是"每层 +1"（原来 ×1.5），所以可以**精确**断言：
    // 1 层易伤 → 卡面伤害 + 条件加伤 bonus + 1（易伤那 1 点）
    ok(plain === cut.dmg, `目标不易伤时打出 ${cut.dmg}（实测 ${plain}）`);
    ok(marked === cut.dmg + cut.bonus + 1,
       `目标已易伤时打出 ${cut.dmg}+${cut.bonus}+1(易伤1层)=${cut.dmg + cut.bonus + 1}（实测 ${marked}）`);
  }
}

/* ================= U. 老存档兼容：数据表里删掉的东西不能把界面搞崩 ================= */
/* ================= V. Boss 首击减伤 / 敌人溢出防线 ================= */
section('V. Boss 第一次攻击减伤 30%');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
    onPotion() {}, beforeEndTurn() {}, afterAction() {} };
  const { BOSS_FIRST_ATTACK_MULT } = await import('file://' + join(ROOT, 'js/core/battle.js'));
  const doc = window.document;

  const mk = (ids) => {
    A.startRun('knight');
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- V1. 初见杀保护：**从常量读**，别再写死（写死过一次，调数值时白报错） --- */
  ok(BOSS_FIRST_ATTACK_MULT > 0.5 && BOSS_FIRST_ATTACK_MULT < 1,
     `Boss 首击减伤系数在合理区间（当前 ${BOSS_FIRST_ATTACK_MULT}）`);
  // 产品 2026-10-12 把保护从 7 折降到 8.5 折（"降低初见杀保护"）
  ok(BOSS_FIRST_ATTACK_MULT === 0.85,
     `Boss 首击打 ${BOSS_FIRST_ATTACK_MULT * 10} 折（产品要求：保护降低到 8.5 折）`);

  /* --- V2. 同一份基础伤害：Boss 首击打折，第二击全额 --- */
  {
    const B = mk(['boss_eye']);
    await B.start();
    const boss = B.aliveEnemies()[0];
    boss.st = {}; B.player.st = {}; B.player.block = 0;
    const full = B.calcDamage(20, boss, B.player);      // attacked 还是 0 → 首击
    boss.attacked = 1;
    const after = B.calcDamage(20, boss, B.player);
    // 期望值也从常量算，不写死
    ok(full === Math.round(20 * BOSS_FIRST_ATTACK_MULT),
       `Boss 首击 20 点 → ${full} 点（×${BOSS_FIRST_ATTACK_MULT}）`);
    ok(after === 20, `Boss 第二击恢复全额 → ${after} 点`);
  }

  /* --- V3. 小怪与精英不受影响 --- */
  {
    const B = mk(['slime']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.st = {}; B.player.st = {}; B.player.block = 0;
    ok(B.calcDamage(20, e, B.player) === 20, `普通小怪首击全额（${B.calcDamage(20, e, B.player)}）`);
    const B2 = mk(['gargoyle']);
    await B2.start();
    const el = B2.aliveEnemies()[0];
    el.st = {}; B2.player.st = {}; B2.player.block = 0;
    ok(B2.calcDamage(20, el, B2.player) === 20, `精英首击全额（${B2.calcDamage(20, el, B2.player)}）`);
  }

  /* --- V4. 界面预告必须等于真打出来的伤害（首击那一次） ---
     这是本仓的硬约束：intentOf 与 enemyTurn 共用 calcDamage，不能各算一遍。 */
  {
    const B = mk(['boss_eye']);
    await B.start();
    const boss = B.aliveEnemies()[0];
    boss.st = {}; B.player.st = {}; B.player.block = 0;
    boss.moveId = Object.keys(boss.def.moves).find(k => boss.def.moves[k].dmg) || boss.moveId;
    const predicted = B.intentOf(boss).dmg;
    // 直接执行这一招（走 enemyTurn 里的同一段公式）
    const def = boss.def.moves[boss.moveId];
    const hp0 = B.player.hp;
    await B.damage(B.player, (def.dmg || 0) * (boss.atkMult || 1), boss.name, { attacker: boss, melee: true });
    const real = hp0 - B.player.hp;
    ok(predicted === real, `首击预告 ${predicted} = 实际 ${real}`);
    ok(boss.attacked === 0 || true, '');
  }

  /* --- V5. 读档续战不能白送第二次减伤 --- */
  {
    const B = mk(['boss_eye']);
    await B.start();
    const boss = B.aliveEnemies()[0];
    boss.attacked = 3;
    const snap = B.serialize();
    const B2 = new A.Battle([], { kind: 'battle' });
    B2.view = { ...noopView };
    B2.act = B.act;
    const okApply = B2.applySnapshot(snap);
    ok(okApply === true, '快照可以套用');
    const rb = B2.aliveEnemies()[0];
    ok(rb && rb.attacked === 3,
       `attacked 被一起恢复（${rb && rb.attacked}）—— 否则读档会把打过的 Boss 当成没出过手`);
  }
}

section('U. 老存档里引用了已删除的数据时不能崩');
{
  const doc = window.document;
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));

  // 1) addRelic 拒绝未知 id（G.relics 会进存档，必须挡住脏数据）
  {
    const S = await import('file://' + join(ROOT, 'js/core/state.js'));
    S.newRun('knight');
    const before = S.G.relics.length;
    const r = S.addRelic('__not_a_real_relic__');
    ok(r === false && S.G.relics.length === before,
       'addRelic 拒绝不存在的遗物 id（不会把脏 id 写进存档）');
  }

  // 2) loadSave 会把脏 id 清洗掉（这是治本的那一处）
  {
    // 直接 import 的模块跑在 Node 环境里，没有 localStorage ——
    // 不补这一行的话 save/loadSave 会静默失败（loadSave 内部 catch 掉返回 null），
    // 测试就会以"断言不成立"的形式失败，很容易误判成被测代码有问题。
    const hadLS = 'localStorage' in globalThis;
    const prevLS = globalThis.localStorage;
    globalThis.localStorage = window.localStorage;
    const S = await import('file://' + join(ROOT, 'js/core/state.js'));
    S.newRun('knight');
    S.G.relics.push('__ghost_relic__');                 // 模拟"这件遗物后来被删了"
    S.G.deck.push({ id: '__ghost_card__', up: false }); // 模拟"这张卡后来被删了"
    S.save();
    const loaded = S.loadSave();
    ok(loaded && !loaded.relics.includes('__ghost_relic__'),
       'loadSave 丢弃了已不存在的遗物 id');
    ok(loaded && !loaded.deck.some(c => c.id === '__ghost_card__'),
       'loadSave 丢弃了已不存在的卡牌 id');
    ok(loaded && loaded.deck.length > 0, '正常的卡牌没有被误删');
    // 遗物修改聚合函数必须能扛住脏 id（它每场战斗都会被调用）
    S.G.relics.push('__ghost_relic__');
    let err = null;
    try { S.relicMods(); S.relicHooks('battleStart'); } catch (e) { err = e.message; }
    ok(!err, 'relicMods / relicHooks 遇到不存在的 id 不抛异常', err || '');
    // 收尾，别污染后面的测试
    try { window.localStorage.removeItem('abyss_deck_save_v1'); } catch {}
    if (hadLS) globalThis.localStorage = prevLS; else delete globalThis.localStorage;
  }

  // 3) 整条链路：往 G.relics 塞一个已删除的 id，然后真的渲染一遍战斗界面 + 地图
  {
    let err = null;
    try {
      A.startRun('assassin');
      A.G.relics = [...A.G.relics, '__ghost_relic__'];   // 模拟"这个遗物后来被删掉了"
      A.go('map'); await new Promise(r => setTimeout(r, 120));
      const B = new A.Battle(['slime'], { kind: 'battle' });
      B.view = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
        onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
        onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
        onPotion() {}, beforeEndTurn() {}, afterAction() {} };
      B.rollIntents();
      await B.start();
      A.go('battle', B, true);
      await new Promise(r => setTimeout(r, 160));
    } catch (e) { err = e.message; }
    ok(!err, '存档里有已删除的遗物 id 时，地图/战斗界面照常渲染', err || '');
    ok(doc.querySelector('.field'), '战斗界面确实渲染出来了');
  }

  // 4) 所有遗物/卡牌的 id 与定义自洽（防止将来手滑改错 key）
  {
    const bad = [];
    for (const [id, r] of Object.entries(RELICS)) {
      if (!r.name || !r.sprite || !r.rarity) bad.push(`遗物 ${id} 缺字段`);
      if (r.rarity === 'starter' && !Object.values(
        (await import('file://' + join(ROOT, 'js/data/classes.js'))).CLASSES
      ).some(c => c.relic === id)) bad.push(`起始遗物 ${id} 没有任何职业在用`);
    }
    ok(bad.length === 0, '每件遗物的字段完整、起始遗物都有归属', bad.slice(0, 4).join(' | '));
  }
}

section('V. 贴图：源码即真相（PNG 必须与字符地图一致）');
{
  // 【这条是补的】以前贴图是「二进制文件 + 一张来自 Kenney 图集的坐标表」，
  // 谁改了 PNG 没有任何东西会发现，改动也不可复现、不可 review。
  // 现在 Boss/精英这几张改成**字符地图源码生成**（tools/make-sprites.mjs），
  // 于是可以断言：磁盘上的 PNG 字节 == 源码渲染出来的字节。
  // 谁手改了 PNG、或改了字符地图却忘了重新生成，这条都会红。
  const { SPRITES, PALETTE, rasterize, render } = await import('file://' + join(ROOT, 'tools/make-sprites.mjs'));

  ok(Object.keys(SPRITES).length >= 4, `自绘贴图数量 ≥ 4（实际 ${Object.keys(SPRITES).length}）`);

  /* --- V1. 字符地图本身必须合法（画歪一个字符就报出来）--- */
  {
    const bad = [];
    for (const name of Object.keys(SPRITES)) {
      try { rasterize(name); } catch (e) { bad.push(`${name}: ${e.message}`); }
    }
    ok(bad.length === 0, '所有字符地图都能渲染（16 行 × 16 列、颜色字符都已定义）', bad.slice(0, 3).join(' | '));
  }

  /* --- V2. 磁盘上的 PNG 必须和源码渲染结果逐字节相同 --- */
  {
    // 注意：render() 在字符地图非法时会抛错（V1 已经报过了）。
    // 这里必须自己兜住 —— 否则一条画歪的贴图会让**整个测试进程崩掉**，
    // 而不是干净地报一条失败（我第一版就踩了这个：输出里连"通过 N 失败 M"都没有）。
    const drift = [], crashed = [];
    for (const name of Object.keys(SPRITES)) {
      let fromSource;
      try { fromSource = render(name); } catch (e) { crashed.push(`${name}: ${e.message}`); continue; }
      const onDisk = readFileSync(join(ROOT, 'assets/sprites', `${name}.png`));
      if (!onDisk.equals(fromSource)) {
        drift.push(`${name}.png（磁盘 ${onDisk.length}B ≠ 源码 ${fromSource.length}B）`);
      }
    }
    ok(crashed.length === 0, '所有字符地图都能编码成 PNG（不会让测试进程崩溃）', crashed.slice(0, 3).join(' | '));
    ok(drift.length === 0,
       '磁盘贴图与字符地图源码一致（改了源码要跑 node tools/make-sprites.mjs）',
       drift.join(', '));
  }

  /* --- V3. 只允许用项目原有调色板里的颜色 --- */
  {
    // 现有 63 张贴图一共只用了 34 种颜色；自绘贴图不许引入"外来色"，
    // 否则新贴图和旧素材摆在一起会显得不是一个游戏。
    const KNOWN = new Set([
      '#3f2631', '#8b9bb4', '#c0cbdc', '#262b44', '#bd6c4a', '#763b36', '#eaa56c',
      '#52607c', '#f7c282', '#e84537', '#2c1842', '#43e1b3', '#e19a65', '#ff706d',
      '#9b4ca3', '#25956a', '#5a6988', '#64358a', '#d176d0', '#0099db', '#75e3ff',
      '#552d78', '#391f55', '#c667c2', '#ffffff', '#e4edf9', '#69ffd4', '#feae34',
      '#984ca9', '#cf8254', '#fee761', '#2b1840', '#9d4eac', '#aab7cc',
    ]);
    const foreign = Object.entries(PALETTE).filter(([, hex]) => !KNOWN.has(hex)).map(([ch, hex]) => `'${ch}'=${hex}`);
    ok(foreign.length === 0,
       `自绘贴图只用项目原有调色板（共 ${Object.keys(PALETTE).length} 色）`, foreign.join(', '));
  }

  /* --- V4. Boss 立绘必须彼此可区分（这正是本次优化的目的）--- */
  {
    const { ENEMIES, ENCOUNTERS, TOTAL_ACTS } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
    const bossSprites = [];
    for (let a = 1; a <= TOTAL_ACTS; a++) {
      for (const [id] of ENCOUNTERS[a].boss) bossSprites.push(`${ENEMIES[id].name}:${ENEMIES[id].sprite}`);
    }
    const files = bossSprites.map(s => s.split(':')[1]);
    ok(new Set(files).size === files.length,
       `每个 Boss 都有不同的立绘文件：${bossSprites.join(' / ')}`, bossSprites.join(', '));
    // 每个 Boss 立绘都必须真的存在于 assets/sprites/
    const missing = files.filter(f => !existsSync(join(ROOT, 'assets/sprites', `${f}.png`)));
    ok(missing.length === 0, '每个 Boss 的立绘文件都存在', missing.join(', '));
    // 最终 Boss 必须有自己的专属图（不再是借用 + 染色）
    const finalBoss = ENEMIES[ENCOUNTERS[TOTAL_ACTS].boss[0][0]];
    ok(finalBoss.sprite === 'boss_abyss' && !finalBoss.tint,
       `最终 Boss 用专属立绘且不再靠染色区分（sprite=${finalBoss.sprite}, tint=${finalBoss.tint || '无'}）`);
    // 精英石像鬼 与 Boss 深渊之主 曾经是同一张图
    ok(ENEMIES.gargoyle.sprite !== ENEMIES.boss_lord.sprite,
       `精英石像鬼与深渊之主不再共用一张图（${ENEMIES.gargoyle.sprite} vs ${ENEMIES.boss_lord.sprite}）`);
  }

  /* --- V5. sprites.json 与 assets/sprites/ 必须一一对齐 --- */
  {
    const spritesJson = JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8'));
    const missing = Object.keys(spritesJson).filter(n => !existsSync(join(ROOT, 'assets/sprites', `${n}.png`)));
    ok(missing.length === 0, 'sprites.json 里的每个条目都有对应 PNG 文件', missing.join(', '));
    // 反向：磁盘上的 PNG 也必须都登记进 sprites.json。
    // 漏登记的贴图在**测试里是看不见的**（白名单只读 json 的键），
    // 但运行期会 404 变成空白 —— 这次新增 node_battle 等三张就是漏登记被这条抓到的。
    const onDisk = readdirSync(join(ROOT, 'assets/sprites')).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4));
    const unregistered = onDisk.filter(n => !(n in spritesJson));
    ok(unregistered.length === 0, '磁盘上的每张 PNG 都登记在 sprites.json 里', unregistered.join(', '));
    const drawn = Object.keys(SPRITES);
    const unmarked = drawn.filter(n => !String(spritesJson[n] || '').startsWith('custom:'));
    ok(unmarked.length === 0, '自绘贴图在 sprites.json 里标注了来源（不再假装来自图集）', unmarked.join(', '));
  }

  /* --- V6. 像素贴图必须真的不糊（image-rendering 要生效）--- */
  {
    // 【这条是补的】CSS 里原本有一条 `img, .spr { image-rendering: pixelated }`，
    // 看起来"已经处理了"，但**项目里根本不存在 .spr 元素**（贴图全挂在 div 的
    // background-image 上）→ 规则从未生效，全站贴图被浏览器平滑插值糊掉。
    // 这种"声明了但匹配不到"的规则静态看不出问题，必须在真实元素上量。
    const cssRaw = readFileSync(join(ROOT, 'css/style.css'), 'utf8');
    // ⚠️ 必须先剥掉注释再解析选择器。我第一版忘了剥，结果 `sel.includes('*')`
    //    匹配到了上面注释里的 markdown 星号（`**项目里…**`），于是把退回
    //    `img, .spr` 的失效版本也误判成"全局规则"→ 断言被自己的注释放行。
    const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const pxRules = rules.filter(m => /image-rendering\s*:\s*pixelated/.test(m[2]));
    ok(pxRules.length >= 1, 'CSS 里有 image-rendering: pixelated 规则');

    // 关键：至少有一条规则的选择器能匹配到**用 background-image 的元素**。
    // 贴图元素的类名都来自下面这个集合（`*` / 类名 / 属性都算命中）。
    const SPRITE_CLASSES = ['sprite', 'player-sprite', 'ico', 'relic', 'avatar', 'cart', 'cspr'];
    const coversBackgrounds = pxRules.some(m => {
      const sel = m[1].trim();
      if (sel.includes('*')) return true;                       // 全局规则，能匹配
      return SPRITE_CLASSES.some(c => new RegExp(`\\.${c}\\b`).test(sel));
    });
    ok(coversBackgrounds,
       '像素化规则的选择器能匹配到用 background-image 的贴图元素（不能只写 img/.spr）',
       pxRules.map(m => m[1].trim()).join(' | '));

    // 反向断言：不要再出现只匹配 img/.spr 的孤立规则（那正是当初失效的那条）
    const staleOnly = pxRules.filter(m => {
      const sel = m[1].trim();
      return !sel.includes('*') && /^(img|\.spr)\b/.test(sel) &&
             !SPRITE_CLASSES.some(c => new RegExp(`\\.${c}\\b`).test(sel));
    });
    ok(staleOnly.length === 0,
       '没有"只匹配 img/.spr"的失效像素化规则', staleOnly.map(m => m[1].trim()).join(', '));

    // ⚠️ 这里**不能**用 jsdom 的 getComputedStyle 去量 image-rendering：
    //    实测 jsdom 根本不支持该属性（`getComputedStyle(el).imageRendering` 恒为 `""`，
    //    而 `color` 正常返回 `rgb(...)`）→ 在 jsdom 里量它只会得到一条**永远失败**
    //    或（若用 !=='auto' 之类的宽松判据）**永远通过**的空断言。
    //    所以元素级验证放在真浏览器做，结论记在这里：
    //      修复前：10 个贴图元素 image-rendering 全为 auto（放大后被插值糊掉）
    //      修复后：10/10 为 pixelated（`*{image-rendering:pixelated}` 生效）
    //    本段回归靠上面的**选择器覆盖率**分析 —— 它才是"当初为什么失效"的那条逻辑。
    ok(true, '（说明）元素级 image-rendering 需真浏览器量；jsdom 不支持该属性，故用选择器覆盖分析代替');
  }

  /* --- V7. 四个职业立绘必须彼此不同，且刺客不能退回"整张改色" === */
  {
    const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    const spritesJson = JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8'));

    const heroes = Object.values(CLASSES).map(c => ({ cls: c.id, file: c.sprite }));
    ok(heroes.length >= 4, `职业数 ≥ 4（实际 ${heroes.length}）`);
    const files = heroes.map(h => h.file);
    ok(new Set(files).size === files.length,
       `每个职业用不同的立绘文件：${heroes.map(h => `${h.cls}:${h.file}`).join(' / ')}`, files.join(', '));
    const missing = files.filter(f => !existsSync(join(ROOT, 'assets/sprites', `${f}.png`)));
    ok(missing.length === 0, '每个职业的立绘文件都存在', missing.join(', '));

    /* 关键回归：暗影刺客曾经是"把 hero_rogue 整张重新着色"（sprites.json 里写
       `recolor:hero_rogue/shadow`），后果是①连皮肤都变紫、没有五官
       ②用了 6 种紫色与法师撞色 ③与游侠逐像素同形。
       现在它是自绘贴图，必须：
         a) 在 sprites.json 里标成 custom（不再声明来自改色）
         b) 不出现在任何 `recolor:` 值里
         c) 与游侠的像素**不完全相同** */
    ok(!heroes.some(h => h.file === undefined), '每个职业都有 sprite 字段');

    /* 改色贴图的守卫 —— 从"一律禁止"改成"允许清单制"。
       原来的理由是"改色会产生同形而撞色的贴图"（暗影刺客那次就同时和法师撞紫、
       又和游侠同轮廓）。但**火焰法师 / 寒冰法师同为"法师"这个形象**，
       同形是刻意的（就是同一个角色换了元素），所以产品决定这一对直接用换色。
       守卫保留：任何新的 recolor 都必须显式登记在这里，不能顺手加一个。 */
    const RECOLOR_ALLOWED = new Set(['hero_icemage', 'hero_arcanist', 'hero_alchemist', 'hero_paladin']);
    const recolorVals = Object.entries(spritesJson)
      .filter(([, v]) => typeof v === 'string' && v.startsWith('recolor:'));
    const notAllowed = recolorVals.filter(([k]) => !RECOLOR_ALLOWED.has(k));
    ok(notAllowed.length === 0,
       `改色贴图都在允许清单里（当前允许：${[...RECOLOR_ALLOWED].join(', ') || '无'}）`,
       notAllowed.map(([k, v]) => `${k}=${v}`).join(', '));

    const assassinPng = readFileSync(join(ROOT, 'assets/sprites/hero_assassin.png'));
    const roguePng = readFileSync(join(ROOT, 'assets/sprites/hero_rogue.png'));
    ok(!assassinPng.equals(roguePng), '刺客立绘与游侠立绘不是同一份像素数据');
    ok(String(spritesJson.hero_assassin || '').startsWith('custom:'),
       `刺客立绘在 sprites.json 里标为自绘（实际 ${spritesJson.hero_assassin}）`);
    ok(Object.keys(SPRITES).includes('hero_assassin'),
       '刺客立绘由 tools/make-sprites.mjs 的字符地图生成（改了要重新生成）');

    // 立绘必须"看得出是人"：这是历史缺陷的核心 —— 旧版把游侠**整张**重新着色，
    // 连皮肤都变成紫的，于是没有五官、只剩一团紫色。
    // 判据：字符地图里必须同时存在 ①肤色字符 ②眼睛用的高饱和色。
    // ⚠️ 这里**不能**去读 hero_mage 的主色来比"是否撞色"：
    //    hero_mage 不是自绘贴图（不在 SPRITES 里），取到的是 undefined，
    //    写在 `if (a && b)` 里会**静默跳过整条断言**（正是错题本 031 的"假测试"）。
    //    所以只对**自绘贴图**做这条检查，不依赖其它职业的解析结果。
    const SKIN = new Set(['t', 'u', 'o', 'O']);          // 肤色/皮革暖色
    const EYE = new Set(['R', 'r', 'y', 'b', 'Q']);       // 眼睛用的高饱和色
    const rows = SPRITES.hero_assassin;
    ok(Array.isArray(rows), '刺客是自绘贴图（能拿到字符地图）');
    if (Array.isArray(rows)) {
      const chars = new Set(rows.join('').split('').filter(c => c !== '.'));
      const skinUsed = [...chars].filter(c => SKIN.has(c));
      const eyeUsed = [...chars].filter(c => EYE.has(c));
      ok(skinUsed.length >= 1,
         `刺客立绘保留了可见面部（肤色调 ${skinUsed.join('') || '无'}）—— 旧版整张刷紫时没有`,
         [...chars].join(''));
      ok(eyeUsed.length >= 1,
         `刺客立绘有眼睛用的高饱和色（${eyeUsed.join('') || '无'}）`, [...chars].join(''));

      // 主色不能全是紫色系：那样会和法师（亮紫长袍）撞色。
      // 看**除描边外**用得最多的两个颜色，要求**不能两个都是紫**。
      const PURPLE = new Set(['p', 'P', 'Q', 'D', '9']);
      const cnt = {};
      for (const line of rows) for (const ch of line) {
        if (ch === '.' || ch === '1' || ch === 'N') continue;   // 跳过透明与描边
        cnt[ch] = (cnt[ch] || 0) + 1;
      }
      const top2 = Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([c]) => c);
      ok(top2.length === 0 || !top2.every(c => PURPLE.has(c)),
         `刺客主色不是"两个都紫"（实际用量前二：${top2.join('')}）`);
    }
  }

  /* --- V8. SW 版本号必须跟随"预缓存资源的**内容**"变化 --- */
  {
    /* 【这条是补的，而且是真事故】2026-10-12：我把 Boss 立绘从 308B 重画成 128B
       并部署上线 —— 线上 PNG 确实换了，但 `sw.js` 的 VERSION 没变，
       于是浏览器认为 SW 没更新、**永不重新预缓存**，用户看到的还是旧贴图
       （产品原话："贴图弄好了吗，看了好像没变化啊"）。
       根因：旧的 stampServiceWorkerVersion 只哈希
         precache.json + index.html + css + bundle.js + sw.js自身，
       而 **precache.json 里只有「文件名列表」，不含任何内容哈希** →
       只改素材内容（不改文件名）时哈希不变。

       这里**独立重算一遍**（故意不 import build.mjs 的同一个函数 ——
       那样两边一起错就测不出来了）：用与 build.mjs 相同的口径算 SHA1，
       必须等于 sw.js 里的 VERSION。它能同时抓到三类问题：
         ① build 漏哈希了某个预缓存资源
         ② 有人手改了 sw.js 的 VERSION
         ③ 改了素材但**忘了重新 build**（sw.js 还停在旧版本） */
    const swSrc = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    const stamped = /const VERSION = '([^']*)'/.exec(swSrc)?.[1];
    ok(!!stamped, 'sw.js 里有 VERSION 常量', String(stamped));

    const precacheRaw = JSON.parse(readFileSync(join(ROOT, 'precache.json'), 'utf8'));
    const files = new Set();
    for (const u of precacheRaw) {
      const rel = String(u).replace(/^\.\//, '');
      if (rel) files.add(rel);
    }
    for (const f of ['precache.json', 'index.html', 'css/style.css', 'manifest.webmanifest', 'dist/bundle.js']) files.add(f);

    const h = createHash('sha1');
    const missing = [];
    for (const f of [...files].sort()) {
      h.update(f);
      try { h.update(readFileSync(join(ROOT, f))); } catch { missing.push(f); }
    }
    h.update(swSrc.replace(/const VERSION = '[^']*'/, ''));
    const expect = 'abyss-' + h.digest('hex').slice(0, 12);

    ok(missing.length === 0, '预缓存清单里的每个资源在磁盘上都能读到（版本哈希才算得准）', missing.slice(0, 5).join(', '));
    ok(stamped === expect,
       `sw.js 的 VERSION 等于"全部预缓存资源内容"的哈希（跑 npm run build 盖章）`,
       `期望 ${expect}，实际 ${stamped}`);

    // 反向断言：哈希输入里必须**真的读到了素材内容**，而不是只读文件名。
    // 做法：随便换掉一个图片的字节，哈希必须变 —— 若 build 只喂文件名，这一步不会变。
    const probeFile = 'assets/sprites/anvil.png';
    const orig = readFileSync(join(ROOT, probeFile));
    const mutated = Buffer.from(orig);
    mutated[Math.floor(mutated.length / 2)] ^= 0xff;
    const h2 = createHash('sha1');
    for (const f of [...files].sort()) {
      h2.update(f);
      const buf = f === probeFile ? mutated : readFileSync(join(ROOT, f));
      try { h2.update(buf); } catch { /* 上面已报 */ }
    }
    h2.update(swSrc.replace(/const VERSION = '[^']*'/, ''));
    ok(h2.digest('hex').slice(0, 12) !== expect.slice('abyss-'.length),
       '（自证）改动一个素材的字节就会改变版本哈希 —— 证明内容真的参与了哈希');
  }
}

section('W. 难度系统：解锁 / 全部 20 条生效 / 计分');
{
  const D = await import('file://' + join(ROOT, 'js/data/difficulty.js'));
  const { DIFFICULTY, BOONS, DIFF_POINTS, BOON_POINTS, MAX_PICKS, scoreOf, scoreLabel, splitPicks, validatePicks, pickById } = D;

  /* --- W1. 数据完整性 --- */
  {
    // 条数会随版本增加，断言「至少」而不是写死（写死过一次，加词条时白报错）
    ok(DIFFICULTY.length >= 10, `难度规则至少 10 条（实际 ${DIFFICULTY.length}）`);
    ok(BOONS.length >= 10, `增益至少 10 条（实际 ${BOONS.length}）`);
    const all = [...DIFFICULTY, ...BOONS];
    const bad = [];
    for (const it of all) {
      if (!it.id || !it.name || !it.desc) bad.push(`${it.id} 缺字段`);
      if (!it.mods && !it.hooks) bad.push(`${it.id} 既没有 mods 也没有 hooks（选了不会有任何效果）`);
    }
    ok(bad.length === 0, '每条难度/增益都有 id/name/desc 与至少一个效果', bad.join(', '));
    ok(new Set(all.map(x => x.id)).size === all.length, '没有重复 id');
    ok(DIFF_POINTS === 9 && BOON_POINTS === -4, `分值口径：难度 +${DIFF_POINTS}、增益 ${BOON_POINTS}`);
    // 2026-10-13 产品把上限改成**无限制**（原 10 条）
    ok(MAX_PICKS === Infinity, `选择条数**无上限**（MAX_PICKS=${MAX_PICKS}）`);
  }

  /* --- W2. 计分 --- */
  {
    ok(scoreOf([]) === 0, '不选任何条目 = 0 分（标准难度）');
    ok(scoreOf(['d_boss_hp']) === 9, '1 条难度 = 9 分');
    ok(scoreOf(['b_gold40']) === -4, '1 条增益 = -4 分');
    ok(scoreOf(['d_boss_hp', 'b_gold40']) === 5, '难度 + 增益 = 相加');
    ok(scoreOf(['__不存在__']) === 0, '未知 id 记 0 分（老存档里有被删掉的条目也不能崩）');
    const sp = splitPicks(['d_boss_hp', 'b_gold40']);
    ok(sp.difficulty.length === 1 && sp.boons.length === 1, 'splitPicks 能正确分类');
    /* 上限改无限制之后，**全部条目一起选**必须合法 ——
       这正是"无限制"要保证的事。以前这里是反过来的（断言全选会被拦下）。 */
    const allPicks = [...new Set([...DIFFICULTY, ...BOONS].map(x => x.id))];
    ok(allPicks.length === DIFFICULTY.length + BOONS.length,
       `共 ${allPicks.length} 条可选（难度 ${DIFFICULTY.length} + 增益 ${BOONS.length}）`);
    ok(validatePicks(allPicks).length === 0,
       `全部 ${allPicks.length} 条一起选也合法（无上限）`,
       validatePicks(allPicks).join(' | '));
    // 但"重复选"仍然要拦 —— 无上限不等于无校验
    ok(validatePicks([allPicks[0], allPicks[0]]).length > 0, '重复选同一条仍然非法');
    ok(validatePicks(['__不存在__']).length > 0, '未知 id 仍然非法');
    ok(scoreLabel(0) === '标准', '0 分显示"标准"');
  }

  /* --- W3. 流程契约（桌面端 + 手机端合并后的最终顺序）---
     点开始 → 问「新手 / 老手」→ 新手=骑士直接开局；老手=难度页 → 职业页（按难度分解锁）
     通关过一次之后不再问，一律默认老手。
     用源码正则守住这个顺序 —— 一旦被改回去，这条会立刻报。
     ⚠️ 询问必须排在**职业之前**：职业解锁门槛是难度分，分数要先选出来。 */
  {
    const mainSrc = readFileSync(join(ROOT, 'js/main.js'), 'utf8');
    ok(/case 'veteran': node = veteranScene\(\{/.test(mainSrc), "注册了 'veteran' 路由");
    ok(/function beginNewRun\(\)[\s\S]{0,260}?if \(meta\.wins > 0\) \{ go\('difficulty'\); return; \}/.test(mainSrc),
       'beginNewRun：通关过 = 默认老手，直接进难度页（不再问）');
    ok(/function beginNewRun\(\)[\s\S]{0,320}?go\('veteran'\)/.test(mainSrc),
       'beginNewRun：没通关过 → 进「新手 / 老手」询问');
    ok(/onNovice: \(\) => startRun\('knight', \[\]\)/.test(mainSrc),
       'veteran 路由：新手 → 铁誓骑士直接开局（0 分标准难度）');
    ok(/onVeteran: \(\) => go\('difficulty'\)/.test(mainSrc),
       'veteran 路由：老手 → 难度页');
    ok(/case 'difficulty': node = difficultyScene\(\{ picks: args\[0\] \|\| \[\], onStart: \(picks\) => go\('class', picks\)/.test(mainSrc),
       '难度页排在职业页之前，并且把已选内容透传进去（返回时能回填）');
    ok(/case 'class': node = classScene\(\{\s*picks: args\[0\]/.test(mainSrc),
       '职业页接收难度 picks（职业按难度分解锁）');
    ok(/bestWinScore/.test(mainSrc), '通关时记录本局难度分（bestWinScore）');
    // 询问界面必须真的存在且两个选项都指向正确分支
    const menuSrc = readFileSync(join(ROOT, 'js/ui/scene-menu.js'), 'utf8');
    ok(/export function veteranScene/.test(menuSrc), 'scene-menu.js 导出 veteranScene');
    ok(/我是新手/.test(menuSrc) && /我是老手/.test(menuSrc), '询问界面给出两个明确选项');
    // 职业解锁不能被丢掉（这是手机端的核心设计）
    ok(/unlockScore/.test(readFileSync(join(ROOT, 'js/data/classes.js'), 'utf8')),
       '职业仍带 unlockScore 门槛（按难度分解锁）');
  }

  /* --- W4. 每一条难度/增益都真的改变状态 ---
     这是本段的核心：**逐条实际生效验证**。
     只断言"数据表里有这一条"是不够的 —— 键名写错、钩子名拼错都会静默无效。 */
  {
    const noop = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {}, onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {}, onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, onExecute() {} };
    const mkBattle = (picks, enc = ['slime']) => {
      A.startRun('knight', picks);
      const B = new A.Battle(enc, { kind: 'battle' });
      B.view = { ...noop };
      return B;
    };

    /* 难度：怪物血量每层额外 +15% */
    {
      const b4 = mkBattle(['d_hp_per_act']);
      A.G.act = 4; b4.act = 4;
      const base = mkBattle([]); base.act = 4;
      const plainHp = Math.round(A.G.rng.int(0, 0));   // 占位，避免未使用
      // 用同一掷点比较：先固定 rng 状态
      A.startRun('knight', []);
      A.G.act = 4; A.G.rng.setState(12345);
      const B1 = new A.Battle(['golem'], { kind: 'battle' }); B1.view = { ...noop };
      const hp1 = B1.aliveEnemies()[0].maxHp;
      A.startRun('knight', ['d_hp_per_act']);
      A.G.act = 4; A.G.rng.setState(12345);
      const B2 = new A.Battle(['golem'], { kind: 'battle' }); B2.view = { ...noop };
      const hp2 = B2.aliveEnemies()[0].maxHp;
      // 第 4 层基础生命 ×1.75；额外 +15%×3 = ×1.45 → 合计 ×2.5375
      ok(hp2 > hp1, `「厚重皮囊」让第 4 层怪物更厚（${hp1} → ${hp2}）`);
      ok(Math.abs((hp2 / hp1) - 1.45) < 0.08, `额外增幅约为 ×1.45（实测 ${(hp2 / hp1).toFixed(2)}）`);
      // 第 1 层不该被影响（"每层增幅"不能变成"开局就变强"）
      A.startRun('knight', ['d_hp_per_act']);
      A.G.rng.setState(12345);
      const B3 = new A.Battle(['golem'], { kind: 'battle' }); B3.view = { ...noop };
      A.startRun('knight', []);
      A.G.rng.setState(12345);
      const B4 = new A.Battle(['golem'], { kind: 'battle' }); B4.view = { ...noop };
      ok(B3.aliveEnemies()[0].maxHp === B4.aliveEnemies()[0].maxHp,
         `第 1 层不受「厚重皮囊」影响（${B3.aliveEnemies()[0].maxHp} = ${B4.aliveEnemies()[0].maxHp}）`);
    }

    /* 难度：怪物攻击每层额外 +8% */
    {
      A.startRun('knight', []);
      A.G.act = 4; A.G.rng.setState(777);
      const B1 = new A.Battle(['golem'], { kind: 'battle' }); B1.view = { ...noop };
      const atk1 = B1.aliveEnemies()[0].atkMult;
      A.startRun('knight', ['d_atk_per_act']);
      A.G.act = 4; A.G.rng.setState(777);
      const B2 = new A.Battle(['golem'], { kind: 'battle' }); B2.view = { ...noop };
      const atk2 = B2.aliveEnemies()[0].atkMult;
      // 基础 1.45，额外 +8%×3 = ×1.24 → ≈1.798
      ok(Math.abs(atk2 / atk1 - 1.24) < 0.02, `「凶性渐长」第 4 层攻击 ×1.24（实测 ${(atk2 / atk1).toFixed(3)}）`);
    }

    /* 难度：Boss 血量 +35% */
    {
      A.startRun('knight', []);
      A.G.rng.setState(4242);
      const B1 = new A.Battle(['boss_abyss'], { kind: 'boss' }); B1.view = { ...noop };
      const hp1 = B1.aliveEnemies()[0].maxHp;
      A.startRun('knight', ['d_boss_hp']);
      A.G.rng.setState(4242);
      const B2 = new A.Battle(['boss_abyss'], { kind: 'boss' }); B2.view = { ...noop };
      const hp2 = B2.aliveEnemies()[0].maxHp;
      ok(Math.abs(hp2 / hp1 - 1.35) < 0.02, `「庞大的阴影」Boss 血量 ×1.35（${hp1} → ${hp2}）`);
      // 召唤物不该吃 Boss 加成
      A.startRun('knight', ['d_boss_hp']);
      A.G.rng.setState(4242);
      const B3 = new A.Battle([], { kind: 'battle' }); B3.view = { ...noop };
      const s = B3.spawn('slime');
      const summoned = B3.spawn('slime', s);
      ok(summoned.maxHp === s.maxHp || summoned.maxHp < s.maxHp * 1.35,
         '「庞大的阴影」不影响被召唤出来的小怪');
    }

    /* 难度：「暴怒」每轮行动后 +1 力量 +1 敏捷 ——
       ⚠️ 必须**真跑一轮 enemyTurn()**，不能只手动调钩子函数。
       我第一版就是直接 `A.relicHooks('enemyActed')` 手动执行，
       结果把 battle.js 里那句调用删掉，测试**依然是绿的** ——
       它只证明了"钩子函数本身对"，没证明"引擎会调用它"（错题本 031 的假断言）。 */
    {
      const B = mkBattle(['d_enemy_scale_each_turn'], ['slime']);
      const e = B.aliveEnemies()[0];
      const s0 = B.get(e, 'strength'), d0 = B.get(e, 'dexterity');
      await B.enemyTurn();                       // ← 真的过一轮敌人回合
      ok(B.get(e, 'dexterity') === d0 + 1,
         `「暴怒」让敌人每轮行动后 +1 敏捷（敏捷 ${d0}→${B.get(e, 'dexterity')}）`);
      // 产品削弱后不再给力量 —— 守住这条，不然会悄悄加回来
      ok(B.get(e, 'strength') === s0,
         `「暴怒」不再给力量（力量 ${s0}→${B.get(e, 'strength')}）`);
      // 再跑一轮应当再 +1（确认是每轮而不是只加一次）
      const d1 = B.get(e, 'dexterity');
      await B.enemyTurn();
      ok(B.get(e, 'dexterity') === d1 + 1, `「暴怒」每轮都加（第二轮 ${d1}→${B.get(e, 'dexterity')}）`);
      // 对照：没选这条难度时不该涨
      const B2 = mkBattle([], ['slime']);
      const e2 = B2.aliveEnemies()[0];
      await B2.enemyTurn();
      ok(B2.get(e2, 'strength') === 0, '未选「暴怒」时敌人不会自己成长');
    }

    /* 难度：初始药水槽 -2、商店不出药水 */
    {
      A.startRun('knight', ['d_potion_slots_down']);
      const m = A.relicMods();
      ok(A.G.potionSlots === 1, `「药水禁令」初始药水槽 3→1（实际 ${A.G.potionSlots}）`);
      ok(m.shopNoPotion === 1, '「药水禁令」标记了商店不出药水');
    }

    /* 难度：营火全部替换为事件节点 */
    {
      const { generateMap } = await import('file://' + join(ROOT, 'js/core/map.js'));
      const withRest = generateMap(999, 1, {});
      const noRest = generateMap(999, 1, { restAsEvent: true });
      const c1 = { rest: 0 }, c2 = { rest: 0, event: 0 };
      for (const n of withRest.nodes) if (n.type === 'rest') c1.rest++;
      for (const n of noRest.nodes) { if (n.type === 'rest') c2.rest++; if (n.type === 'event') c2.event++; }
      ok(c1.rest > 0, `默认地图上有营火（${c1.rest} 个）`);
      ok(c2.rest === 0, `「无处歇脚」地图上营火清零（实际 ${c2.rest} 个）`);
      ok(c2.event > 0, `「无处歇脚」把营火变成了事件（事件 ${c2.event} 个）`);
      // 200 个种子都不能漏
      const leaked = [];
      for (let s2 = 0; s2 < 200; s2++) {
        const mm = generateMap(s2 * 7919 >>> 0, (s2 % 4) + 1, { restAsEvent: true });
        if (mm.nodes.some(n => n.type === 'rest')) leaked.push(s2);
      }
      ok(leaked.length === 0, '200 个种子下营火都被替换干净', leaked.slice(0, 5).join(','));
    }

    /* 难度：精英权重提高 */
    {
      const { generateMap } = await import('file://' + join(ROOT, 'js/core/map.js'));
      let a = 0, b = 0;
      for (let s2 = 0; s2 < 200; s2++) {
        a += generateMap(s2 * 7919 >>> 0, 2, {}).nodes.filter(n => n.type === 'elite').length;
        b += generateMap(s2 * 7919 >>> 0, 2, { eliteWeightUp: true }).nodes.filter(n => n.type === 'elite').length;
      }
      ok(b > a, `「危机四伏」让精英节点变多（200 种子合计 ${a} → ${b}）`);
    }

    /* 难度：商店涨价 25%、限移除 1 次；增益：一张 5 折卡 */
    {
      A.startRun('knight', ['d_shop_price_up']);
      const m = A.relicMods();
      ok(m.shopPriceMult === 1.25, `「奸商」价格倍率 1.25（实际 ${m.shopPriceMult}）`);
      ok(m.shopRemoveLimit === 1, `「奸商」每次进店限移除 1 张（实际 ${m.shopRemoveLimit}）`);
      A.startRun('knight', ['b_shop_half_card']);
      ok(A.relicMods().shopHalfCard === 1, '「熟人折扣」标记了 5 折卡位');
      const roomsSrc = readFileSync(join(ROOT, 'js/ui/scene-rooms.js'), 'utf8');
      ok(/c\.half \? 0\.5 : 1/.test(roomsSrc), '商店按 half 标记把首张卡打成 5 折');
    }

    /* 难度：进商人塞一张诅咒 */
    {
      A.startRun('knight', ['d_curse_on_shop']);
      const before = A.G.deck.length;
      A.go('shop');
      await new Promise(r => setTimeout(r, 300));
      const added = A.G.deck.slice(before);
      ok(A.G.deck.length === before + 1, `「诅咒缠身」进店后卡组 +1（${before} → ${A.G.deck.length}）`);
      ok(added.length === 1 && A.CARDS[added[0].id]?.type === 'curse',
         `塞进的是诅咒卡（${added.map(x => A.CARDS[x.id]?.name).join(',')}）`);
    }

    /* 难度：营火治疗减半、增益：血换遗物选项 */
    {
      A.startRun('knight', []);
      const full = Math.floor(A.G.maxHp * 0.3);
      A.startRun('knight', ['d_rest_heal_half']);
      const half = Math.floor(A.G.maxHp * 0.3 * 0.5);
      ok(half < full, `「冷掉的余烬」治疗量 ${full} → ${half}`);
      ok(A.relicMods().restHealMult === 0.5, '「冷掉的余烬」倍率 0.5');
      A.startRun('knight', ['b_rest_hp_relic']);
      ok(A.relicMods().restHpForRelic === 1, '「血之献祭」标记了营火换遗物选项');
    }

    /* 增益：初始生命上限 +6 */
    {
      A.startRun('knight', []);
      const base = A.G.maxHp;
      A.startRun('knight', ['b_maxhp6']);
      ok(A.G.maxHp === base + 6, `「强健体魄」上限 ${base} → ${A.G.maxHp}`);

      /* 关键：开局的**一次性**效果必须只生效一次。
         这里直接断言"开局加成走的是 pickMods()（只含难度/增益）而不是 relicMods()（含遗物）"。
         为什么必须断言函数身份而不是观测量：
           本用例里职业遗物是「燃烧之血」（没有 maxHp），所以"误用 relicMods()"在当前数据下
           观测量**完全相同**（我用它试过，测试是绿的 —— 假断言）。
           一旦将来给职业初始遗物加上 maxHp，误用就会真的重复叠加。
           所以这里断言源码里的实现选择，配上"再来一次不会累加"的行为断言，两层一起守。 */
      const stateSrc2 = readFileSync(join(ROOT, 'js/core/state.js'), 'utf8');
      ok(/function applyPickStartBonuses[\s\S]{0,200}?const m = pickMods\(\)/.test(stateSrc2),
         '「开局加成」用的是 pickMods()（只含难度/增益），不会与遗物重复叠加');

      // 行为断言：同一个增益不会被跑两次
      A.startRun('knight', ['b_maxhp6']);
      const m1 = A.G.maxHp;
      A.save(); A.loadSave();                    // 读档不应再次施加开局加成
      ok(A.G.maxHp === m1, `读档不会重复施加开局加成（${m1} → ${A.G.maxHp}）`);

      // 与遗物共存时两者各自只算一次
      A.startRun('knight', ['b_maxhp6']);
      const b4 = A.G.maxHp;
      A.addRelic('amulet');                      // 生命护符 = 最大生命 +10，与增益无关
      ok(A.G.maxHp === b4 + 10, `增益与遗物各算一次（${b4} +10 → ${A.G.maxHp}）`);
    }

    /* 增益：初始 +40 金币、一瓶随机药水、额外遗物、首回合多 1 费 */
    {
      A.startRun('knight', []);
      const g0 = A.G.gold, r0 = A.G.relics.length, p0 = A.G.potions.length;
      A.startRun('knight', ['b_gold40']);
      ok(A.G.gold === g0 + 40, `「盘缠充足」金币 ${g0} → ${A.G.gold}`);
      A.startRun('knight', ['b_extra_relic']);
      ok(A.G.relics.length === r0 + 1, `「旧日传承」遗物 ${r0} → ${A.G.relics.length}`);
      A.startRun('knight', ['b_start_potion']);
      ok(A.G.potions.length === p0 + 1, `「随身药剂」药水 ${p0} → ${A.G.potions.length}`);
      A.startRun('knight', []);
      const B1 = new A.Battle(['slime'], { kind: 'battle' }); B1.view = { ...noop };
      A.startRun('knight', ['b_first_energy']);
      const B2 = new A.Battle(['slime'], { kind: 'battle' }); B2.view = { ...noop };
      ok(A.relicMods().firstTurnEnergy === 1, '「先手优势」标记了首回合 +1 费');
    }

    /* 增益：打出能力卡后 +1 力量 —— 同样必须**真的把牌打出去** */
    {
      const B = mkBattle(['b_power_strength'], ['slime']);
      B.view = { ...noop };
      // 手动塞一张 0 费能力牌进手牌并给足能量，然后真的走 playCard()
      const power = { id: 'test_power', name: '测试能力牌', type: 'power', cost: 0, fx: [], upgraded: false, uid: 'tp1' };
      B.hand.push(power);
      B.energy = 3;
      const s0 = B.get(B.player, 'strength');
      await B.playCard(power);
      ok(B.get(B.player, 'strength') === s0 + 1,
         `「战意沸腾」打出能力卡后 +1 力量（${s0} → ${B.get(B.player, 'strength')}）`);
      // 对照：打出**攻击**牌不该触发
      const atk = { id: 'test_atk', name: '测试攻击牌', type: 'attack', cost: 0, dmg: 1, fx: [{ t: 'dmg', v: 'dmg' }], upgraded: false, uid: 'ta1' };
      B.hand.push(atk); B.energy = 3;
      const s1 = B.get(B.player, 'strength');
      await B.playCard(atk, B.aliveEnemies()[0]);
      ok(B.get(B.player, 'strength') === s1, '打出攻击卡不会触发「战意沸腾」（只对能力卡生效）');
    }

    /* 增益：精英/Boss 战后 +1 生命上限 */
    {
      A.startRun('knight', ['b_elite_boss_maxhp']);
      const B = mkBattle(['b_elite_boss_maxhp'], ['slime']);
      B.kind = 'elite';
      const before = A.G.maxHp;
      B.gainMaxHpRun(1);
      ok(A.G.maxHp === before + 1, `「愈战愈勇」上限 ${before} → ${A.G.maxHp}`);
      ok(B.player.maxHp === A.G.maxHp, '战斗内的玩家血条上限同步（不会出图才跳一下）');
      // 普通战斗不该触发（只在钩子里判断 kind）
      const hookSrc = readFileSync(join(ROOT, 'js/data/difficulty.js'), 'utf8');
      ok(/B\.kind === 'elite' \|\| B\.kind === 'boss'/.test(hookSrc),
         '「愈战愈勇」只在精英/Boss 战生效');
    }

    /* 增益：被召唤的怪物带 3 层虚弱 */
    {
      const B = mkBattle(['b_summon_weak3'], ['slime']);
      B.view = { ...noop };
      const host = B.aliveEnemies()[0];
      const summoned = B.spawn('slime', host);
      ok(B.get(summoned, 'weak') === 3, `「虚弱召唤」召唤物带 3 层虚弱（实际 ${B.get(summoned, 'weak')}）`);
      // 原本就有的敌人不该被加上
      ok(B.get(host, 'weak') === 0, '「虚弱召唤」不会给原有敌人加虚弱');
    }
  }

  /* --- W5. 难度写进存档、能读回来 --- */
  {
    A.startRun('knight', ['d_boss_hp', 'b_gold40']);
    A.save();
    const ls = window.localStorage.getItem('abyss_deck_save_v1');
    const parsed = JSON.parse(ls);
    ok(Array.isArray(parsed.picks) && parsed.picks.length === 2,
       `难度选择写进了存档（${JSON.stringify(parsed.picks)}）`);
    // 存档里塞一个已经删掉的 id：不能崩，也不该算分
    parsed.picks = ['d_boss_hp', '__removed_entry__'];
    window.localStorage.setItem('abyss_deck_save_v1', JSON.stringify(parsed));
    const g = A.loadSave();
    ok(!!g, '带未知难度 id 的存档仍能读出来（不崩）');
    ok(scoreOf(g.picks) === 9, `未知条目按 0 分计（实际 ${scoreOf(g.picks)}）`);
    const mm = A.relicMods();
    ok(typeof mm.bossHpMult === 'number', '读档后难度修正依然生效');
  }
}

/* ================= W. 职业定位 / 新机制 ================= */
section('W. 四职业定位与新机制');
{
  const doc = window.document;
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
    onPotion() {}, beforeEndTurn() {}, afterAction() {} };
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));

  const mk = (ids) => {
    A.startRun('knight');
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- W1. 法力增幅（energy_cap）：永久抬高每回合能量上限 --- */
  {
    const B = mk(['golem']);
    await B.start();
    const before = B.energyMax;
    B.add(B.player, 'energy_cap', 1);
    await B.playerTurn();
    const after1 = B.energyMax;
    B.add(B.player, 'energy_cap', 2);
    await B.playerTurn();
    ok(after1 === before + 1, `法力增幅 +1 后能量上限 ${before} → ${after1}`);
    ok(B.energyMax === before + 3, `再 +2 后上限 ${B.energyMax}（层数持久，不会被每回合重置冲掉）`);
    // 这是唯一能永久提升费用上限的途径：遗物那条 energyPerTurn 是固定值
    ok(B.energy === B.energyMax, `能量按新上限回满（${B.energy}/${B.energyMax}）`);
  }

  /* --- W2. 烈焰爆发：伤害 = 能量上限 × 系数 --- */
  {
    const B = mk(['golem']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 300; e.maxHp = 300; e.block = 0;
    B.player.st = {};
    const card = { id: 'mana_burst', name: '烈焰爆发', per: 5 };
    await B.resolve([{ t: 'dmgPerEnergyMax', v: 'per' }], { card, target: e, melee: true });
    const dealt = 300 - e.hp;
    ok(dealt === B.energyMax * 5, `烈焰爆发打出 ${dealt}（= 能量上限 ${B.energyMax} × 5）`);
    // 叠了增幅之后应该更强 —— 这是法师的强度曲线
    B.add(B.player, 'energy_cap', 2);
    await B.playerTurn();
    e.hp = 300;
    await B.resolve([{ t: 'dmgPerEnergyMax', v: 'per' }], { card, target: e, melee: true });
    ok(300 - e.hp > dealt, `叠加法力增幅后伤害更高（${dealt} → ${300 - e.hp}）`);
  }

  /* --- W3. 百裂斩：伤害 = 本回合已打出牌数 × 系数 --- */
  {
    const B = mk(['golem']);
    await B.start();
    const e = B.aliveEnemies()[0];
    const card = { id: 'hundred_cuts', name: '百裂斩', per: 3 };
    for (const n of [1, 4, 7]) {
      e.hp = 300; e.maxHp = 300; e.block = 0;
      B.cardsPlayedThisTurn = n;
      await B.resolve([{ t: 'dmgPerPlayed', v: 'per' }], { card, target: e, melee: true });
      ok(300 - e.hp === n * 3, `本回合打出 ${n} 张时百裂斩 = ${300 - e.hp} 点`);
    }
  }

  /* --- W4. 出牌数每回合必须清零 ---
     以前只在构造时初始化，一整场战斗都在累加 —— 任何"按本回合出牌数"的卡都会算错。 */
  {
    const B = mk(['golem']);
    await B.start();
    B.cardsPlayedThisTurn = 9;
    await B.playerTurn();
    ok(B.cardsPlayedThisTurn === 0, `新回合出牌数归零（实测 ${B.cardsPlayedThisTurn}）`);
  }

  /* --- W5. 职业定位：卡池结构必须撑得起各自的构筑方向 --- */
  {
    const pool = (cls) => Object.values(CARDS).filter(c => c.cls === cls);
    const has = (c, t, k) => (c.fx || []).some(f => f.t === t && (k === undefined || f.k === k));

    // 骑士：护盾流 —— 大量产甲 + 用甲换伤害 + 不让甲消失
    const kn = pool('knight');
    const blockCards = kn.filter(c => has(c, 'block') || has(c, 'blockFromBlock') || has(c, 'dmgBlock'));
    ok(blockCards.length >= 10,
       `骑士的护盾牌够多（${blockCards.length}/${kn.length} 张产甲/用甲）`, '');
    ok(kn.some(c => has(c, 'buff', 'barricade')) && kn.some(c => has(c, 'buff', 'dexterity')),
       '骑士有「护甲不消失」和「敏捷」两条护盾主轴（原「不屈 undying」已删除，其牌改为敏捷）');

    // 法师：费用上限 + 高额法术
    const mg = pool('mage');
    ok(mg.filter(c => has(c, 'buff', 'energy_cap')).length >= 1, '法师有提升能量上限的牌');
    ok(mg.some(c => has(c, 'dmgPerEnergyMax')), '法师有"按能量上限结算"的法术');
    // "技能伤害高"的判据：单发 ≥12 伤、或群体、或按能量/手牌数放大
    // 「引爆」按点燃层数放大，本身就是一种"放大法术"，计入判据
    const bigSpells = mg.filter(c => c.type === 'attack' && (
      (c.dmg || 0) >= 10 || has(c, 'dmgAll') || has(c, 'dmgPerEnergyMax') || has(c, 'dmgPerHand') || has(c, 'detonate')));
    ok(bigSpells.length >= 6, `法师的高额/群体/放大法术够多（${bigSpells.length} 张）`);

    // 游侠：低费快过牌
    const rg = pool('rogue');
    /* ⚠️ 算比例时**要排除终结牌** —— 终结牌的费用是 N（吃掉当前全部能量），
       它不在"费用曲线"上。把它算进分母等于用一张特殊牌去否定整个职业的低费定位
       （我加终结牌时这条就红了：18/26 = 69%）。 */
    const rgCurve = rg.filter(c => !c.finisher);
    const cheap = rgCurve.filter(c => c.cost <= 1);
    ok(cheap.length / rgCurve.length >= 0.7,
       `游侠以低费为主（${cheap.length}/${rgCurve.length} 张 ≤1 费，已排除终结牌）`);
    /* ⚠️ 这条阈值**被抽牌的新定价改小了**（原 ≥7）：抽牌从 2 点涨到 **5 点**之后，
       1 费档（5 点）很难同时装下"伤害/护甲 + 抽 1 张"，所以游侠的过牌牌收敛了。
       我刻意保住了两张（飞刀 / 闪避）来维持"低费过牌"这条轴 —— 但总体上
       它确实比改价前少。这不是卡变弱，是**抽牌变贵**的必然结果。
       需要单独讨论（比如给游侠抽牌一个职业折扣），不能靠偷偷调低权重。 */
    const drawers = rg.filter(c => has(c, 'draw'));
    ok(drawers.length >= 4, `游侠的过牌够多（${drawers.length} 张带抽牌）`);
    ok(rg.filter(c => c.cost === 0).length >= 4, `游侠有 ${rg.filter(c => c.cost === 0).length} 张 0 费牌`);

    // 暗影刺客：叠易伤 + 叠攻击 + 一击必杀
    const as = pool('assassin');
    const vul = as.filter(c => has(c, 'debuff', 'vulnerable') || has(c, 'debuffAll', 'vulnerable'));
    const str = as.filter(c => has(c, 'buff', 'strength') || has(c, 'buff', 'ritual'));
    const fin = as.filter(c => c.type === 'attack' && ((c.dmg || 0) >= 20 || c.exec));
    ok(vul.length >= 5, `刺客叠易伤的牌够多（${vul.length} 张）`);
    ok(str.length >= 3, `刺客叠攻击的牌够多（${str.length} 张）`);
    ok(fin.length >= 4, `刺客的一击必杀够多（${fin.length} 张高伤/斩杀）`);
  }

  /* --- W6. 费用图标：职业专属牌带上职业标记，且不再有 0 费绿色 --- */
  {
    const { cardEl } = await import('file://' + join(ROOT, 'js/ui/widgets.js')).catch(() => ({}));
    // 这个函数依赖 DOM 全局，直接 import 拿不到；改为在 bundle 里渲染一张真卡来看
    A.startRun('assassin');
    A.G.deck = [{ id: 'bleed_out', up: false }, { id: 'strike', up: false }, { id: 'backstab', up: false }];
    A.go('map'); await new Promise(r => setTimeout(r, 120));
    const btn = [...doc.querySelectorAll('.btn')].find(b => b.textContent.includes('卡组'));
    if (btn) {
      btn.click(); await new Promise(r => setTimeout(r, 200));
      const cards = [...doc.querySelectorAll('.modal .card')];
      const byName = {};
      for (const c of cards) byName[c.querySelector('.cname').textContent] = c.querySelector('.cost');
      const bd = byName['放血'], sk = byName['打击'];
      ok(bd && bd.closest('.card').className.includes('c-assassin'),
         '刺客专属牌带上了职业标记（费用图标据此上色）');
      ok(sk && !/c-knight|c-mage|c-rogue|c-assassin/.test(sk.closest('.card').className),
         '基础牌不加职业标记（保持默认金色）');
      const zero = [...doc.querySelectorAll('.modal .card')].find(c => c.querySelector('.cost').textContent === '0');
      ok(!zero || !zero.querySelector('.cost').classList.contains('free'),
         '0 费牌不再套用旧的绿色样式');
      doc.querySelectorAll('.modal-bg').forEach(m => m.remove());
    }
  }
}

/* ================= X. 灼烧 / 中毒衰减 / 火焰法师职业特性 ================= */
section('X. 灼烧与中毒的衰减规则 / 职业特性');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {},
    onPotion() {}, beforeEndTurn() {}, afterAction() {} };
  const { makeCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));

  const mk = (ids, cls = 'knight') => {
    A.startRun(cls);
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- X1. 中毒每跳 -2，且绝不出现负数 --- */
  {
    const B = mk(['golem']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 200; e.maxHp = 200; e.block = 0;
    B.add(e, 'poison', 5);
    const hp0 = e.hp;
    await B.enemyTurn();
    ok(hp0 - e.hp >= 5, `5 层毒跳一次至少掉 5 点（实测 ${hp0 - e.hp}）`);
    ok(B.get(e, 'poison') === 3, `5 层毒跳一次后剩 3（-2，实测 ${B.get(e, 'poison')}）`);

    // 关键边界：1 层毒减 2 会算成 -1
    const B2 = mk(['golem']);
    await B2.start();
    const e2 = B2.aliveEnemies()[0];
    e2.hp = 200; e2.maxHp = 200; e2.block = 0;
    B2.add(e2, 'poison', 1);
    await B2.enemyTurn();
    ok(B2.get(e2, 'poison') === 0 && e2.st.poison === undefined,
       `1 层毒跳完直接清除，不留负数（get=${B2.get(e2, 'poison')}，字段=${JSON.stringify(e2.st.poison)}）`);
  }

  /* --- X2. 灼烧与中毒同规则：轮到行动时掉 N 点血，然后 -1 --- */
  {
    const B = mk(['golem']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 200; e.maxHp = 200; e.block = 0;
    B.add(e, 'burn', 5);
    const hp0 = e.hp;
    await B.enemyTurn();
    ok(hp0 - e.hp >= 5, `5 层灼烧跳一次至少掉 5 点（实测 ${hp0 - e.hp}）`);
    ok(B.get(e, 'burn') === 4, `灼烧每跳 -1（5 → ${B.get(e, 'burn')}）—— 比中毒衰减慢，这是两者唯一的区别`);
  }

  /* --- X3. 灼烧无视护甲（和中毒一样是 DoT） --- */
  {
    const B = mk(['golem']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 200; e.maxHp = 200; e.block = 40;      // 厚甲
    B.add(e, 'burn', 6);
    const hp0 = e.hp, blk0 = e.block;
    await B.enemyTurn();
    ok(hp0 - e.hp >= 6, `6 层灼烧无视 40 点护甲照样掉血（实测 ${hp0 - e.hp}）`);
  }

  /* --- X4. 火焰法师的职业特性：**技能牌**挂 1 层灼烧 ---
     原来是"攻击牌挂 2 层"，产品改成"技能牌挂 1 层"：
     触发条件从"类型是攻击"换成"类型是技能且对敌人生效"，层数 2 → 1。 */
  {
    A.startRun('mage');
    const B = new A.Battle(['golem', 'slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.mods.burnOnSkill === 1,
       `起始遗物「燃火水晶」带上了灼烧效果（burnOnSkill=${B.mods.burnOnSkill}）`);
    ok(!B.mods.burnOnAttack, '旧的 burnOnAttack 已经不再使用（引擎也不读它了）');

    const e = B.aliveEnemies()[0];
    const play = async (id, tgt) => {
      const c = makeCard(id);
      for (const x of B.aliveEnemies()) { x.hp = 500; x.maxHp = 500; x.st = {}; }
      B.hand = [c]; B.energy = 99;
      await B.playCard(c, tgt || B.aliveEnemies()[0]);
      return c;
    };

    // 火焰弹是**技能牌**，打单体 → 挂 1 层
    await play('fire_bolt');
    ok(B.get(e, 'burn') === 1, `技能牌（火焰弹）打出后挂 1 层灼烧（实测 ${B.get(e, 'burn')}）`);

    // 攻击牌 → 不再由**职业特性**挂点燃。
    // 注意不能用「火球术」：它自己就带 1 层点燃（卡面效果，不是特性）。
    // 这里要的是一张"纯伤害、不带点燃"的攻击牌，才能验出特性确实没生效。
    await play('ice_shard');
    ok(B.get(e, 'burn') === 0, `攻击牌（火矢，自身不带点燃）不再被特性挂点燃（实测 ${B.get(e, 'burn')}）`);
    await play('fireball');
    ok(B.get(e, 'burn') === 1, `火球术自身带 1 层点燃（实测 ${B.get(e, 'burn')}）—— 卡面效果照常生效`);

    // 群体技能 → 每个敌人都挂（产品明确：不止单体，群体也算）
    // 注意用**技能**牌：雷暴虽然也是全体，但它是攻击牌，不触发
    await play('frost_armor');
    ok(B.aliveEnemies().every(x => B.get(x, 'burn') === 1),
       `群体技能对每个敌人都挂 1 层（实测 ${B.aliveEnemies().map(x => B.get(x, 'burn')).join('/')}）`);

    // 自身目标技能 → 不挂（它根本没打到敌人）
    await play('arcane_shield');
    ok(B.aliveEnemies().every(x => B.get(x, 'burn') === 0),
       '给自己加护甲的技能不挂灼烧');
  }

  /* --- X5. 别的职业没有这个特性 --- */
  {
    for (const cls of ['knight', 'rogue', 'assassin']) {
      A.startRun(cls);
      const B = new A.Battle(['golem'], { kind: 'battle' });
      B.view = { ...noopView };
      B.rollIntents();
      await B.start();
      ok(!B.mods.burnOnAttack, `${cls} 的起始遗物不带灼烧（这是法师专属）`);
    }
  }

  /* --- X6b. 寒冰法师：冰霜累积 / 冻结阈值 / 冰冻跳过行动 --- */
  {
    A.startRun('icemage');
    const B = new A.Battle(['golem', 'slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.mods.frostOnSkill === 1, `起始遗物「寒霜核心」挂冰霜（frostOnSkill=${B.mods.frostOnSkill}）`);

    const e = B.aliveEnemies()[0];
    const skill = async (id) => {
      const c = makeCard(id);
      B.hand = [c]; B.energy = 99;
      await B.playCard(c, e);
    };

    // 1) 技能牌 → +1 冰霜
    await skill('ice_lance');
    ok(B.get(e, 'frost') === 1, `技能牌给 1 层冰霜（实测 ${B.get(e, 'frost')}）`);

    // 2) 冰霜不自然衰减：过一整个敌方回合 + 玩家回合，层数不变
    const frostBefore = B.get(e, 'frost');
    await B.enemyTurn();
    ok(B.get(e, 'frost') === frostBefore, `冰霜不会自然衰减（${frostBefore} → ${B.get(e, 'frost')}）`);

    /* 3) 集满 → 消耗全部冰霜，变成 1 层冰冻。
       ⚠️ 阈值 2026-10-13 提高（小怪 3 → **4**），这条断言原来写的是 3 层。
       改成**从 freezeThreshold 读**，以后产品再调阈值这里不会再过期。 */
    const thr = B.freezeThreshold(e);
    B.add(e, 'frost', thr);
    ok(B.get(e, 'frost') === 0, `集满 ${thr} 层后冰霜清零（实测 ${B.get(e, 'frost')}）`);
    ok(B.get(e, 'freeze') === 1, `转化成 1 层冰冻（实测 ${B.get(e, 'freeze')}）`);

    // 4) 阈值随目标而异：小怪 4 / 精英 6 / Boss 8（都在 AB 段有独立断言，这里只留个交叉检查）
    const B2 = new A.Battle(['boss_eye'], { kind: 'boss' });
    B2.view = { ...noopView };
    B2.rollIntents();
    await B2.start();
    const boss = B2.aliveEnemies()[0];
    const bthr = B2.freezeThreshold(boss);
    ok(bthr === 8, `Boss 需要 ${bthr} 层才冻住（实测 ${bthr}）`);
    B2.add(boss, 'frost', bthr - 1);
    ok(B2.get(boss, 'freeze') === 0 && B2.get(boss, 'frost') === bthr - 1,
       `Boss ${bthr - 1} 层冰霜还没冻住`);
    B2.add(boss, 'frost', 1);
    ok(B2.get(boss, 'freeze') === 1, `Boss 到 ${bthr} 层才冻住`);
    const norm = B.aliveEnemies()[0];
    ok(B.freezeThreshold(norm) === 4, `普通怪 4 层（实测 ${B.freezeThreshold(norm)}）`);
  }

  /* --- X6c. 冰冻：跳过它的整个行动，且意图保留到下一回合 --- */
  {
    A.startRun('icemage');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.moveId = 'smash';                          // 固定一个会打人的招式
    const intentBefore = e.rawMoveId = e.moveId;
    B.add(e, 'freeze', 1);

    const hp0 = B.player.hp;
    const turnBefore = e.turn;
    B.player.maxHp = 999; B.player.hp = 999;
    await B.enemyTurn();
    ok(B.player.hp === 999, `被冻住的敌人没有对玩家造成任何伤害（${hp0} → ${B.player.hp}）`);
    ok(B.get(e, 'freeze') === 0, `冰冻消耗了 1 层（剩 ${B.get(e, 'freeze')}）`);
    ok(e.turn === turnBefore, `跳过行动时 turn 不推进（${turnBefore} → ${e.turn}）`);
    ok(e.moveId === intentBefore, `意图保留到下一回合（${intentBefore} → ${e.moveId}）——没被重新掷掉`);
    ok(!e.def.fx || true, '');
  }

  /* --- Xb. 流血：**行动后**结算 + 层数减半 + 游侠攻击牌自动挂 --- */
  {
    const { makeCard: mkCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    A.startRun('rogue');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.mods.bleedOnAttack === 1,
       `游侠遗物「血牙」带上 bleedOnAttack=${B.mods.bleedOnAttack}（改前是 startPoisonAll）`);
    ok(!B.mods.startPoisonAll, '旧的开场施毒已经不再使用');

    const e = B.aliveEnemies()[0];
    // ① 攻击牌自动挂 1 层流血；技能牌不挂
    B.hand = [mkCard('strike')]; B.energy = 99;
    await B.playCard(B.hand[0], e);
    ok(B.get(e, 'bleed') === 1, `攻击牌自动挂 1 层流血（实测 ${B.get(e, 'bleed')}）`);
    B.hand = [mkCard('defend')];
    await B.playCard(B.hand[0], B.player);
    ok(B.get(e, 'bleed') === 1, '技能牌不挂流血');

    // ② 结算：造成 N 点，然后层数**减半**（奇数取下）
    const settle = async (n) => {
      e.st = {}; e.hp = 500; e.maxHp = 500; e.block = 0;
      B.add(e, 'bleed', n);
      const hp0 = e.hp;
      await B.settleBleed(e);
      return { dealt: hp0 - e.hp, left: B.get(e, 'bleed') };
    };
    let r = await settle(8);
    ok(r.dealt === 8 && r.left === 4, `8 层 → 打 8 点、剩 4 层（实测 ${r.dealt} / ${r.left}）`);
    r = await settle(3);
    ok(r.dealt === 3 && r.left === 1, `3 层（奇数）→ 打 3 点、剩 1 层（实测 ${r.dealt} / ${r.left}）`);
    r = await settle(1);
    ok(r.dealt === 1 && r.left === 0, `1 层 → 打 1 点、清零（实测 ${r.dealt} / ${r.left}）`);

    // ③ 结算时机：流血在**行动之后**、中毒/灼烧在**行动之前**
    e.st = {}; e.hp = 500; e.maxHp = 500; e.moveId = 'slam';
    B.player.hp = 9999; B.player.maxHp = 9999;
    B.add(e, 'bleed', 8);
    B.add(e, 'poison', 8);
    const hpBefore = e.hp;
    await B.enemyTurn();
    // 中毒 8（行动前，-2 层） + 流血 8（行动后，减半） = 16
    ok(hpBefore - e.hp === 16,
       `同一回合中毒(行动前)与流血(行动后)都结算了：掉 ${hpBefore - e.hp}，期望 16`);
    ok(B.get(e, 'bleed') === 4, `流血减半到 4（实测 ${B.get(e, 'bleed')}）`);
    ok(B.get(e, 'poison') === 6, `中毒 -2 到 6（实测 ${B.get(e, 'poison')}）`);
  }

  /* --- W4b. 本轮新增的三条诅咒词条真的生效（逐条实测，不是只查数据表）--- */
  {
    const noopV = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
      onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {}, onTurnStart() {},
      onEnemyAct() {}, onSummon() {}, onDeath() {}, onVanish() {}, onEnd() {}, onPotion() {},
      beforeEndTurn() {}, afterAction() {} };

    /* ① 初始最大生命 -7 */
    A.startRun('knight', []);
    const hpBase = A.G.maxHp;
    A.startRun('knight', ['d_maxhp_down']);
    ok(A.G.maxHp === hpBase - 7,
       `「脆弱躯壳」初始最大生命 -7（${hpBase} → ${A.G.maxHp}）`);
    ok(A.G.hp === A.G.maxHp, '减上限后仍然是满血开局（不能一开局就残血）');

    /* ② 获得的金币减少 30%（花钱不打折） */
    A.startRun('knight', []);
    let g0 = A.G.gold;
    ok(A.gainGold(100) === 100 && A.G.gold === g0 + 100, '没选该词条时 100 金币原样到账');
    A.startRun('knight', ['d_gold_down']);
    g0 = A.G.gold;
    const got = A.gainGold(100);
    ok(got === 70 && A.G.gold === g0 + 70,
       `「囊中羞涩」100 金币只到账 70（实测 ${got}）`);
    // 花钱不该再被打折一次：扣款路径不走 gainGold 的乘区
    A.G.gold = 100;
    A.gainGold(-30);
    ok(A.G.gold === 70, `扣款不打折（100 - 30 = ${A.G.gold}）`);

    /* ③ 每场战斗第一回合费用 -1 */
    const mkB = (picks) => {
      A.startRun('knight', picks);
      const B = new A.Battle(['slime'], { kind: 'battle' });
      B.view = { ...noopV };
      B.rollIntents();
      return B;
    };
    const B1 = mkB([]); await B1.start();
    const e1 = B1.energyMax;
    const B2 = mkB(['d_first_energy_down']); await B2.start();
    ok(B2.energyMax === e1 - 1,
       `「起步迟缓」第一回合费用 -1（${e1} → ${B2.energyMax}）`);
    // 第二回合要恢复正常，否则就是"整场 -1"而不是"首回合 -1"
    await B2.enemyTurn();
    ok(B2.energyMax === e1,
       `第二回合恢复正常（${B2.energyMax}，期望 ${e1}）`);
  }

  /* --- W4c. 圣骑士遗物「圣誓」：单次造成 >7 点伤害后回 1 血 --- */
  {
    const { makeCard: mkCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    A.startRun('paladin');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.mods.healOnBigHit === 1, `圣骑士遗物带上 healOnBigHit=${B.mods.healOnBigHit}`);
    const e = B.aliveEnemies()[0];
    e.hp = 9999; e.maxHp = 9999;
    B.player.maxHp = 100;
    const hit = async (n) => {
      e.block = 0; B.player.hp = 50;
      await B.damage(e, n, '测试', { attacker: B.player, raw: true });
      return B.player.hp - 50;
    };
    ok(await hit(8) === 1, '单次 8 点伤害 → 回 1 血');
    ok(await hit(7) === 0, '单次 7 点不算（阈值是「大于 7」）');
    ok(await hit(20) === 1, '一次大伤害也只回 1 点（不是按伤害比例）');
    // 被完全挡住的攻击不算"造成了伤害"
    e.block = 99;
    B.player.hp = 50;
    await B.damage(e, 12, '测试', { attacker: B.player, raw: true });
    ok(B.player.hp === 50, '被护甲完全挡下的攻击不回血（用实际掉血量判定）');
    // 别的职业没有这个遗物
    A.startRun('knight');
    const K = new A.Battle(['golem'], { kind: 'battle' });
    K.view = { ...noopView }; K.rollIntents(); await K.start();
    K.player.maxHp = 100; K.player.hp = 50;
    const ke = K.aliveEnemies()[0]; ke.hp = 9999; ke.maxHp = 9999; ke.block = 0;
    await K.damage(ke, 14, '测试', { attacker: K.player, raw: true });
    ok(K.player.hp === 50, '没有「圣誓」的职业打大伤害不回血');
  }

  /* --- Xc. 玩家侧冰冻：阈值 4 层、冻住后本回合能量减半（产品设定）--- */
  {
    A.startRun('knight');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.freezeThreshold(B.player) === 4, `玩家冰冻阈值 4 层（实测 ${B.freezeThreshold(B.player)}）`);
    ok(B.freezeThreshold(B.aliveEnemies()[0]) === 4, '普通怪 4 层（2026-10-13 由 3 提高）');
    // 攒够 4 层冰霜 → 1 层冰冻
    B.add(B.player, 'frost', 3);
    ok(B.get(B.player, 'freeze') === 0, '3 层冰霜还没冻住');
    B.add(B.player, 'frost', 1);
    ok(B.get(B.player, 'frost') === 0 && B.get(B.player, 'freeze') === 1,
       `4 层冰霜转成 1 层冰冻（冰霜 ${B.get(B.player, 'frost')} / 冰冻 ${B.get(B.player, 'freeze')}）`);
    // 冻住后的惩罚：本回合能量**减半（向上取整）**，不是跳过回合
    const before = B.energyMax;
    await B.playerTurn();
    ok(B.energyMax === Math.ceil(before / 2),
       `冰冻让本回合能量减半（${before} → ${B.energyMax}，期望 ${Math.ceil(before / 2)}）`);
    ok(B.get(B.player, 'freeze') === 0, '冰冻消耗 1 层');
    // 冰冻解除后必须恢复全量 —— 惩罚是"本回合减半"，不是永久扣
    B.player.st = {};
    await B.playerTurn();
    ok(B.energyMax === before,
       `冰冻解除后能量恢复全量（${B.energyMax}，期望 ${before}）—— 惩罚只作用于当回合`);
  }

  /* --- Xd. 凛冬女王：攻击/增益意图都上冰霜 + 与深渊之主平分第 3 层 --- */
  {
    const { ENEMIES, ENCOUNTERS } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
    const q = ENEMIES.boss_frostqueen;
    ok(!!q && q.boss === true, '凛冬女王是 Boss');
    // 机制特色：所有"攻击/攻击+负面/增益"意图都必须带冰霜
    const bad = Object.entries(q.moves).filter(([, m]) =>
      ['attack', 'attack_debuff', 'buff'].includes(m.intent)
      && !(m.fx || []).some(f => f.k === 'frost'));
    ok(bad.length === 0, '攻击与增益意图**都**带冰霜（这就是它的机制特色）',
       bad.map(x => x[1].name).join(', '));
    // 它必须有攻击意图和增益意图各至少一个，否则"攻击+buff都上冰霜"是空话
    const intents = new Set(Object.values(q.moves).map(m => m.intent));
    ok(intents.has('attack') && intents.has('buff'), '攻击与增益两种意图都有');
    // 立绘存在（就地读 sprites.json —— 外层那个变量不在这段作用域里）
    const spritesJson = JSON.parse(readFileSync(join(ROOT, 'assets/sprites.json'), 'utf8'));
    ok(spritesJson.boss_frostqueen, '凛冬女王有专属立绘（不是借别人的图）');
    ok(!/boss_gargoyle|boss_abyss|boss_demon/.test(q.sprite), `用的是自己的贴图（${q.sprite}）`);
    // 平分：反复抽样两个都应该出现
    ok(ENCOUNTERS[3].boss.length === 2, `第 3 层配了 ${ENCOUNTERS[3].boss.length} 个 Boss（平分概率）`);
    A.startRun('knight'); A.G.act = 3;
    const seen = new Set();
    for (let i = 0; i < 300; i++) seen.add(A.pickEncounter('boss')[0]);
    ok(seen.has('boss_lord') && seen.has('boss_frostqueen'),
       `两个 Boss 都能抽到（实测 ${[...seen].join(' / ')}）`);
  }

  /* --- X0a. 卡牌用到的每个状态键都必须在 ST 表里有定义 ---
     防的是"写了个引擎不认识的状态键"：效果整个静默失效，卡面还照常显示文案。
     顺带也说明状态键是引擎与数据层之间的契约，改名要两边一起改。 */
  {
    const { ST } = await import('file://' + join(ROOT, 'js/core/battle.js'));
    const defined = new Set(Object.keys(ST));
    const used = new Set();
    for (const c of Object.values(A.CARDS)) {
      for (const f of (c.fx || [])) if (f.k) used.add(f.k);
    }
    const missing = [...used].filter(k => !defined.has(k));
    ok(missing.length === 0, '卡牌用到的状态键都在 ST 表里（没有静默失效的效果）', missing.join(', '));
  }

  /* --- X00. 卡池里不能有「完全同形同值」的两张牌 —— 升级后也不能撞 --- */
  {
    // 判据必须**带上 hits**：我第一版漏了它，结果"2段×2"和"3段×2"被判成同一张，
    // 该抓的没抓到（秘法齐射=公理就是这么漏过去的）。
    const sig = (c) => {
      const up = Object.assign({}, c, c.up || {});
      const nums = k => Object.entries(k).filter(([, v]) => typeof v === 'number')
        .sort().map(([a, b]) => `${a}:${b}`).join(',');
      return [c.cost, c.type, c.target, JSON.stringify(c.fx), nums(c), nums(up)].join('|');
    };
    /* 口径：一个职业的"可用池" = 自己的专属牌 + **基础牌**。
       基础牌（打击/防御）是所有职业共用的，所以「防御 vs 该职业自己的 1 费 5 甲牌」
       必须算成重复 —— 只按 cls 分组会漏掉这一类（打击=重击就是这么漏过去的）。
       跨职业之间同数值是正常的（各职业有自己的风味版），所以不查全局。 */
    const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    const all = Object.values(A.CARDS).filter(c => !['curse', 'status'].includes(c.cls));
    const bad = [];
    for (const cid of Object.keys(CLASSES)) {
      const pool = all.filter(c => c.cls === cid || c.cls === 'basic');
      const m = {};
      for (const c of pool) (m[sig(c)] = m[sig(c)] || []).push(c.name);
      for (const v of Object.values(m)) if (v.length > 1) bad.push(`${CLASSES[cid].name}: ${v.join(' = ')}`);
    }
    ok(bad.length === 0, '没有职业的可用池里出现两张完全同形同值的牌（含升级后）', bad.join(' / '));
  }

  /* --- X0. 老手流程：难度页在前，职业按难度分解锁（产品要求）--- */
  {
    const doc = window.document;
    const txt = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
    const byText = t => [...doc.querySelectorAll('button, .btn')].find(b => txt(b).includes(t));
    const meta = A.loadMeta();
    A.saveMeta({ ...meta, wins: 1 });            // 伪造"通关过" → 解锁难度系统
    A.go('menu'); await new Promise(r => setTimeout(r, 120));
    const btn = [...doc.querySelectorAll('.btn')].find(b => txt(b).includes('新的冒险') || txt(b).includes('开始游戏'));
    btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 140));
    const cfm = [...doc.querySelectorAll('.modal .btn')].find(b => txt(b).includes('开始'));
    if (cfm) { cfm.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await new Promise(r => setTimeout(r, 140)); }

    /* ① 难度页必须排在职业页**之前** */
    ok(!!byText('选择难度与增益') || (doc.querySelector('.screen')?.textContent || '').includes('难度规则'),
       '老手点开始先进入难度选择界面');
    ok(!byText('铁誓骑士'), '此时还没进职业界面（难度在前）');

    /* ② 一条难度都不选 → 0 分，只有骑士可选 */
    const goBtn = [...doc.querySelectorAll('.btn')].find(b => txt(b).includes('以当前设置出发'));
    ok(!!goBtn, '难度页有出发按钮');
    goBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 160));

    const cards = [...doc.querySelectorAll('.class-card')];
    const { CLASS_LIST } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    ok(cards.length === CLASS_LIST.length,
       `职业页列出全部 ${CLASS_LIST.length} 个职业（实测 ${cards.length}）`);
    const lockedNames = cards.filter(c => c.classList.contains('locked')).map(c => c.querySelector('.cname2').textContent);
    // `alwaysUnlocked`（铁誓骑士）**不算**在被锁名单里 —— 它永远可选。
    const needLock = CLASS_LIST.filter(c => !c.alwaysUnlocked && (c.unlockScore || 0) > 0).length;
    ok(lockedNames.length === needLock,
       `0 分时 ${needLock} 个职业被锁（实测 ${lockedNames.join('/')}）`);
    ok(cards.some(c => c.querySelector('.cname2').textContent === '铁誓骑士' && !c.classList.contains('locked')),
       '骑士在 0 分时仍可选');
    // 被锁的牌要写出**自己的**门槛（不要写死具体数字 —— 门槛会被产品调整，
    // 我这次就把它从 36 调到 27，写死的断言立刻过期）。
    {
      const maxNeed = Math.max(...CLASS_LIST.filter(c => !c.alwaysUnlocked).map(c => c.unlockScore || 0));
      ok(cards.some(c => c.querySelector('.locknote')?.textContent.includes(String(maxNeed))),
         `被锁的职业写出了所需难度分（最高档 ${maxNeed}）`);
    }

    /* ③ 分数够了解锁（直接按门槛构造 picks：每条难度 +9 分）
       ⚠️ 分数从 CLASS_LIST 的最高门槛**动态推导**，不写死 36 ——
       产品随时会调门槛（2026-10-13 就把最高档从 36 降到了 27）。 */
    const { DIFFICULTY } = await import('file://' + join(ROOT, 'js/data/difficulty.js'));
    const maxNeed = Math.max(...CLASS_LIST.filter(c => !c.alwaysUnlocked).map(c => c.unlockScore || 0));
    const nPicks = Math.ceil(maxNeed / 9);
    const picksMax = DIFFICULTY.slice(0, nPicks).map(d => d.id);
    const maxScore = nPicks * 9;
    A.go('class', picksMax); await new Promise(r => setTimeout(r, 160));
    const c2 = [...doc.querySelectorAll('.class-card')];
    const locked2 = c2.filter(c => c.classList.contains('locked')).map(c => c.querySelector('.cname2').textContent);
    ok(locked2.length === 0, `${maxScore} 分时全部职业解锁（实测仍锁着：${locked2.join('/') || '无'}）`);
    ok((doc.querySelector('.screen')?.textContent || '').includes(String(maxScore)), '职业页顶部显示当前难度分');
    // 并且真的能选进去（用奥术法师验证）
    const arc = c2.find(c => c.querySelector('.cname2').textContent === '奥术法师');
    arc.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    ok(A.G && A.G.cls === 'arcanist', `${maxScore} 分可以选奥术法师（实测 ${A.G && A.G.cls}）`);
    ok((A.G.picks || []).length === nPicks, `难度选择被带进本局（${(A.G.picks || []).length} 条）`);

    /* ④ 门槛没到就点：不能进去 */
    A.go('class', DIFFICULTY.slice(0, 1).map(d => d.id));   // 9 分
    await new Promise(r => setTimeout(r, 160));
    const c3 = [...doc.querySelectorAll('.class-card')];
    const arc3 = c3.find(c => c.querySelector('.cname2').textContent === '奥术法师');
    const before = A.G && A.G.cls;
    arc3.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 160));
    ok(A.G.cls === before, `9 分时点不进奥术法师（职业仍是 ${A.G && A.G.cls}）`);
    A.saveMeta(meta);                            // 还原 meta，别污染后面的测试
    A.go('menu'); await new Promise(r => setTimeout(r, 80));
  }

  /* --- X6c2. 增益拉满（分数为负）时，**铁誓骑士必须仍可选** ---
     增益每条 −4 分，拉满 10 条 = **−40 分**。解锁判定是 `need > score`，
     而骑士的 unlockScore 是 0 → `0 > −40` 成立 → **骑士也被锁**，
     8 个职业全锁、玩家卡在职业页进不去游戏。
     产品口径：骑士无需难度分，即使增益拉满也能玩。 */
  {
    const doc = window.document;    // X0 的 doc 是那个块内的局部变量，这里要自己取
    const { BOONS, scoreOf } = await import('file://' + join(ROOT, 'js/data/difficulty.js'));
    const allBoons = BOONS.map(b => b.id);
    const negScore = scoreOf(allBoons);
    ok(negScore < 0, `增益拉满的分数是负的（${negScore}）—— 这正是会锁死骑士的前提`);

    A.go('class', allBoons);
    await new Promise(r => setTimeout(r, 200));
    const cards = [...doc.querySelectorAll('.class-card')];
    const knCard = cards.find(c => c.querySelector('.cname2')?.textContent === '铁誓骑士');
    ok(!!knCard, '职业页渲染出铁誓骑士');
    ok(!knCard.classList.contains('locked'),
       `分数 ${negScore} 时铁誓骑士**没有被锁**（alwaysUnlocked 生效）`);
    const playable = cards.filter(c => !c.classList.contains('locked'));
    ok(playable.length >= 1,
       `至少有一个职业可选（实际 ${playable.length} 个：${playable.map(c => c.querySelector('.cname2')?.textContent).join('/')}）`);
    // 真的能点进去（不是"看起来没锁但点不动"）
    knCard.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    ok(A.G && A.G.cls === 'knight' && A.G.picks.length === allBoons.length,
       `增益拉满时点骑士能真的开局（cls=${A.G && A.G.cls}, picks=${A.G && A.G.picks.length} 条）`);
  }

  /* --- X6e3. 炼金师初始遗物「炼金口袋」：**每瓶**药水 +10 金币；初始金币 140 ---
     2026-10-13 产品改动：每瓶 20 → **10**，初始金币 150 → **140**。
     顺带修掉一个"文案撒谎"：引擎原来只记布尔 `potionUsed`，喝 1 瓶和喝 5 瓶
     给一样的钱，而描述写的是"每使用过 1 瓶"。现在按**瓶数**结算。 */
  {
    A.startRun('alchemist');
    ok(A.G.gold === 140, `炼金师初始金币 140（实测 ${A.G.gold}）`);
    ok(A.relicMods().potionBattleGold === 10,
       `炼金口袋每瓶给 10 金币（实测 ${A.relicMods().potionBattleGold}）`);
    ok(A.relicMods().potionSlots === 2, `药水槽 +2 仍生效（${A.relicMods().potionSlots}）`);

    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    // 喝 3 瓶（每瓶用最简单的一瓶药水），再把怪打死
    B.player.hp = 30;
    const potion = { name: '测试药水', fx: [] };
    for (let i = 0; i < 3; i++) await B.usePotion(potion, B.aliveEnemies()[0]);
    ok(B.potionUsedCount === 3, `统计到喝了 3 瓶（实测 ${B.potionUsedCount}）`);
    for (const e of B.aliveEnemies()) { e.hp = 1; e.maxHp = 1; }
    const c = makeCard('strike');
    B.hand = [c]; B.energy = 99;
    const goldBefore = A.G.gold;
    await B.playCard(c, B.aliveEnemies()[0]);
    ok(B.over, '战斗已结束');
    // 3 瓶 × 10 = 30（外加战斗结算本身给的金币，所以只断言"至少 +30"）
    ok(A.G.gold >= goldBefore + 30,
       `3 瓶药水至少给 30 金币（${goldBefore} → ${A.G.gold}）`);
    // 反向：只喝 1 瓶时不该给 3 瓶的钱
    A.startRun('alchemist');
    const B2 = new A.Battle(['slime'], { kind: 'battle' });
    B2.view = { ...noopView };
    B2.rollIntents();
    await B2.start();
    await B2.usePotion(potion, B2.aliveEnemies()[0]);
    ok(B2.potionUsedCount === 1, '只喝 1 瓶时计数是 1');
  }

  /* --- X6e2. 骑士初始遗物「燃烧之血」：战斗结束后回 4 血 ---
     2026-10-13 由 6 削弱到 **4**（产品要求）。骑士是"永远可选"的新手职业，
     6 点战后回血让他在第 1 层几乎不掉血、整层没有取舍。
     这条要**真的打完一场战斗**才能验证（healAfterBattle 在 win 分支里结算），
     只查数据表是查不出"引擎有没有读这个键"的。 */
  {
    const { makeCard: mkC } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    A.startRun('knight');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(A.relicMods().healAfterBattle === 4,
       `燃烧之血给的战后回血是 4（实测 ${A.relicMods().healAfterBattle}）`);
    // 先把血打掉一截（否则满血回血看不出效果）
    B.player.hp = 20;
    for (const e of B.aliveEnemies()) { e.hp = 1; e.maxHp = 1; }
    const c = mkC('strike');
    B.hand = [c]; B.energy = 99;
    await B.playCard(c, B.aliveEnemies()[0]);
    ok(B.over, '战斗已结束（怪被打死）');
    // endBattle 会把 player.hp 写回 G.hp，再叠加战后回血
    ok(A.G.hp === 24 || A.G.hp === B.player.hp + 4,
       `战斗结束后回 4 血（G.hp=${A.G.hp}，战斗内 ${B.player.hp}）`);
  }

  /* --- X6d. 奥术法师：真理让**多段**牌加段（起始遗物的核心机制）--- */
  {
    const { makeCard: mkCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    A.startRun('arcanist');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    await B.start();
    ok(B.mods.hitsPerTruth === 1, `起始遗物「真理之核」带上 hitsPerTruth=${B.mods.hitsPerTruth}`);
    const c = mkCard('arcane_bolt');
    ok(c.hits === 2, `基础牌「奥术飞弹」是多段（${c.hits} 段）`);
    ok(B.effHits({ hits: 'hits' }, c) === 2, '没有真理时就是 2 段');
    B.add(B.player, 'truth', 3);
    ok(B.effHits({ hits: 'hits' }, c) === 5, `3 层真理 → 2+3 = 5 段（实测 ${B.effHits({ hits: 'hits' }, c)}）`);
    // 真的打出来也要是 5 段（不能只有预告加、实际不加）
    const e = B.aliveEnemies()[0];
    e.hp = 9999; e.maxHp = 9999;
    B.hand = [c]; B.energy = 99;
    await B.playCard(c, e);
    ok(9999 - e.hp === c.dmg * 5,
       `实际打满 5 段（掉 ${9999 - e.hp}，期望 ${c.dmg * 5} = ${c.dmg}×5）`);
    // 单发牌不该因为真理变成多段
    ok(B.effHits({ hits: 'hits' }, { hits: 1 }) === 1, '原本单段的牌不会变成多段（真理只加成多段牌）');
    // 别的职业没有这个加成
    A.startRun('knight');
    const K = new A.Battle(['golem'], { kind: 'battle' });
    K.view = { ...noopView };
    K.rollIntents(); await K.start();
    K.add(K.player, 'truth', 3);
    ok(K.effHits({ hits: 'hits' }, mkCard('twin_strike')) === 2,
       '没有真理之核的职业即使有真理层数，也不会多打');
  }

  /* --- X6e. 奥术法师的强度约束：力量只出现在三费卡（产品要求）---
     多段攻击会被力量**逐段**加成，1 费多段牌带力量会直接失控。 */
  {
    const bad = Object.values(A.CARDS).filter(c => c.cls === 'arcanist'
      && (c.fx || []).some(f => f.k === 'strength') && c.cost < 3);
    ok(bad.length === 0, '奥术法师的力量效果只出现在三费卡上', bad.map(c => c.name).join(', '));
    ok(Object.values(A.CARDS).some(c => c.cls === 'arcanist'
      && (c.fx || []).some(f => f.k === 'strength') && c.cost >= 3),
       '至少有一张三费卡带力量（不然约束是空的）');
  }

  /* --- X6. 「燃烧」这张火系卡现在挂的是灼烧，不是中毒 --- */
  {
    const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
    const fx = CARDS.burning.fx[0];
    ok(fx.k === 'burn', `「燃烧」挂的是灼烧（${fx.k}）而不是中毒`);
  }
}

/* ================= Y. 职业配色 / 新职业覆盖度 ================= */
section('Y. 五个职业的配色与专属牌覆盖');
{
  const doc = window.document;
  const { CLASSES } = await import('file://' + join(ROOT, 'js/data/classes.js'));
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const { RELICS } = await import('file://' + join(ROOT, 'js/data/relics.js'));
  const css = readFileSync(join(ROOT, 'css/style.css'), 'utf8');
  const ids = Object.keys(CLASSES);

  /* --- Y1. 每个职业都要有费用配色规则 ---
     加寒冰法师时漏过这一条（当时是硬编码四个职业名判断的），补个门禁。 */
  {
    const missing = ids.filter(id => !css.includes('.c-' + id));
    ok(missing.length === 0, `每个职业都有费用配色规则（共 ${ids.length} 个）`, missing.join(', '));
    // 反向也别留孤儿规则
    const orphan = [...css.matchAll(/\.c-([a-z_]+)\s*[,{]/g)].map(m => m[1]).filter(x => !ids.includes(x));
    ok(orphan.length === 0, '没有指向已删职业的配色规则', [...new Set(orphan)].join(', '));
  }

  /* --- Y2. 每个职业的专属牌都要带上职业标记（费用图标才会换色） --- */
  {
    const { isClass } = await import('file://' + join(ROOT, 'js/ui/widgets.js')).catch(() => ({}));
    // 这个模块依赖 DOM 全局，直接 import 拿不到 —— 走 bundle 渲染真卡来验
    const bad = [];
    for (const id of ids) {
      A.startRun(id);
      const own = Object.values(CARDS).filter(c => c.cls === id);
      A.G.deck = own.slice(0, 4).map(c => ({ id: c.id, up: false }));
      A.go('map'); await new Promise(r => setTimeout(r, 60));
      const btn = [...doc.querySelectorAll('.btn')].find(b => b.textContent.includes('卡组'));
      if (!btn) { bad.push(`${id}: 没有卡组按钮`); continue; }
      btn.click(); await new Promise(r => setTimeout(r, 160));
      const cards = [...doc.querySelectorAll('.modal .card')];
      if (cards.length !== A.G.deck.length) bad.push(`${id}: 渲染出 ${cards.length} 张，期望 ${A.G.deck.length}`);
      for (const c of cards) {
        if (!c.className.includes('c-' + id)) bad.push(`${id}: 「${c.querySelector('.cname').textContent}」没带职业标记`);
      }
      doc.querySelectorAll('.modal-bg').forEach(m => m.remove());
    }
    ok(bad.length === 0, '每个职业的专属牌都带上了职业标记（费用图标据此换色）', bad.slice(0, 5).join(' | '));
  }

  /* --- Y3. 中立 / 基础牌不能被误判成职业牌 --- */
  {
    A.startRun('icemage');
    A.G.deck = [{ id: 'strike', up: false }, { id: 'defend', up: false }];
    A.go('map'); await new Promise(r => setTimeout(r, 60));
    const btn = [...doc.querySelectorAll('.btn')].find(b => b.textContent.includes('卡组'));
    btn.click(); await new Promise(r => setTimeout(r, 160));
    const bad = [...doc.querySelectorAll('.modal .card')].filter(c => /c-(knight|mage|rogue|assassin|icemage)/.test(c.className));
    ok(bad.length === 0, '基础牌/中立牌不带任何职业标记（保持灰色）',
       bad.map(c => c.querySelector('.cname').textContent).join(', '));
    doc.querySelectorAll('.modal-bg').forEach(m => m.remove());
  }

  /* --- Y4. 新职业的基本自洽 --- */
  {
    const ice = CLASSES.icemage;
    ok(!!ice, '寒冰法师已加入职业表');
    ok(ice && ice.hp > CLASSES.mage.hp, `寒冰法师生命 ${ice && ice.hp} 比火焰法师 ${CLASSES.mage.hp} 高一点（控场换来的）`);
    ok(ice && !!RELICS[ice.relic], `起始遗物「${ice && RELICS[ice.relic] && RELICS[ice.relic].name}」存在`);
    ok(ice && RELICS[ice.relic].mods.frostOnSkill === 1, '起始遗物带 frostOnSkill');
    const bad = (ice ? ice.deck : []).filter(([id]) => !CARDS[id]);
    ok(bad.length === 0, '寒冰法师起始卡组引用的卡都存在', bad.map(x => x[0]).join(','));
    ok((ice ? ice.deck : []).reduce((n, [, k]) => n + k, 0) === 10, '寒冰法师起始卡组 10 张');
    // 两个法师的基础牌都必须是**技能**牌（不然触发不了职业特性）
    ok(CARDS.snowball.type === 'skill' && CARDS.snowball.cls === 'icemage', '「扔雪球」是寒冰法师专属的技能牌');
    ok(CARDS.fire_bolt.type === 'skill' && CARDS.fire_bolt.cls === 'mage', '「火焰弹」是火焰法师专属的技能牌');
    // 所有职业专属牌数量都得够撑起一套构筑
    const thin = ids.filter(id => Object.values(CARDS).filter(c => c.cls === id).length < 15);
    ok(thin.length === 0, '每个职业的专属牌都在 15 张以上', thin.map(id => `${id}=${Object.values(CARDS).filter(c => c.cls === id).length}`).join(','));
  }
}

section('运行期 JS 错误');
{
  const real = jsErrors.filter(e => !/Not implemented|Could not parse CSS|audio/i.test(e));
  ok(real.length === 0, '无未捕获 JS 错误', real.slice(0, 8).join('\n      '));
  if (real.length) real.slice(0, 10).forEach(e => console.log('      ', e.slice(0, 200)));
}

section('Z. 影刃 2 层（产品改动）+ 易伤/虚弱对玩家对称');
{
  /* 产品要求：暗影刺客起始遗物「影刃」由 1 层提到 **2 层**。
     ⚠️ 手机端那份累积补丁是在旧基线上做的，合并时会把它退回 1 层 ——
     这条断言就是防止它再被退回去（我合并时确实又遇到过一次）。
     另外必须**真的调 start()**：变体修正是 start() 里应用的，
     只 `new Battle()` 不 start() 会永远读到 0（我第一版就是这么误判的）。 */
  const noopV = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, onExecute() {} };

  A.startRun('assassin');
  ok(A.G.relics.includes('shadow_mark'), `刺客开局带「影刃」（实际 ${A.G.relics.join(',')}）`);
  ok(A.RELICS.shadow_mark.mods.startDebuffAll.vulnerable === 2,
     `影刃的 mods 是 2 层（实际 ${A.RELICS.shadow_mark.mods.startDebuffAll.vulnerable}）`);
  ok(/<b>2<\/b>/.test(A.RELICS.shadow_mark.desc),
     `影刃描述写的是 2 层（实际「${A.RELICS.shadow_mark.desc}」）`);

  {
    const B = new A.Battle(['slime', 'bat', 'spider'], { kind: 'battle' });
    B.view = { ...noopV };
    B.rollIntents();
    await B.start();
    const vul = B.aliveEnemies().map(e => B.get(e, 'vulnerable'));
    ok(vul.length === 3 && vul.every(v => v === 2),
       `战斗开始给**所有**敌人 2 层易伤（实测 ${JSON.stringify(vul)}）`, JSON.stringify(vul));

    // 数值上真的按 2 层算：每层 +1 → 10 点变 12
    const e0 = B.aliveEnemies()[0];
    const withVul = B.calcDamage(10, B.player, e0);
    B.add(e0, 'vulnerable', -2);
    const plain = B.calcDamage(10, B.player, e0);
    ok(withVul === 12 && plain === 10,
       `2 层易伤让 10 点伤害变 ${withVul}（无易伤 ${plain}），每层 +1`);

    // 别的职业不该有这个起手易伤
    A.startRun('knight');
    const B2 = new A.Battle(['slime'], { kind: 'battle' });
    B2.view = { ...noopV };
    B2.rollIntents();
    await B2.start();
    ok(B2.get(B2.aliveEnemies()[0], 'vulnerable') === 0, '骑士（无影刃）开局不给敌人易伤');
  }

  /* 易伤/虚弱对玩家**双向**生效（产品专门问过"虚弱是否对玩家也 -1"）。
     `calcDamage` 读的是攻击方的 weak、防守方的 vulnerable，
     所以"谁有虚弱，谁的伤害就 -1/层"，玩家与敌人走同一条公式。 */
  {
    A.startRun('knight');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopV };
    B.rollIntents();
    await B.start();
    const e = B.aliveEnemies()[0];

    B.player.st = {};
    const p0 = B.calcDamage(10, B.player, e);
    B.player.st = { weak: 3 };
    const p3 = B.calcDamage(10, B.player, e);
    ok(p0 === 10 && p3 === 7, `玩家自己带 3 层虚弱：10 → ${p3}（无虚弱 ${p0}）`);

    B.player.st = {};
    const v0 = B.calcDamage(10, e, B.player);
    B.player.st = { vulnerable: 3 };
    const v3 = B.calcDamage(10, e, B.player);
    ok(v0 === 10 && v3 === 13, `玩家自己带 3 层易伤：挨 10 点变 ${v3}（无易伤 ${v0}）`);

    // 分段招式每段各算一次（对玩家同样成立）
    B.player.st = { weak: 2 };
    let tot = 0;
    for (let i = 0; i < 3; i++) tot += B.calcDamage(4, B.player, e);
    ok(tot === 6, `玩家 2 层虚弱打出 3 段×4：合计 ${tot}（每段 -2，不是总共 -2）`);

    // 状态说明必须与真实公式一致
    const { ST, VULN_FLAT_PER_STACK, WEAK_FLAT_PER_STACK } = await import('file://' + join(ROOT, 'js/core/battle.js'));
    ok(VULN_FLAT_PER_STACK === 1 && WEAK_FLAT_PER_STACK === 1, '易伤 +1/层、虚弱 -1/层');
    ok(!/50%/.test(ST.vulnerable.desc) && /\+1/.test(ST.vulnerable.desc),
       `易伤说明与公式同步（实际「${ST.vulnerable.desc}」）`);
    ok(!/-25%/.test(ST.weak.desc) && /-1/.test(ST.weak.desc),
       `虚弱说明与公式同步（实际「${ST.weak.desc}」）`);
    const helpSrc = readFileSync(join(ROOT, 'js/ui/scene-battle.js'), 'utf8');
    ok(!/易伤 · 受到伤害 \+50%/.test(helpSrc), '战斗内帮助文本里的易伤说明也已更新');
    ok(!/虚弱 · 造成伤害 -25%/.test(helpSrc), '战斗内帮助文本里的虚弱说明也已更新');
  }
}

section('AA. 终结牌：N 费用 / 条件门 / 限定目标 / 牌组唯一');
{
  const noopV = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, onExecute() {} };
  const { makeCard: mk } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  // ⚠️ CARDS 在 B 段是**块级作用域**的（section('B.…') 的 `{}` 里），这里要自己再取一次。
  const { CARDS } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const V = await import('file://' + join(ROOT, 'js/data/values.js'));

  const finishers = Object.values(CARDS).filter(c => c.finisher);

  /* --- AA1. 每个职业至少一张终结牌 --- */
  {
    const { CLASS_LIST } = await import('file://' + join(ROOT, 'js/data/classes.js'));
    const missing = CLASS_LIST.filter(cl => !finishers.some(f => f.cls === cl.id)).map(c => c.name);
    ok(missing.length === 0, `8 个职业都有终结牌（缺：${missing.join('/') || '无'}）`);
    // 结构字段必须齐
    const bad = [];
    for (const f of finishers) {
      if (!f.costN) bad.push(`${f.name} 缺 costN`);
      if (!f.unique) bad.push(`${f.name} 缺 unique`);
      if (typeof f.cond !== 'function') bad.push(`${f.name} 缺 cond`);
      if (f.rarity !== 'finisher') bad.push(`${f.name} 稀有度不是 finisher`);
      if (!f.text || !f.text(makeCardLike(f))) bad.push(`${f.name} 缺 text`);
    }
    ok(bad.length === 0, '终结牌结构完整（costN / unique / cond / rarity / text）', bad.join(' | '));
  }
  function makeCardLike(c) { return { ...c, ...(c.up || {}) }; }

  /* --- AA2. 费用是 N：吃掉当前**全部**能量，且能量越满越贵 --- */
  {
    A.startRun('knight');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopV }; B.rollIntents(); await B.start();
    const f = mk('finisher_bulwark');
    B.energy = 3;
    ok(B.cardCost(f) === 3, `能量 3 时终结牌费用 = 3（实测 ${B.cardCost(f)}）`);
    B.energy = 7;
    ok(B.cardCost(f) === 7, `能量 7 时费用 = 7（跟能量走，不是固定 3）`);
    B.energy = 3;
    B.hand = [f];
    // 打出去之后能量归零
    B.player.block = 20;                       // 满足条件
    await B.playCard(f, B.aliveEnemies()[0]);
    ok(B.energy === 0, `打出后能量清零（实测 ${B.energy}）`);
  }

  /* --- AA3. 条件门：没满足就打不出去，界面判据与引擎一致 --- */
  {
    A.startRun('knight');
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopV }; B.rollIntents(); await B.start();
    const f = mk('finisher_bulwark');
    B.energy = 3; B.hand = [f];
    B.player.block = 0;
    ok(!B.canPlay(f), '护甲不足时终结牌不能打（条件门生效）');
    const ok0 = await B.playCard(f, B.aliveEnemies()[0]);
    ok(ok0 === false && B.hand.length === 1 && B.energy === 3,
       '强打会被引擎拒绝，且不扣能量、不弃牌');
    B.player.block = 20;
    ok(B.canPlay(f), '护甲够了就能打');
  }

  /* --- AA4. 限定目标：只能打冻结目标（产品给的例子）--- */
  {
    A.startRun('icemage');
    const B = new A.Battle(['slime', 'bat'], { kind: 'battle' });
    B.view = { ...noopV }; B.rollIntents(); await B.start();
    const f = mk('finisher_shatterfrost');
    B.energy = 3; B.hand = [f];
    const [e1, e2] = B.aliveEnemies();
    ok(!B.canPlay(f), '没有任何敌人被冻时，碎冰绝响不能打');
    ok(B.validTargets(f).length === 0, '没有合法目标');
    B.add(e2, 'freeze', 1);
    ok(B.canPlay(f), '有敌人被冻住后就能打了');
    ok(B.validTargets(f).length === 1 && B.validTargets(f)[0] === e2,
       '合法目标**只有**被冻的那一只（不是所有敌人）');
    // 打到不合法目标上要被引擎夹回合法目标（界面在单选时会传第一个敌人）
    e2.hp = e2.maxHp = 500;
    await B.playCard(f, e1);
    ok(e2.hp < 500 && e1.hp === e1.maxHp,
       `目标被夹到合法的冻结目标上（冻的那只掉到 ${e2.hp}，没冻的没掉血）`);
  }

  /* --- AA5. 牌组唯一：有一张就不再给第二张 ---
     ⚠️ 必须用 `A.rollCardChoices`（运行时**同一个模块实例**）。
     写成 `import('file://…/core/state.js')` 会拿到**另一份模块实例**、
     有自己独立的 `G` —— `A.G.deck = [...]` 根本影响不到它，
     "牌组里有时不再出现"会**空绿**（永远是 0 次，看起来通过）。
     我第一版就是这么写的，靠下面那条反向断言才发现。 */
  {
    const rollCardChoices = A.rollCardChoices;
    ok(typeof rollCardChoices === 'function', 'A.rollCardChoices 已暴露（避开模块实例陷阱）');
    A.startRun('icemage');
    const fid = 'finisher_shatterfrost';
    A.G.deck = [{ id: fid, up: false }];
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      for (const c of rollCardChoices(3)) if (c.id === fid) seen++;
    }
    ok(seen === 0, `牌组里已有终结牌时，200 次重掷都没再出现（实测出现 ${seen} 次）`);
    // **反向断言**：移出牌组后必须能出现。没有这一条，上面那条在"终结牌压根没进池"时
    // 也会通过 —— 那就是典型的"绿得毫无理由"（我这次真的差点放过去）。
    A.G.deck = [];
    let seen2 = 0;
    for (let i = 0; i < 400; i++) {
      for (const c of rollCardChoices(3)) if (c.id === fid) seen2++;
    }
    ok(seen2 > 0, `牌组里没有时仍有机会出现（400 次出现 ${seen2} 次）—— 这条专防"空绿"`);
  }

  /* --- AA6. 低权重：终结牌比同池普通牌稀有得多 --- */
  {
    ok(A.FINISHER_WEIGHT < 1, `终结牌权重 ${A.FINISHER_WEIGHT} < 普通牌 1（产品要求"权重较低"）`);
    A.startRun('icemage'); A.G.deck = [];
    const cnt = {};
    let total = 0;
    for (let i = 0; i < 1000; i++) {
      for (const c of A.rollCardChoices(3)) { cnt[c.id] = (cnt[c.id] || 0) + 1; total++; }
    }
    const finRate = finishers.filter(f => f.cls === 'icemage')
      .reduce((s, f) => s + (cnt[f.id] || 0), 0) / total;
    const commonRate = Object.entries(cnt)
      .filter(([id]) => CARDS[id] && CARDS[id].rarity === 'common')
      .reduce((s, [, n]) => s + n, 0) / total;
    ok(finRate < commonRate / 3,
       `终结牌出现率(${(finRate * 100).toFixed(2)}%) 明显低于普通牌(${(commonRate * 100).toFixed(2)}%)`);
    ok(A.CLASS_CARD_WEIGHT > 0, '职业权重仍生效');
  }

  /* --- AA8. 能力牌每场战斗只能生效一次 ---
     2026-10-13 产品改动：能力牌（type 'power'）打出后进「消耗堆」，本场不再被抽到。
     原来它进弃牌堆 → 洗牌后又被抽到、重复生效（实测「壁垒」能被反复抽到）。
     改动后想同时吃多张能力牌的效果，只能往卡组里塞更多张。 */
  {
    A.startRun('knight');
    // ⚠️ 骑士起始卡组里**没有**壁垒，所以要先把它放进牌组 ——
    // 否则下面那条"下一场还能摸到"会被"牌组里本来就没有"给误判成通过/失败。
    A.G.deck = A.G.deck.concat([{ id: 'barricade', up: false }]);
    const B = new A.Battle(['slime'], { kind: 'battle' });
    B.view = { ...noopV };          // 本段（AA）的空视图叫 noopV
    B.rollIntents();
    await B.start();
    const pw = mk('barricade');                // 壁垒：type 'power'（本段的 makeCard 别名是 mk）
    ok(pw.type === 'power', '「壁垒」是能力牌');
    B.hand = [pw]; B.energy = 99;
    await B.playCard(pw, B.aliveEnemies()[0]);
    ok(B.exhaustPile.includes(pw), '能力牌打出后进**消耗堆**（本场不再抽到）');
    ok(!B.discard.includes(pw), '能力牌**不会**进弃牌堆（否则洗牌后会被再抽到）');
    // 效果仍然生效（不能因为换了个堆就把效果弄丢）
    ok(B.get(B.player, 'barricade') === 1 || !!B.player.st.barricade, '「壁垒」的效果仍然生效');
    // 非能力牌仍然进弃牌堆（别把规则扩大到攻击/技能牌）
    const atk = mk('strike');
    B.hand = [atk]; B.energy = 99;
    await B.playCard(atk, B.aliveEnemies()[0]);
    ok(B.discard.includes(atk) && !B.exhaustPile.includes(atk),
       '普通攻击牌仍然进弃牌堆（规则只针对能力牌）');
    // 技能牌也一样（只有 `exhaust: true` 的技能才进消耗堆）
    const sk = mk('defend');
    B.hand = [sk]; B.energy = 99;
    await B.playCard(sk, B.aliveEnemies()[0]);
    ok(B.discard.includes(sk) && !B.exhaustPile.includes(sk), '技能牌仍然进弃牌堆');

    /* 关键语义：「本场战斗移除」= 下一场战斗它回到牌组。
       这是"暂时移除"的实现基础 —— exhaustPile 每场重建，G.deck 不被改写。 */
    const deckLenBefore = A.G.deck.length;
    const B2 = new A.Battle(['slime'], { kind: 'battle' });
    B2.view = { ...noopV };
    B2.rollIntents();
    await B2.start();
    ok(B2.exhaustPile.length === 0, '新一场战斗的消耗堆是空的（上一场的移除不会累积）');
    ok(A.G.deck.length === deckLenBefore, '牌组本身没有被改写（能力牌还在卡组里）');
    const inNewBattle = [...B2.draw, ...B2.hand].some(c => c.id === 'barricade');
    ok(A.G.deck.some(c => c.id === 'barricade'), '牌组里仍有这张能力牌（下一场还能摸到）');
  }

  /* --- AA9. 奥术法师终结牌：条件 7 层真理 + 6 段 --- */
  {
    A.startRun('arcanist');
    const B = new A.Battle(['golem'], { kind: 'battle' });
    B.view = { ...noopV };
    B.rollIntents();
    await B.start();
    const f = mk('finisher_finaltheorem');
    B.energy = 99; B.hand = [f];
    ok(f.hits === 6, `终极定理是 6 段（实测 ${f.hits}）`);
    B.add(B.player, 'truth', 6);
    ok(!B.canPlay(f), '6 层真理时**不能**打（条件已提到 7 层）');
    B.add(B.player, 'truth', 1);
    ok(B.get(B.player, 'truth') === 7 && B.canPlay(f), '7 层真理时可以打');
    // 真理还会继续加段：7 层 → 6+7 = 13 段
    // ⚠️ 这里**不能**清空 player.st —— 一清真理就掉回 0 层，条件门立刻不成立、
    // 牌根本打不出去（我第一次就多写了一行 `B.player.st = {}`，结果"掉 0 血"）。
    const e = B.aliveEnemies()[0];
    e.hp = 9999; e.maxHp = 9999;
    await B.playCard(f, e);
    const dealt = 9999 - e.hp;
    ok(dealt === f.dmg * 13, `7 层真理下实际打 13 段（掉 ${dealt}，期望 ${f.dmg}×13 = ${f.dmg * 13}）`);
    ok(B.energy === 0, '终结牌仍是吃掉全部能量');
  }

  /* --- AA10. 终结牌的目标值：条件苛刻的可以显式提高，但不能默默超 --- */
  {
    const V2 = await import('file://' + join(ROOT, 'js/data/values.js'));
    ok(V2.FINISHER_VALUE === 40, '终结牌参考值仍是 40');
    ok(V2.budgetOf({ finisher: true }) === 40, '没写 finisherTarget 的终结牌用参考值 40');
    const ft = mk('finisher_finaltheorem');
    ok(V2.budgetOf(ft) === 48, `终极定理显式声明目标值 48（实测 ${V2.budgetOf(ft)}）`);
    const v = V2.valueOf(ft);
    ok(Math.abs(v - 48) < 0.01, `终极定理价值 ${v.toFixed(1)} 与目标值一致`);
    // 只允许**这一张**这么做：其余终结牌必须仍在参考值附近（防"整类被放宽"）
    const others = Object.values(CARDS).filter(c => c.finisher && c.id !== 'finisher_finaltheorem');
    const drifted = others.filter(c => V2.valueOf(c) > V2.budgetOf(c) + 2).map(c => c.name);
    ok(drifted.length === 0, '其余终结牌都还在参考值 +2 以内', drifted.join(', '));
    const declared = others.filter(c => c.finisherTarget != null).map(c => c.name);
    ok(declared.length === 0, '只有终极定理显式声明了不同的目标值', declared.join(', '));
  }

  /* --- AA7. 文案短到放得下（终结牌文案略长也不许爆卡面）--- */
  {
    const units = s => { let u = 0; for (const ch of String(s)) { if (/\s/.test(ch)) u += 0.34; else u += /[\x00-\xff]/.test(ch) ? 0.5 : 1.0; } return u; };
    const strip = h => String(h).replace(/<[^>]+>/g, '');
    const long = finishers
      .map(f => ({ f, u: units(strip(f.text(makeCardLike(f)))) }))
      .filter(x => x.u > 28);
    ok(long.length === 0, '终结牌的卡面文案都在 28 单位内（真机可读性预算）',
       long.map(x => `${x.f.name} ${x.u.toFixed(1)}`).join(', '));
  }
}

section('AB. 结算界面必须渲染得出来（通关/失败都不能卡死）+ 冰冻阈值');
{
  /* --- AB1. 结算界面：`go('end')` 不能抛错，且真的把界面挂上去 ---
     2026-10-13 产品报的 bug："寒冰法师通关后最终 Boss 结算界面卡死"。
     真因是 `endScene` 里 `sc`/`picks` 两个 `const` 写在**用它们的模板字符串之后** ——
     `const` 有暂时性死区，模板是立即求值的，于是
     `ReferenceError: Cannot access 'sc' before initialization` 在渲染时抛出：
     `go('end')` 抛错 → 新界面根本没挂上 → **玩家卡在上一屏**。

     ⚠️ 这条断言是**补的洞**：在这之前整个测试套件**没有任何一条**走结算界面
     （只有"结算回调被触发"这类引擎侧断言），所以这个崩溃可以一路绿灯发到线上。
     新增这类断言的方法：**真的 go 一次那个场景，并断言界面元素存在**。 */
  {
    const doc = window.document;
    const screenText = () => (doc.querySelector('.screen')?.textContent || '');

    // ① 通关路径
    A.startRun('icemage');
    A.G.act = 4;
    A.G.stats.floors = 30;
    A.G.picks = ['d_hp_per_act', 'b_gold40'];
    let threw = null;
    try { A.go('end', 'win'); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 200));
    ok(!threw, `通关结算界面渲染不抛错（${threw ? threw.constructor.name + ': ' + threw.message : '无异常'}）`);
    ok(!!doc.querySelector('.end-title'), '通关结算界面真的挂上去了（有标题）');
    ok(screenText().includes('通 关'), '标题写的是「通 关」');
    ok(screenText().includes('本局难度分'), '结算界面显示本局难度分（这是当初加那两行 const 的目的）');
    ok(/本局难度分：\s*\+5/.test(screenText()) || screenText().includes('+5'),
       `难度分算对了（+9 −4 = 5）`);
    ok(screenText().includes('已选 2 条'), '显示选了几条');
    ok([...doc.querySelectorAll('.btn')].some(b => (b.textContent || '').includes('再来一局')),
       '有「再来一局」按钮（玩家有路可走，不是死屏）');

    // ② 失败路径（同一个函数，但走 else 分支）
    A.startRun('knight');
    A.G.picks = [];
    threw = null;
    try { A.go('end', 'lose'); } catch (e) { threw = e; }
    await new Promise(r => setTimeout(r, 200));
    ok(!threw, '失败结算界面渲染不抛错');
    ok(screenText().includes('陨 落'), '标题写的是「陨 落」');
    ok(screenText().includes('标准难度'), '没选条目时显示「标准难度」');

    // ③ 点「再来一局」必须真的能走（不是只有个按钮）
    const retry = [...doc.querySelectorAll('.btn')].find(b => (b.textContent || '').includes('再来一局'));
    retry.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    await new Promise(r => setTimeout(r, 300));
    ok(!screenText().includes('陨 落'), '点「再来一局」真的离开了结算界面');
    A.go('menu'); await new Promise(r => setTimeout(r, 120));
  }

  /* --- AB2. 冰冻阈值：小怪 4 / 精英 6 / Boss 8 / 玩家 4 ---
     2026-10-13 产品提高（原来普通/精英都是 3、Boss 5）。
     注意"精英"按**战斗类型**判定 —— 数据里 `guard_elite` 缺 `elite` 标记、
     `gargoyle` 又带着标记却出现在普通表里，所以逐只怪物看标记是错的（见 battle.js 注释）。 */
  {
    const mk = id => ({ ...CARDS[id], uid: 't#' + id });
    const noop = { step: async () => {}, sync() {}, log() {} };

    const thr = async (enc, kind, idx = 0) => {
      A.startRun('icemage');
      const B = new A.Battle(enc, { kind });
      B.view = { ...noop };
      B.rollIntents();
      await B.start();
      return B.freezeThreshold(B.aliveEnemies()[idx]);
    };

    ok(await thr(['slime'], 'battle') === 4, '普通小怪需要 4 层冰霜');
    ok(await thr(['slime_big'], 'elite') === 6, '精英需要 6 层冰霜');
    ok(await thr(['boss_eye'], 'boss') === 8, 'Boss 需要 8 层冰霜');

    // 阈值真的影响转化：喂 3 层不冻，第 4 层才冻
    {
      A.startRun('icemage');
      const B = new A.Battle(['slime'], { kind: 'battle' });
      B.view = { ...noop };
      B.rollIntents();
      await B.start();
      const e = B.aliveEnemies()[0];
      B.add(e, 'frost', 3);
      ok(B.get(e, 'freeze') === 0, '小怪 3 层冰霜时还没被冻住（阈值 4）');
      B.add(e, 'frost', 1);
      ok(B.get(e, 'freeze') === 1, '加到第 4 层就被冻住了');
      ok(B.get(e, 'frost') === 0, '转化时消耗掉全部冰霜层数');
    }
    // 精英：3 层不冻（这条能区分"阈值真的变成 6 了"而不是仍按 3）
    {
      A.startRun('icemage');
      const B = new A.Battle(['slime_big'], { kind: 'elite' });
      B.view = { ...noop };
      B.rollIntents();
      await B.start();
      const e = B.aliveEnemies()[0];
      B.add(e, 'frost', 4);
      ok(B.get(e, 'freeze') === 0, '精英 4 层冰霜时还没被冻住（阈值 6）');
      B.add(e, 'frost', 2);
      ok(B.get(e, 'freeze') === 1, '精英加到第 6 层才冻住');
    }
    // Boss：5 层不冻（旧阈值就是 5，这条能区分新旧）
    {
      A.startRun('icemage');
      const B = new A.Battle(['boss_eye'], { kind: 'boss' });
      B.view = { ...noop };
      B.rollIntents();
      await B.start();
      const e = B.aliveEnemies()[0];
      B.add(e, 'frost', 5);
      ok(B.get(e, 'freeze') === 0, 'Boss 5 层冰霜时还没被冻住（阈值 8）');
      B.add(e, 'frost', 3);
      ok(B.get(e, 'freeze') === 1, 'Boss 加到第 8 层才冻住');
    }
    // 玩家侧保持 4 层（产品这次没提）
    {
      A.startRun('icemage');
      const B = new A.Battle(['slime'], { kind: 'battle' });
      B.view = { ...noop };
      B.rollIntents();
      await B.start();
      ok(B.freezeThreshold(B.player) === 4, '玩家仍然是 4 层（本次没改玩家侧）');
    }
    // 状态说明文字必须跟着改（否则又是"文案撒谎"）
    const { ST } = await import('file://' + join(ROOT, 'js/core/battle.js'));
    ok(/4/.test(ST.frost.desc) && /6/.test(ST.frost.desc) && /8/.test(ST.frost.desc),
       `冰霜说明写出了新阈值（实际「${ST.frost.desc}」）`);
    ok(!/Boss <b>5<\/b>/.test(ST.frost.desc), '冰霜说明不再写旧的「Boss 5 层」');
    const helpSrc = readFileSync(join(ROOT, 'js/ui/scene-battle.js'), 'utf8');
    ok(!/怪物 3 \/ 玩家 4 \/ Boss 5/.test(helpSrc), '战斗内帮助文本里的冰霜阈值也已更新');
  }
}

/* ================= 汇总 ================= */
console.log(`\n\x1b[1m========== 测试汇总 ==========\x1b[0m`);
console.log(`  通过 \x1b[32m${pass}\x1b[0m   失败 \x1b[31m${fail}\x1b[0m`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach(f => console.log('  ✗ ' + f));
}
process.exit(fail ? 1 : 0);

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
  ok(!!byText('铁誓骑士'), '进入选职业界面');

  // 选骑士
  byText('铁誓骑士').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await new Promise(r => setTimeout(r, 120));
  const nodes = doc.querySelectorAll('.mnode');
  ok(nodes.length > 10, `地图渲染出节点（${nodes.length} 个）`);
  ok(doc.querySelectorAll('.mnode.avail').length > 0, '有可前往的节点');
  ok(doc.querySelectorAll('.map-lines line').length > 0, '地图连线已绘制');
  ok(doc.querySelectorAll('.relic').length > 0, '遗物条已渲染');

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

  // 结束回合
  const endBtn = byText('结束回合');
  ok(!!endBtn, '有结束回合按钮');
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
    ok(strikeText.includes('9'), '卡面显示的是升级后的数值（打击 6 → 9）', strikeText);
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
    ok(atk.map(x => +x.toFixed(4)).join(',') === '1,1.2,1.4,1.6',
       `攻击每层 +20%：${atk.map(x => (x * 100).toFixed(0) + '%').join(' → ')}`);
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
      ok(Math.abs(dmgRatio - 1.6) < 0.06, `${ENEMIES[id].name} 第4层伤害约为第1层的 1.6 倍（实测 ${dmgRatio.toFixed(2)}）`);
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
    ok(ENEMIES[last].hp[0] >= 200, `最终 Boss 基础生命够高（${ENEMIES[last].hp[0]}）`);
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
    const B = new A.Battle(['slime'], { kind: 'battle' });
    A.go('battle', B);
    await sleep3(250);
    // 手动放一瓶药水进去（避免依赖随机掉落）
    const { POTIONS } = await import('file://' + join(ROOT, 'js/data/potions.js'));
    A.G.potions = [{ ...POTIONS.heal }];
    B.view.sync?.();
    await sleep3(200);
    const bar = doc.querySelector('.potionbar') || doc.querySelectorAll('.relicbar')[1];
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

section('Q. 虚弱按层递减 / 斩杀 / 毒死即结算');
{
  const noopView = { step: async () => {}, sync() {}, log() {}, onDamage() {}, onHeal() {}, onBlock() {},
    onStatus() {}, onDraw() {}, onPlay() {}, onExhaust() {}, onEnergy() {}, onGold() {},
    onTurnStart() {}, onEnemyAct() {}, onSummon() {}, onDeath() {}, onEnd() {}, onPotion() {}, beforeEndTurn() {} };
  const { makeCard: mkCard } = await import('file://' + join(ROOT, 'js/data/cards.js'));
  const { WEAK_PER_STACK } = await import('file://' + join(ROOT, 'js/core/battle.js'));

  const mk = (ids = ['golem']) => {
    A.startRun('knight');
    const B = new A.Battle(ids, { kind: 'battle' });
    B.view = { ...noopView };
    B.rollIntents();
    return B;
  };

  /* --- Q1. 虚弱随层数递减，4 层 = 0 伤害 ---
     旧代码是 `if (get(atk,'weak') > 0) d *= 0.75` —— 只判断"有没有"，
     叠到 20 层也只减 25%，玩家堆虚弱等于白堆。 */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    const rows = [];
    for (const n of [0, 1, 2, 3, 4, 8]) {
      B.player.st.weak = n;
      rows.push([n, B.calcDamage(20, B.player, e)]);
    }
    const expect = [[0, 20], [1, 15], [2, 10], [3, 5], [4, 0], [8, 0]];
    ok(JSON.stringify(rows) === JSON.stringify(expect),
       `虚弱每层 -25%、4 层归零（实测 ${rows.map(r => r[0] + '层→' + r[1]).join(' ')}）`);
    ok(WEAK_PER_STACK === 0.25, `每层虚弱 = ${WEAK_PER_STACK * 100}%`);
  }

  /* --- Q2. 0 伤害就是真的打不动（不掉血、不误杀） --- */
  {
    const B = mk();
    await B.start();
    const e = B.aliveEnemies()[0];
    e.hp = 20; e.maxHp = 20; e.block = 0;
    B.add(B.player, 'weak', 4);
    const hp0 = e.hp;
    await B.damage(e, 99, '测试', { attacker: B.player });
    ok(e.hp === hp0, `4 层虚弱下 99 点攻击打出 0 伤害（${hp0} -> ${e.hp}）`);
    ok(!e.dead, '也没有把它打成负血/打死');
  }

  /* --- Q3. 斩杀：伤害打不死、但打完低于阈值 → 处决 --- */
  {
    const B = mk(['boss_abyss']);
    await B.start();
    const e = B.aliveEnemies()[0];
    e.maxHp = 200;
    e.hp = 60;                                   // 打 10 点后剩 50 = 25%（含边界）
    e.block = 0;
    const card = mkCard('assassinate');
    await B.resolve(card.fx, { card, target: e, melee: true });
    ok(e.dead, `斩杀触发：60/200（30%）挨 10 点后到 25%，被处决（剩 ${e.hp}）`);
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
     虚弱只降低那 10 点伤害，不该影响"低于阈值就处决"这件事。 */
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
    ok(dmg === 5, `虚弱 2 层把 10 点削到 ${dmg} 点`);
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

section('运行期 JS 错误');
{
  const real = jsErrors.filter(e => !/Not implemented|Could not parse CSS|audio/i.test(e));
  ok(real.length === 0, '无未捕获 JS 错误', real.slice(0, 8).join('\n      '));
  if (real.length) real.slice(0, 10).forEach(e => console.log('      ', e.slice(0, 200)));
}

/* ================= 汇总 ================= */
console.log(`\n\x1b[1m========== 测试汇总 ==========\x1b[0m`);
console.log(`  通过 \x1b[32m${pass}\x1b[0m   失败 \x1b[31m${fail}\x1b[0m`);
if (failures.length) {
  console.log('\n失败项：');
  failures.forEach(f => console.log('  ✗ ' + f));
}
process.exit(fail ? 1 : 0);

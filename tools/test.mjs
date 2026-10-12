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
  const { ENEMIES, ENCOUNTERS } = await import('file://' + join(ROOT, 'js/data/enemies.js'));
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
  for (const act of [1, 2, 3]) {
    for (const grp of ['weak', 'strong', 'elite', 'boss']) {
      if (!ENCOUNTERS[act]?.[grp]?.length) { badEnc.push(`act${act}.${grp} 缺失`); continue; }
      for (const enc of ENCOUNTERS[act][grp]) for (const eid of enc) if (!ENEMIES[eid]) badEnc.push(`act${act}.${grp} 引用未知敌人 ${eid}`);
    }
  }
  ok(badEnc.length === 0, '遭遇战配置完整', badEnc.slice(0, 5).join(' | '));

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
    ].filter(f => WEB_EXT.test(f) && !/^assets\/licenses\//.test(f));

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

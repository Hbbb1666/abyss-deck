import { el, clear, sleep, toast, fitStage, disposeScene } from './core/util.js';
import { gainGold, G, newRun, save, hasSave, loadSave, clearSave, loadMeta, saveMeta, bumpMeta, addRelic, gainMaxHp, relicMods, relicHooks, rollCardChoices, rollRelic, rollPotion, FINISHER_WEIGHT, CLASS_CARD_WEIGHT } from './core/state.js';
import { generateMap } from './core/map.js';
import { Battle } from './core/battle.js';
import { ENCOUNTERS, TOTAL_ACTS } from './data/enemies.js';
import { actIntro } from './data/events.js';
import { CARDS } from './data/cards.js';
import { RELICS } from './data/relics.js';
import { CLASSES } from './data/classes.js';
import { scoreOf, splitPicks, pickById, MAX_PICKS } from './data/difficulty.js';
import { sfx, initAudio } from './core/audio.js';
import { fitAllCards } from './ui/widgets.js';
import { menuScene, classScene, endScene, veteranScene } from './ui/scene-menu.js';
import { mapScene } from './ui/scene-map.js';
import { battleScene, finisherHint } from './ui/scene-battle.js';
import { rewardScene, shopScene, eventScene, restScene, treasureScene } from './ui/scene-rooms.js';
import { difficultyScene } from './ui/scene-difficulty.js';

const app = document.getElementById('app');
let rendering = false;
let mounted = null;          // 当前挂在 #app 里的场景节点（切场景时用它摘监听器）

/* ================= 路由 ================= */

/* 渲染期崩溃的记录（诊断用）。
   为什么需要：`go()` 的实现是 **先 `clear(app)` 再 `append(node)`** ——
   只要场景构造或挂载抛错，旧界面已经删了、新界面没挂上，玩家看到的就是
   **白屏/卡死**（2026-10-13 产品在真机上遇到的"Boss 结算卡死"就是这个症状）。
   把错误记在 localStorage 里，下次真机复现时能直接取到真因，而不用靠猜。 */
const ERR_KEY = 'abyss_deck_errors_v1';
function recordSceneError(name, err) {
  try {
    const list = JSON.parse(localStorage.getItem(ERR_KEY) || '[]');
    list.push({
      at: new Date().toISOString(), scene: name,
      msg: String(err && err.message || err),
      stack: String(err && err.stack || '').split('\n').slice(0, 6).join('\n'),
    });
    localStorage.setItem(ERR_KEY, JSON.stringify(list.slice(-10)));   // 只留最近 10 条
  } catch { /* 记录失败不能反过来影响玩家 */ }
  try { console.error(`[abyss] 场景「${name}」渲染失败：`, err); } catch {}
}

/** 渲染失败时的兜底界面 —— 绝不能让玩家卡在死屏上。
    直接给出可走的出口（回主菜单 / 继续游戏），并把错误摘要显示出来，
    这样玩家截图就能当证据。 */
function crashScene(name, err) {
  const root = el('div', { class: 'screen center' });
  root.append(
    el('div', { class: 'end-title lose', style: { fontSize: '22px' }, text: '出错了' }),
    el('div', {
      class: 'small dim', style: { maxWidth: '320px', margin: '12px 0', lineHeight: '1.9', textAlign: 'center' },
      html: `场景「<b>${name}</b>」没能渲染出来。<br>进度已经保存，可以安全地回到主菜单或继续游戏。`,
    }),
    el('div', {
      class: 'tiny dim', style: { maxWidth: '320px', margin: '0 0 14px', lineHeight: '1.6', textAlign: 'center', wordBreak: 'break-all' },
      text: String(err && err.message || err),
    }),
  );
  const col = el('div', { class: 'col gap8', style: { width: '100%', maxWidth: '260px' } });
  col.append(el('button', { class: 'btn primary block', text: '返回主菜单', onClick: () => { try { sfx.back(); } catch {} go('menu'); } }));
  col.append(el('button', { class: 'btn ghost block', text: '继续游戏', onClick: () => { try { sfx.confirm(); } catch {} resumeRun(); } }));
  root.append(col);
  return root;
}

function go(name, ...args) {
  if (rendering) return;
  rendering = true;
  try {
    let node;
    try {
      node = buildScene(name, args);
    } catch (err) {
      // 场景**构造**就抛错（例如模板字符串读了未初始化的变量、数据缺失）
      recordSceneError(name, err);
      node = crashScene(name, err);
    }
    if (!node || !node.nodeType) {
      // 场景函数返回了非节点（比如某条路径 `return;`）—— 同样不能让玩家白屏
      const err = new Error(`场景「${name}」没有返回可挂载的节点`);
      recordSceneError(name, err);
      node = crashScene(name, err);
    }
    // 先摘掉上一个场景注册的 window/document 监听器，再拆 DOM。
    // 顺序很重要：反过来的话，监听器会短暂指着已经不在文档里的节点。
    // ⚠️ 这一段也在 try 里：`clear` 已经把旧界面删了，这里再抛错就是白屏 ——
    // 所以任何失败都退回兜底界面。
    try {
      disposeScene(mounted);
      clear(app);
      app.append(node);
    } catch (err) {
      recordSceneError(name + ':mount', err);
      try { clear(app); app.append(crashScene(name, err)); } catch {}
    }
    mounted = app.firstChild || node;
    // 卡面描述长短不一，渲染后统一做一次文字适配（放不下的自动缩字号）
    requestAnimationFrame(() => { try { fitAllCards(app); } catch {} });
    if (name !== 'menu' && name !== 'class' && name !== 'end') save();
  } finally {
    rendering = false;
  }
}

/** 场景构造（从 go 里拆出来，只为让"构造失败"能被单独 try 住） */
function buildScene(name, args) {
  let node;
  switch (name) {
      case 'menu': node = menuScene({ onNew: beginNewRun, onContinue: resumeRun }); break;
      /* 流程（桌面端 + 手机端合并后的最终顺序）：
           点开始 → 问「新手 / 老手」→
             新手 → 铁誓骑士直接开局（跳过难度与职业）
             老手 → 先选难度与增益，再选职业（职业按难度分**解锁**）
           通关过一次之后不再问，一律默认老手（见 beginNewRun）
         ⚠️ 询问必须排在**职业之前**：职业解锁门槛是难度分（CLASSES[].unlockScore），
            分数要先在难度页选出来 —— 顺序反了就没法解锁。 */
      case 'veteran': node = veteranScene({ onNovice: () => startRun('knight', []), onVeteran: () => go('difficulty'), onBack: () => go('menu') }); break;
      // picks 透传：从职业页点「返回」过来时要带着上一次的选择（否则回来一看全空了）
      case 'difficulty': node = difficultyScene({ picks: args[0] || [], onStart: (picks) => go('class', picks), onBack: () => go('menu') }); break;
      case 'class': node = classScene({
        picks: args[0] || [],
        onPick: (clsId) => startRun(clsId, args[0] || []),
        onBack: () => go('difficulty', args[0] || []),   // 返回时把已选内容带回去，别让玩家重选
      }); break;
      case 'map': node = mapScene({ onEnter: enterRoom }); break;
      case 'battle': node = battleScene(args[0], { onFinish: onBattleEnd, onQuit: quitRun, resumed: !!args[1] }); break;
      case 'reward': node = rewardScene(args[0], { onDone: afterRoom }); break;
      case 'shop': node = shopScene({ onDone: afterRoom }); break;
      case 'event': node = eventScene({ onDone: afterRoom, onFight: () => startBattle('elite', 'elite'), ...(args[0] || {}) }); break;
      // 每层开场事件：onDone 是 afterIntro（直接回地图），区别于普通事件的 afterRoom
      case 'intro': node = eventScene({ onDone: afterIntro, onFight: () => startBattle('elite', 'elite'), ev: actIntro(G.act), intro: true }); break;
      case 'rest': node = restScene({ onDone: afterRoom }); break;
      case 'treasure': node = treasureScene({ onDone: afterRoom }); break;
      case 'end': node = endScene(args[0], { onMenu: () => go('menu'), onRetry: beginNewRun }); break;
      default: node = el('div', { class: 'screen center' }, el('div', { text: '未知场景: ' + name }));
  }
  return node;
}

/* ================= 开局 ================= */
/** 选了职业之后：通关过就先进难度选择，否则直接开（0 分 = 标准难度） */
/** 开始新的一局。
    流程入口：
      · **从未通关过** → 问一句「新手 / 老手」
          新手 → 铁誓骑士直接开局（跳过难度与职业）
          老手 → 难度页 → 职业页（职业按难度分解锁）
      · **通关过一次之后** → 不再问，一律默认老手，直接进难度页
        （玩家已经熟悉规则，再问只是多一次点击）
    ⚠️ 询问必须排在职业之前：职业解锁要看难度分，而分数要先选出来。 */
function beginNewRun() {
  const meta = loadMeta();
  if (meta.wins > 0) { go('difficulty'); return; }   // 已通关 = 默认老手
  go('veteran');
}

function startRun(clsId, picks = []) {
  newRun(clsId, undefined, picks);
  bumpMetaStat({ runs: loadMeta().runs + 1 });
  G.pending = null;
  G.map = generateMap(G.seed, 1, mapOpts());
  G.act = 1;
  save();
  sfx.door();
  const sc = scoreOf(picks);
  toast(`${CLASSES[clsId].name} 出发了${sc ? `（${sc > 0 ? '+' : ''}${sc} 分）` : ''}`, 1400);
  // 每层开始都先过一个「开场事件」（类似杀戮尖塔的 Neow）：
  // 先选起手增益，再进这一层的地图。
  go('intro');
}

/** 地图生成需要知道的难度开关 */
function mapOpts() {
  const m = relicMods();
  return { eliteWeightUp: !!m.eliteWeightUp, restAsEvent: !!m.restAsEvent };
}

/** 开场事件：只给这一层用，选完就往地图走。
    必须走 'intro' 分支 —— 它把 onDone 绑到 afterIntro（回地图），
    而普通 'event' 的 onDone 是 afterRoom（会去判断"是不是 Boss 房间"）。 */
function goIntro() {
  setPending({ scene: 'intro', act: G.act });
  go('intro');
}

function resumeRun() {
  const g = loadSave();
  if (!g) { toast('没有找到存档'); go('menu'); return; }
  const p = g.pending;
  if (p && p.scene === 'battle') { resumeBattle(p); return; }
  if (p && p.scene === 'reward') { go('reward', p.kind); return; }
  if (p && p.scene === 'intro') { go('intro'); return; }        // 开场事件中途关页面，回来还在
  if (p && ['shop', 'rest', 'treasure', 'event'].includes(p.scene)) { go(p.scene); return; }
  go('map');
}

function quitRun() {
  clearSave();
  go('menu');
}

function bumpMetaStat(patch) { saveMeta({ ...loadMeta(), ...patch }); }

/* ================= 房间 ================= */
function pickEncounter(kind) {
  // 遭遇战表按层取；层数超出表范围时退回最后一层（而不是 undefined 崩掉）
  const act = Math.max(1, Math.min(G.act, TOTAL_ACTS));
  const tbl = ENCOUNTERS[act] || ENCOUNTERS[TOTAL_ACTS] || ENCOUNTERS[Object.keys(ENCOUNTERS).pop()];
  if (kind === 'boss') return G.rng.pick(tbl.boss);
  if (kind === 'elite') return G.rng.pick(tbl.elite);
  if (kind === 'weak') return G.rng.pick(tbl.weak);
  return G.rng.pick(tbl.strong);
}

function enterRoom(node) {
  sfx.step();
  const m = relicMods();
  // 难度「无处歇脚」把营火换成事件：地图上已经是 event 了，这里再兜一层，
  // 防止老存档里还留着 rest 节点（地图是存进存档的，改难度不会重生成旧地图）。
  const type = (node.type === 'rest' && m.restAsEvent) ? 'event' : node.type;
  // 记下当前房间：中途关掉页面再回来，能原样回到这个房间，不会白白跳过
  const strong = node.r >= 5 && G.rng.chance(0.55);
  switch (type) {
    case 'battle': startBattle(strong ? 'strong' : 'weak', 'battle'); break;
    case 'elite': startBattle('elite', 'elite'); break;
    case 'boss': startBattle('boss', 'boss'); break;
    case 'shop': setPending({ scene: 'shop' }); go('shop'); break;
    case 'rest': setPending({ scene: 'rest' }); go('rest'); break;
    case 'treasure': setPending({ scene: 'treasure' }); go('treasure'); break;
    case 'event': setPending({ scene: 'event' }); go('event'); break;
    default: setPending({ scene: 'event' }); go('event');
  }
}

function setPending(p) { G.pending = p ? { ...p, ts: Date.now() } : null; save(); }

function startBattle(kind, type) {
  setPending({ scene: 'battle', kind, type });
  const enc = pickEncounter(kind);
  const B = new Battle(enc, { kind: type });
  // 把当前战斗暴露出来（只给测试/排查用）。
  // 为什么需要：`battleScene` 把战斗实例关在自己的闭包里，外部（自动化测试、
  // 真机排查）**拿不到它**，只能靠模拟点击慢慢磨 —— 想验证"打死 Boss 之后
  // 会不会卡"就必须能直接结束这场战斗。之前只能靠 jsdom 自己造一个 Battle，
  // 那跑的不是真实那条路径（漏掉了 battleScene 的 onEnd → onFinish 链路）。
  window.__CURRENT_BATTLE__ = B;
  go('battle', B);
}

/** 从存档快照恢复一场没打完的战斗：敌人 / 血量 / 手牌都和关页面时一模一样 */
function resumeBattle(p) {
  if (!p.snap) { startBattle(p.kind, p.type); return; }
  const B = new Battle([], { kind: p.kind, restore: p.snap });
  // 快照版本不认（例如以后改了快照结构、或玩家存的是旧版本档）时，
  // 绝不能顺着往下走 —— 那时敌人数组是空的，会被判成"敌人全死"直接白送一关。
  // 退化成重新开一场同类型的战斗，玩家最多是重打这一场，而不是凭空通关。
  if (B.restoreFailed) {
    console.warn('[abyss] 战斗存档版本不兼容，改为重新开始这场战斗');
    toast('这份战斗存档读不了，这场重新开始', 1800);
    startBattle(p.kind, p.type);
    return;
  }
  go('battle', B, true);
}

function onBattleEnd(result, B) {
  if (result === 'lose') { setPending(null); finishRun(false); return; }
  const kind = B.kind === 'boss' ? 'boss' : B.kind === 'elite' ? 'elite' : 'battle';
  setPending({ scene: 'reward', kind });
  go('reward', kind);
}

function afterRoom() {
  setPending(null);
  // 从房间返回地图；Boss 房间要进下一层
  const n = G.node;
  if (n && (G.map.nodes.find(x => x.r === n.r && x.c === n.c)?.type === 'boss')) {
    if (G.act >= TOTAL_ACTS) { finishRun(true); return; }
    G.act++;
    G.node = null;
    G.visited = {};
    G.map = generateMap((G.seed * 7919 + G.act * 104729) >>> 0, G.act, mapOpts());
    toast(`进入第 ${G.act} 层`, 1600);
    sfx.bell();
    save();
    // 每一层都先过开场事件，再开始探索
    goIntro();
    return;
  }
  save();
  go('map');
}

/** 开场事件结束 → 正式开始这一层 */
function afterIntro() {
  setPending(null);
  save();
  sfx.door();
  go('map');
}

function finishRun(win) {
  G.over = win ? 'win' : 'dead';
  const meta = loadMeta();
  const sc = scoreOf(G.picks || []);
  saveMeta({
    ...meta,
    wins: meta.wins + (win ? 1 : 0),
    best: Math.max(meta.best || 0, G.stats.floors || 0),
    totalKills: (meta.totalKills || 0) + (G.stats.kills || 0),
    // 通关时记录本局难度分。只有赢的局算数 —— 输了不代表"这个难度能通"。
    // bestScore 记的是**通关过的最高分**，未通关为 0（从未通关 = 0 分难度）。
    bestWinScore: win ? Math.max(meta.bestWinScore || 0, sc) : (meta.bestWinScore || 0),
    lastScore: sc,
  });
  clearSave();
  go('end', win ? 'win' : 'lose');
}

/* ================= 启动 ================= */
fitStage();
addEventListener('resize', () => fitStage());
addEventListener('orientationchange', () => setTimeout(fitStage, 120));
if (window.visualViewport) window.visualViewport.addEventListener('resize', () => fitStage());

const kick = () => { initAudio(); window.removeEventListener('pointerdown', kick); window.removeEventListener('keydown', kick); };
window.addEventListener('pointerdown', kick);
window.addEventListener('keydown', kick);

// 屏蔽移动端双击缩放 / 长按菜单
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('contextmenu', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

// 防止整页滚动回弹
document.body.addEventListener('touchmove', e => {
  // 只有这些容器允许触摸滚动，其它地方一律拦住（避免整页回弹）
  // .field 也允许滚：敌人太多时战场会纵向溢出，得能滚到下面几排
  const sc = e.target.closest?.('.scroll, .hand, .relicbar, .map-wrap, .mbody, .field');
  if (!sc) e.preventDefault();
}, { passive: false });

go('menu');

// 调试入口（headless 验证用）
// ⚠️ 测试必须通过这里拿函数，**不能 `import` 源码模块**：
//    `import('js/core/state.js')` 会创建**另一份模块实例**，它有自己独立的 `G`（通常是 null），
//    于是 relicHooks/loadSave 全都作用在另一个世界上，断言会静默失效。
//    我踩过一次：难度钩子的测试直接 import 了 state.js，钩子拿到空数组，
//    表现成"这条难度没生效"，其实是测试连错了世界。
window.__ABYSS__ = {
  go, startRun, beginNewRun, enterRoom, pickEncounter, startBattle, fitStage,
  Battle, CARDS, RELICS, addRelic, gainMaxHp, relicMods, mapOpts, scoreOf, MAX_PICKS,
  // 与运行时**同一份实例**的状态与工具
  get G() { return G; },
  save, loadSave, clearSave, hasSave, loadMeta, saveMeta, bumpMeta, gainGold,
  // gainGold 走统一的乘区（难度「金币减少」），测试要能验真实到账数额
  relicHooks, splitPicks, pickById,
  // 奖励池掷骰：测试要验"终结牌权重低 + 牌组唯一"。
  // ⚠️ 必须从这里暴露 —— 测试若 `import('js/core/state.js')` 会拿到**另一份模块实例**
  //（它有自己独立的 `G`，与运行时那个不是同一个），断言会静默失效/空绿。
  rollCardChoices, rollRelic, rollPotion,
  FINISHER_WEIGHT, CLASS_CARD_WEIGHT,
  // 终结牌「打不出去」的提示（读卡牌自己的 condText）。
  // 暴露出来是为了让测试能断言"提示文本 == 条件边界"，
  // 而不是靠人肉对照两张表（那张手抄表曾经说谎，见 scene-battle.js 的说明）。
  finisherHint,
  // 渲染期崩溃的记录（诊断用）。真机上再遇到"卡死"时，靠这个取真因，不用猜。
  sceneErrors: () => { try { return JSON.parse(localStorage.getItem(ERR_KEY) || '[]'); } catch { return []; } },
  clearSceneErrors: () => { try { localStorage.removeItem(ERR_KEY); } catch {} },
  // 当前战斗实例（startBattle 里挂上）—— 自动化测试要能直接结束一场战斗
  get currentBattle() { return window.__CURRENT_BATTLE__ || null; },
  // 当前事件界面的 api（eventScene 里挂上）—— 测试要能直接调 api.damage 验"战斗外不能死"
  get eventApi() { return window.__EVENT_API__ || null; },
};


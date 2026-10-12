import { el, clear, sleep, toast, fitStage, disposeScene } from './core/util.js';
import { G, newRun, save, hasSave, loadSave, clearSave, loadMeta, saveMeta, bumpMeta, addRelic } from './core/state.js';
import { generateMap, MAP_ROWS } from './core/map.js';
import { Battle } from './core/battle.js';
import { ENCOUNTERS } from './data/enemies.js';
import { CARDS } from './data/cards.js';
import { RELICS } from './data/relics.js';
import { CLASSES } from './data/classes.js';
import { sfx, initAudio, setMuted } from './core/audio.js';
import { fitAllCards } from './ui/widgets.js';
import { menuScene, classScene, endScene } from './ui/scene-menu.js';
import { mapScene } from './ui/scene-map.js';
import { battleScene } from './ui/scene-battle.js';
import { rewardScene, shopScene, eventScene, restScene, treasureScene } from './ui/scene-rooms.js';

const app = document.getElementById('app');
let rendering = false;
let mounted = null;          // 当前挂在 #app 里的场景节点（切场景时用它摘监听器）

/* ================= 路由 ================= */
function go(name, ...args) {
  if (rendering) return;
  rendering = true;
  try {
    let node;
    switch (name) {
      case 'menu': node = menuScene({ onNew: () => go('class'), onContinue: resumeRun }); break;
      case 'class': node = classScene({ onPick: startRun, onBack: () => go('menu') }); break;
      case 'map': node = mapScene({ onEnter: enterRoom }); break;
      case 'battle': node = battleScene(args[0], { onFinish: onBattleEnd, onQuit: quitRun, resumed: !!args[1] }); break;
      case 'reward': node = rewardScene(args[0], { onDone: afterRoom }); break;
      case 'shop': node = shopScene({ onDone: afterRoom }); break;
      case 'event': node = eventScene({ onDone: afterRoom, onFight: () => startBattle('elite', 'elite') }); break;
      case 'rest': node = restScene({ onDone: afterRoom }); break;
      case 'treasure': node = treasureScene({ onDone: afterRoom }); break;
      case 'end': node = endScene(args[0], { onMenu: () => go('menu'), onRetry: () => go('class') }); break;
      default: node = el('div', { class: 'screen center' }, el('div', { text: '未知场景: ' + name }));
    }
    // 先摘掉上一个场景注册的 window/document 监听器，再拆 DOM。
    // 顺序很重要：反过来的话，监听器会短暂指着已经不在文档里的节点。
    disposeScene(mounted);
    clear(app);
    app.append(node);
    mounted = node;
    // 卡面描述长短不一，渲染后统一做一次文字适配（放不下的自动缩字号）
    requestAnimationFrame(() => fitAllCards(app));
    if (name !== 'menu' && name !== 'class' && name !== 'end') save();
  } finally {
    rendering = false;
  }
}

/* ================= 开局 ================= */
function startRun(clsId) {
  newRun(clsId);
  bumpMetaStat({ runs: loadMeta().runs + 1 });
  G.pending = null;
  G.map = generateMap(G.seed, 1);
  save();
  sfx.door();
  toast(`${CLASSES[clsId].name} 出发了`, 1400);
  go('map');
}

function resumeRun() {
  const g = loadSave();
  if (!g) { toast('没有找到存档'); go('menu'); return; }
  const p = g.pending;
  if (p && p.scene === 'battle') { resumeBattle(p); return; }
  if (p && p.scene === 'reward') { go('reward', p.kind); return; }
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
  const tbl = ENCOUNTERS[Math.min(G.act, 3)] || ENCOUNTERS[3];
  if (kind === 'boss') return G.rng.pick(tbl.boss);
  if (kind === 'elite') return G.rng.pick(tbl.elite);
  if (kind === 'weak') return G.rng.pick(tbl.weak);
  return G.rng.pick(tbl.strong);
}

function enterRoom(node) {
  sfx.step();
  // 记下当前房间：中途关掉页面再回来，能原样回到这个房间，不会白白跳过
  const strong = node.r >= 5 && G.rng.chance(0.55);
  switch (node.type) {
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
    if (G.act >= 3) { finishRun(true); return; }
    G.act++;
    G.node = null;
    G.visited = {};
    G.map = generateMap((G.seed * 7919 + G.act * 104729) >>> 0, G.act);
    toast(`进入第 ${G.act} 层`, 1600);
    sfx.bell();
    save();
    go('map');
    return;
  }
  save();
  go('map');
}

function finishRun(win) {
  G.over = win ? 'win' : 'dead';
  const meta = loadMeta();
  saveMeta({
    ...meta,
    wins: meta.wins + (win ? 1 : 0),
    best: Math.max(meta.best || 0, G.stats.floors || 0),
    totalKills: (meta.totalKills || 0) + (G.stats.kills || 0),
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
  const sc = e.target.closest?.('.scroll, .hand, .relicbar, .map-wrap, .mbody');
  if (!sc) e.preventDefault();
}, { passive: false });

go('menu');

// 调试入口（headless 验证用）
window.__ABYSS__ = { go, startRun, get G() { return G; }, enterRoom, pickEncounter, Battle, startBattle, CARDS, RELICS, fitStage };


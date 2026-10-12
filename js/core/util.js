/* ============ DOM 速写 ============ */
export function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'style' && typeof v === 'object') {
      // 注意：CSS 自定义属性（--xxx）不能靠 Object.assign 写进去，会被静默忽略，
      // 必须走 setProperty。这里统一处理，免得下次又踩。
      for (const [sk, sv] of Object.entries(v)) {
        if (sv == null) continue;
        if (sk.startsWith('--')) n.style.setProperty(sk, String(sv));
        else n.style[sk] = sv;
      }
    }
    else if (k === 'data' && typeof v === 'object') for (const [dk, dv] of Object.entries(v)) n.dataset[dk] = dv;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat(9)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const clear = n => { while (n.firstChild) n.removeChild(n.firstChild); return n; };

/* ============ 数学 ============ */
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/** mulberry32 —— 可复现随机数 */
export function makeRng(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.int = (n, m) => (m === undefined ? Math.floor(f() * n) : Math.floor(f() * (m - n + 1)) + n);
  f.pick = arr => arr[Math.floor(f() * arr.length)];
  f.chance = p => f() < p;
  f.shuffle = arr => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(f() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; };
  /** 从数组里不放回地取 n 个 */
  f.sample = (arr, n) => f.shuffle(arr).slice(0, n);
  f.weighted = pairs => { // [[item, weight], ...]
    const tot = pairs.reduce((s, p) => s + p[1], 0);
    let r = f() * tot;
    for (const [it, w] of pairs) { r -= w; if (r <= 0) return it; }
    return pairs[pairs.length - 1][0];
  };
  f.getState = () => a >>> 0;
  f.setState = s => { a = s >>> 0; };
  return f;
}

/* ============ 舞台自适应缩放 ============ */
/**
 * 把 #stage 缩放到刚好铺满视口，同时保证内容够大看得清。
 *
 * 为什么需要它：有些手机浏览器（比如 MIUI 开"电脑版网页"）给的是
 * 980px 这样的桌面级视口，如果按普通手机尺寸排版，内容在物理屏幕上
 * 只有一半大、四周还留一大片空白。
 *
 * 用 zoom 而不是 transform：zoom 会触发重新排版，
 * 文字按目标字号光栅化、像素画按整数像素绘制，放大后不糊。
 */
export function fitStage() {
  const stage = document.getElementById('stage');
  const viewport = document.getElementById('viewport');
  if (!stage || !viewport) return 1;

  const vw = innerWidth || document.documentElement.clientWidth || 375;
  const vh = innerHeight || document.documentElement.clientHeight || 667;

  const REF_W = 430;   // 设计基准宽度（css/style.css 里的尺寸都按这个宽度写）
  const REF_H = 800;   // 设计基准高度

  // 缩放到铺满，但不缩小（小屏按 1:1），最大 3 倍防止离谱
  let k = Math.min(vw / REF_W, vh / REF_H);
  k = Math.max(1, Math.min(k, 3));

  let designW = vw / k;
  let designH = vh / k;
  if (designW > 560) designW = 560;      // 超宽屏别把内容拉太长，居中留边

  stage.style.width = designW + 'px';
  stage.style.height = designH + 'px';

  const offX = (vw - designW * k) / 2;   // 水平居中
  const supportsZoom = typeof CSS !== 'undefined' && CSS.supports && CSS.supports('zoom', '1');

  if (supportsZoom) {
    stage.style.transform = '';
    stage.style.zoom = String(k);
    stage.style.marginLeft = (offX / k) + 'px';
  } else {
    // 退路：老 Firefox 之类不支持 zoom 的，用 transform（不重排版，但至少铺满）
    stage.style.zoom = '';
    stage.style.marginLeft = '0px';
    stage.style.transform = `translate(${offX}px, 0) scale(${k})`;
  }

  // 不参与缩放的那几层（飘字/气泡/提示条）按 --k 放大字号
  document.documentElement.style.setProperty('--k', String(k));
  return k;
}

/* ============ 特效层 ============ */
export function fxFloat(target, text, cls = '') {
  const layer = document.getElementById('fx-layer');
  if (!layer || !target) return;
  const r = target.getBoundingClientRect();
  const n = el('div', { class: 'fx-float ' + cls, html: text });
  n.style.left = (r.left + r.width / 2) + 'px';
  n.style.top = (r.top + r.height * 0.32) + 'px';
  layer.append(n);
  setTimeout(() => n.remove(), 1000);
}

export function shake(node, cls = 'shake') {
  if (!node) return;
  node.classList.remove(cls);
  void node.offsetWidth;
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), 400);
}

export function toast(msg, ms = 1600) {
  const w = document.getElementById('toast-wrap');
  const n = el('div', { class: 'toast', html: msg });
  w.append(n);
  requestAnimationFrame(() => n.classList.add('in'));
  setTimeout(() => { n.classList.remove('in'); setTimeout(() => n.remove(), 300); }, ms);
}

/* ============ 场景级监听器 ============ */
/**
 * 在场景节点上注册监听器，切场景时由路由统一摘掉。
 *
 * 为什么需要：场景节点会被 clear(#app) 丢掉，但挂在 window/document 上的监听器不会。
 * 每进一次战斗就多 4 个（beforeunload / visibilitychange / pagehide / resize），
 * 每进一次地图多 1 个；这些闭包攥着旧的 Battle、G 和整棵 DOM 树，
 * 而旧的 resize 回调还会继续对**已经脱离文档**的节点跑 layoutHand()。
 * 之前全仓没有一处 removeEventListener，所以这是按"每进一次战斗/地图"累加的泄漏。
 *
 * 用法：onScene(root, window, 'resize', fn)
 */
const sceneListeners = new WeakMap();

export function onScene(node, target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  let set = sceneListeners.get(node);
  if (!set) { set = []; sceneListeners.set(node, set); }
  set.push(() => target.removeEventListener(type, fn, opts));
  return fn;
}

/** 注册「切场景时要执行的收尾动作」，和 onScene 共用同一批、按注册逆序执行。
    给挂在 body / #stage 上的东西用 —— 它们**不会**随 clear(#app) 一起消失，
    典型例子是长按/点击气泡（.tip 挂 body），切场景后不收拾就会留在屏幕上。 */
export function onSceneCleanup(node, fn) {
  let set = sceneListeners.get(node);
  if (!set) { set = []; sceneListeners.set(node, set); }
  set.push(fn);
  return fn;
}

/** 摘掉该场景注册过的全部监听器并执行收尾动作（路由在拆 DOM 之前调用） */
export function disposeScene(node) {
  if (!node) return 0;
  const set = sceneListeners.get(node);
  if (!set) return 0;
  sceneListeners.delete(node);
  let n = 0;
  // 逆序：后注册的先收尾（先挂的东西最后拆）
  for (let i = set.length - 1; i >= 0; i--) {
    try { set[i](); n++; } catch { /* 单个失败不影响其它 */ }
  }
  return n;
}

/* ============ 杂项 ============ */
/**
 * 资源路径解析。
 * 正常跑：原样返回相对路径。
 * 单文件打包版：构建脚本注入 globalThis.__ASSET_MAP__（路径 -> data URI），
 * 命中就返回内联数据 —— 所以业务代码不必为打包改任何东西。
 */
export function asset(p) {
  const m = globalThis.__ASSET_MAP__;
  return (m && m[p]) || p;
}

export const romanNum = n => ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][n] || n;
export const pad2 = n => String(n).padStart(2, '0');

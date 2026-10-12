/* 深渊牌局 · Service Worker
   游戏是纯静态的，所以策略很简单：优先用缓存，缓存没有再走网络并顺便存下来。
   首次访问后即可完全离线游玩。 */
/* ⚠️ 这一行由 `npm run build` 自动盖戳，**不要手改**。
   浏览器只在 sw.js 字节变化时才重新安装 SW，安装才会重新预缓存；
   版本号不变，老用户就会一直跑旧代码（第一次打开拿到的是上一版）。
   构建脚本按内容算哈希写进这里，详见 tools/build.mjs 的 stampServiceWorkerVersion()。 */
const VERSION = 'abyss-0812ba6c421f';

/* 预缓存清单由 tools/build.mjs 生成（precache.json）。
   必须预缓存而不是"用到才存"：精灵图和音效都是懒加载的，
   只靠运行时缓存的话，玩家装完第一次断网打开会是一片没图的空壳。 */
async function precache(c) {
  let list = ['./', './index.html', './css/style.css', './manifest.webmanifest'];
  try {
    const r = await fetch('./precache.json', { cache: 'no-store' });
    if (r.ok) list = await r.json();
  } catch { /* 拿不到清单就退回最小集合，至少主界面能开 */ }
  await Promise.allSettled(list.map(u => c.add(new Request(u, { cache: 'reload' }))));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await precache(c);         // 单个文件失败不影响整体安装
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    // 判断这是「更新」还是「首次安装」：更新前一定存在别的版本的缓存。
    // 必须在这里、删之前算，删完就分辨不出来了。
    const isUpdate = keys.some(k => k !== VERSION);
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();

    // 更新时：主动让所有受控页面重新加载。
    //
    // 为什么要在 SW 侧做，而不是只靠页面里的 controllerchange 监听：
    // 本补丁发布之前，用户缓存里的 index.html **没有那个监听**，
    // 光靠页面自己永远不会刷新 —— 他们会一直跑旧代码，
    // 而我们没法回头去改已经缓存在他们机器上的那个 HTML。
    // 从 SW 侧推一把，连旧页面也能救回来。
    // 首次安装时不做（那时没有旧缓存，也没必要多刷一次）。
    if (isUpdate) {
      const cs = await self.clients.matchAll({ type: 'window' });
      for (const c of cs) { try { await c.navigate(c.url); } catch { /* 个别客户端不允许就直接跳过 */ } }
    }
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;      // 只管自己的资源

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) {
      // 后台顺手更新，下次打开就是新的
      fetch(req).then(res => { if (res && res.ok) cache.put(req, res.clone()); }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (err) {
      // 离线且没缓存：导航请求兜底回 index.html
      if (req.mode === 'navigate') {
        const shell = await cache.match('./index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});

// 允许页面主动触发更新
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

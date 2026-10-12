/* 深渊牌局 · Service Worker
   游戏是纯静态的，所以策略很简单：优先用缓存，缓存没有再走网络并顺便存下来。
   首次访问后即可完全离线游玩。 */
/* ⚠️ 这一行由 `npm run build` 自动盖戳，**不要手改**。
   浏览器只在 sw.js 字节变化时才重新安装 SW，安装才会重新预缓存；
   版本号不变，老用户就会一直跑旧代码（第一次打开拿到的是上一版）。
   构建脚本按内容算哈希写进这里，详见 tools/build.mjs 的 stampServiceWorkerVersion()。 */
const VERSION = 'abyss-d9cb942e2373';

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
    // 删掉旧版本的缓存，只留当前的；激活后立刻接管已打开的页面。
    //
    // ⚠️ 这里**不要**做 clients.navigate() 去"推"页面重载。
    // 我试过（本意是连旧版 index.html 也一起救回来），结果**页面直接卡死**：
    // 在 activate 里对受控客户端调用 navigate()，等的大概是这次导航自身的完成，
    // 于是 SW 卡在那个 await 上，页面的请求全被挂住。已线上复现并回退。
    // 页面重载交给 index.html 里的 controllerchange 监听（标准做法，见那边的注释）。
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
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

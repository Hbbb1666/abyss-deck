/* 深渊牌局 · Service Worker
   游戏是纯静态的，所以策略很简单：优先用缓存，缓存没有再走网络并顺便存下来。
   首次访问后即可完全离线游玩。改动代码后把 VERSION 加一就会自动更新。 */
const VERSION = 'abyss-v1';

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

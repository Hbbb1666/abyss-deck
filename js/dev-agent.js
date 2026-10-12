/**
 * 开发用远程代理（只在带 ?agent=1 时启动）
 * ---------------------------------------------------------------
 * 两种用法（都只在本地调试服务器上有效，单文件导出产物里会移除本文件）：
 *
 *  1) ?agent=1
 *      挂上状态快照 + 轮询领命令（页面在前台时可用）
 *
 *  2) ?agent=1&tag=标签&steps=<base64(JSON [{js,wait}, ...])>
 *      页面加载后按顺序执行脚本，每步都带回 {out, snap}，最后一次性回报。
 *      这是主用方式：手机浏览器切后台会冻结定时器，但随页面加载执行的脚本一定跑得到。
 */
(() => {
  const q = new URLSearchParams(location.search);
  if (!q.has('agent')) return;

  const ID = Math.random().toString(36).slice(2, 8);
  const post = (path, body) => fetch(path, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});

  const errors = [];
  addEventListener('error', e => errors.push(String(e.message).slice(0, 300)));
  addEventListener('unhandledrejection', e => errors.push('reject: ' + String(e.reason?.message || e.reason).slice(0, 300)));

  function snapshot() {
    const d = document, A = window.__ABYSS__, G = A?.G;
    return {
      id: ID,
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      dpr: devicePixelRatio,
      ua: navigator.userAgent.slice(0, 160),
      scenes: [...d.querySelectorAll('.screen')].map(s => s.className),
      modal: !!d.querySelector('.modal-bg'),
      modalText: (d.querySelector('.modal')?.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
      bodyText: (d.body.innerText || '').replace(/\s+/g, ' ').slice(0, 900),
      counts: {
        mnode: d.querySelectorAll('.mnode').length,
        avail: d.querySelectorAll('.mnode.avail').length,
        enemy: d.querySelectorAll('.enemy').length,
        hand: d.querySelectorAll('.hand .card').length,
        relic: d.querySelectorAll('.relic').length,
        intent: d.querySelectorAll('.intent').length,
        btn: d.querySelectorAll('.btn').length,
        card: d.querySelectorAll('.card').length,
      },
      intents: [...d.querySelectorAll('.intent')].map(e => e.innerText.trim()),
      hand: [...d.querySelectorAll('.hand .card .cname')].map(e => e.innerText.trim()),
      hp: d.querySelector('.topbar .hpbar .txt')?.textContent,
      gold: d.querySelector('.topbar .gold')?.textContent,
      fontOK: d.fonts ? d.fonts.check('16px FusionPixel') : null,
      cssW: getComputedStyle(d.getElementById('app')).width,
      errors: errors.slice(-10),
    };
  }
  window.__snapshot__ = snapshot;

  /* ---------- 模式 2：随加载执行脚本 ---------- */
  const stepsB64 = q.get('steps');
  if (stepsB64) {
    let steps = [];
    try {
      steps = JSON.parse(decodeURIComponent(escape(atob(stepsB64.replace(/-/g, '+').replace(/_/g, '/')))));
    } catch (e) { post('/__report', { id: ID, tag: q.get('tag') || '?', fatal: 'steps 解析失败: ' + e.message }); return; }

    (async () => {
      // 等游戏自身初始化完
      for (let i = 0; i < 40 && !window.__ABYSS__; i++) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 400));
      const results = [];
      for (const st of steps) {
        const rec = { js: String(st.js).slice(0, 200) };
        try {
          rec.out = await new Function('A', 'snapshot', 'return (async()=>{ ' + st.js + ' })()')(window.__ABYSS__, snapshot);
          if (typeof rec.out === 'object' && rec.out !== null) rec.out = JSON.parse(JSON.stringify(rec.out));
        } catch (e) { rec.out = 'ERR: ' + e.message; }
        await new Promise(r => setTimeout(r, st.wait ?? 500));
        rec.snap = snapshot();
        results.push(rec);
      }
      await post('/__report', { id: ID, tag: q.get('tag') || 'script', steps: results });
    })();
    return;
  }

  /* ---------- 模式 1：轮询领命令 ---------- */
  let busy = false;
  async function tick() {
    if (busy) return;
    busy = true;
    try {
      const j = await (await fetch('/__cmd?id=' + ID, { cache: 'no-store' })).json();
      if (j && j.cmd != null) {
        let out;
        try { out = await new Function('A', 'snapshot', 'return (async()=>{ ' + j.cmd + ' })()')(window.__ABYSS__, snapshot); }
        catch (e) { out = 'ERR: ' + e.message; }
        await new Promise(r => setTimeout(r, j.wait || 300));
        await post('/__report', { id: ID, cmd: j.cmd, out: typeof out === 'object' ? out : String(out), snap: snapshot() });
      }
    } catch {}
    busy = false;
  }
  setInterval(tick, 800);
  setTimeout(tick, 600);
  post('/__report', { id: ID, cmd: '(connected)', out: 'agent online', snap: snapshot() });
})();

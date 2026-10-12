import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8765);
const MIME = { '.html':'text/html;charset=utf-8', '.js':'text/javascript;charset=utf-8',
  '.css':'text/css;charset=utf-8', '.json':'application/json;charset=utf-8',
  '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.ogg':'audio/ogg', '.mp3':'audio/mpeg', '.wav':'audio/wav',
  '.woff2':'font/woff2', '.ttf':'font/ttf', '.ico':'image/x-icon', '.webmanifest':'application/manifest+json' };

const LOG = process.env.REQLOG !== '0';

/* ===== 开发用远程通道：手机上的页面连回来领命令、回报状态 ===== */
const queues = new Map();     // clientId -> [cmd...]
const reports = [];           // 最近回报
const R = { cmd: null, last: null };
createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  /* --- 领命令 --- */
  if (u.pathname === '/__cmd') {
    const id = u.searchParams.get('id') || '?';
    const q = queues.get(id) || [];
    const cmd = q.length ? q.shift() : null;
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    return res.end(JSON.stringify({ cmd }));
  }
  /* --- 收回报 / 收命令 --- */
  if (u.pathname === '/__report' || u.pathname === '/__cmd') {
    let body = '';
    for await (const ch of req) body += ch;
    let j = {}; try { j = JSON.parse(body || '{}'); } catch {}
    if (u.pathname === '/__report') {
      reports.push(j);
      if (reports.length > 60) reports.shift();
      console.log('[REPORT] ' + JSON.stringify(j).slice(0, 4000));
    } else {
      const q = queues.get(j.id) || []; q.push(j.cmd); queues.set(j.id, q);
      console.log('[CMD->' + j.id + '] ' + String(j.cmd).slice(0, 300));
    }
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end('{"ok":true}');
  }
  /* --- 给运维/我自己看：最近回报 --- */
  if (u.pathname === '/__reports') {
    res.writeHead(200, {'Content-Type':'application/json'});
    return res.end(JSON.stringify(reports.slice(-10), null, 1));
  }
  try {
    if (LOG) console.log(`[REQ] ${new Date().toISOString().slice(11,19)} ${req.method} ${req.url} ua=${(req.headers['user-agent']||'').slice(0,60)}`);
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(403).end('dir'); return; }
    let body = await readFile(file);
    // DEV AGENT INJECT：本地开发时动态挂上调试代理；线上产物里不含它
    if (file.endsWith('index.html')) {
      body = Buffer.from(String(body).replace('</body>',
        '<script type="module" src="js/dev-agent.js"></script>\n</body>'), 'utf8');
    }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (e) {
    res.writeHead(404, {'Content-Type':'text/plain;charset=utf-8'}).end('404 ' + e.code);
  }
}).listen(PORT, '0.0.0.0', () => console.log(`serving ${ROOT} on http://0.0.0.0:${PORT}`));

#!/usr/bin/env node
/**
 * 构建脚本
 *   node tools/build.mjs             → 只打包 JS 到 dist/bundle.js（开发/测试用）
 *   node tools/build.mjs --single    → 额外产出 dist/abyss-deck.html（单文件，素材全内联）
 *
 * 依赖 rollup（纯 JS，无原生依赖）。未安装时会给出提示。
 */
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, extname, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SINGLE = process.argv.includes('--single');

/* ---------- 找到 rollup ---------- */
async function loadRollup() {
  const cands = [
    'rollup',
    '/root/abyss-test/node_modules/rollup/dist/es/rollup.js',
  ];
  for (const c of cands) {
    try {
      const spec = c.startsWith('/') ? pathToFileURL(c).href : c;
      return await import(spec);
    } catch { /* 试下一个 */ }
  }
  console.error('❌ 找不到 rollup。请先安装：  npm i -D rollup');
  process.exit(1);
}

/* ---------- 打包 JS ---------- */
async function bundleJS() {
  const { rollup } = await loadRollup();
  const b = await rollup({
    input: join(ROOT, 'js/main.js'),
    onwarn(w, warn) { if (w.code !== 'CIRCULAR_DEPENDENCY') warn(w); },
  });
  const { output } = await b.generate({ format: 'iife', name: 'AbyssDeck', sourcemap: false });
  await b.close();
  const code = output[0].code;
  await mkdir(join(ROOT, 'dist'), { recursive: true });
  await writeFile(join(ROOT, 'dist/bundle.js'), code);
  return code;
}

/* ---------- 素材内联成 data URI ---------- */
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};
const b64 = buf => buf.toString('base64');
const dataURI = (buf, mime) => `data:${mime};base64,${b64(buf)}`;

/** 递归收集文件（相对 ROOT 的路径）。
    ⚠️ 顺序取决于 `readdir`，而它是**文件系统相关**的：
    NTFS 大致按名字、ext4 是哈希序 —— 同一份代码在 Windows 和 Linux 上会得到**不同的顺序**。
    所以任何会写进产物或参与哈希的地方，都必须再显式排一次序（见 sortedWalk）。 */
async function walk(dir, base = ROOT, out = []) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, base, out);
    else out.push(relative(base, p).split('\\').join('/'));
  }
  return out;
}

/** 与 walk 相同，但用**码位序**排好，保证跨机器/跨平台字节一致。
    JS 的默认 sort 就是码位序（不依赖 locale），正是我们要的确定性。 */
async function sortedWalk(dir, base = ROOT) {
  return (await walk(dir, base)).slice().sort();
}

// 图标不需要进 JS 资源表：它们由 HTML 的 <link> 和 manifest 引用，
// 塞进来会被 base64 两次，白白多几百 KB。
const SKIP_IN_JS_MAP = /^assets\/icons\//;

async function buildAssetMap() {
  const files = (await sortedWalk(join(ROOT, 'assets'))).filter(f => !SKIP_IN_JS_MAP.test(f));
  const map = {};
  let total = 0;
  for (const rel of files) {
    const mime = MIME[extname(rel).toLowerCase()];
    if (!mime) continue;
    const buf = await readFile(join(ROOT, rel));
    total += buf.length;
    map[rel] = dataURI(buf, mime);
  }
  return { map, total };
}

/* ---------- 内联 CSS ---------- */
async function buildCSS(map) {
  let css = await readFile(join(ROOT, 'css/style.css'), 'utf8');
  const refs = [...css.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map(m => m[1]);
  for (const ref of new Set(refs)) {
    const clean = ref.replace(/^\.\.\//, '');
    if (map[clean]) css = css.split(ref).join(map[clean]);
  }
  return css;
}

/* ---------- 单文件版：把 PWA 相关的 link 也内联掉 ---------- */
async function inlinePwaLinks(html, map) {
  const b64 = buf => buf.toString('base64');
  const readData = async rel => {
    const buf = await readFile(join(ROOT, rel));
    const mime = MIME[extname(rel).toLowerCase()] || 'application/octet-stream';
    return `data:${mime};base64,${b64(buf)}`;
  };
  // manifest 里的图标路径也换成 data URI（Chrome 支持 manifest 内联 data URI）
  let mf = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  // 单文件版只内联一个 192 图标就够了（512 和 maskable 是给应用商店/安装框用的，
  // 全塞进来会让文件白白大一圈），其余字段原样保留
  const keep = mf.icons.find(i => i.sizes === '192x192' && i.purpose === 'any') || mf.icons[0];
  keep.src = await readData(keep.src.replace(/^\.\//, ''));
  mf.icons = [keep];
  mf.shortcuts = undefined;
  const mfData = 'data:application/manifest+json;base64,' + b64(Buffer.from(JSON.stringify(mf), 'utf8'));

  html = html.replace(/<link rel="manifest"[^>]*>/, `<link rel="manifest" href="${mfData}">`);
  // 图标、apple-touch-icon 换成内联
  // 只内联真正会被用到的：iOS 主屏用 apple-touch-icon，安卓快捷方式用 favicon。
  // 16/32 的小图标在单文件里意义不大，内联了纯属浪费体积。
  const WANT = /apple-touch-icon\.png$|favicon\.png$/;
  const links = [...html.matchAll(/<link[^>]+rel="(apple-touch-icon|icon)"[^>]*>/g)];
  for (const m of links) {
    const tag = m[0];
    const href = /href="([^"]+)"/.exec(tag)?.[1];
    if (!href || href.startsWith('data:')) continue;
    if (!WANT.test(href)) { html = html.split(tag).join(''); continue; }   // 用不上的直接删掉
    try {
      const data = await readData(href);
      html = html.split(tag).join(tag.replace(href, data));
    } catch { /* 文件不在就保持原样 */ }
  }
  return html;
}

/* ---------- 产单文件 ---------- */
async function buildSingle(jsCode) {
  const { map, total } = await buildAssetMap();
  const css = await buildCSS(map);
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  // 单文件产物里不要开发代理
  html = html.replace(/<script[^>]*dev-agent[^>]*><\/script>\s*/g, '');
  html = await inlinePwaLinks(html, map);
  html = html.replace(/<link rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`);
  html = html.replace(/<script type="module"[^>]*><\/script>/,
    `<script>window.__ASSET_MAP__ = ${JSON.stringify(map)};</script>\n<script>\n${jsCode}\n</script>`);

  const out = join(ROOT, 'dist/abyss-deck.html');
  await writeFile(out, html);
  const size = (await stat(out)).size;
  return { out, size, assetBytes: total, assets: Object.keys(map).length };
}

/* ---------- 生成 Service Worker 的预缓存清单 ---------- */
// 只发布仓库里真正会被浏览器请求的东西。几个必须排除的：
//   node_modules/ —— 装了依赖后 walk() 会把里面上千个文件全扫进来，
//                    它们既不在发布产物里（rsync 排除），也不该被预缓存，
//                    否则每个访客首开都要白跑一千多个 404。
//   .git/         —— 同上。walk() 不读 .gitignore，只能在这里挡。
//   package-lock.json —— 36 KB 的依赖锁，浏览器用不到。
//   .github/ tools/ dist/ server.mjs start.sh 等 —— 不发布／非运行期资源。
const PRECACHE_SKIP_DIRS = /^(node_modules|\.git|\.github|\.vscode|\.idea|tools|dist|_site)\//;
const PRECACHE_SKIP_FILES = new Set(['package.json', 'package-lock.json', 'precache.json', 'sw.js', 'server.mjs', 'start.sh']);

/** 只在本地开发用、**不进线上产物**的文件。
    它们必须同时满足两件事，否则线上会请求到 404：
      · `.github/workflows/deploy.yml` 的 rsync 要把它们排除出站点
      · 这里要把它们排除出预缓存清单
    目前只有真机调试代理一个（手机端审计时发现它被误发到线上）。
    tools/test.mjs 的 H 段会校验这三个地方保持一致。 */
const PRECACHE_SKIP_DEV_ONLY = new Set(['js/dev-agent.js']);

async function buildPrecache() {
  // sortedWalk：见 walk() 的说明 —— 必须用确定顺序，否则 precache.json 的字节
  // 会随文件系统变化，进而让 sw.js 的版本哈希在 Windows/Linux 上不一致
  // （实测：线上 Linux 产出把 grave_cross.png 排在 gravestone.png 前，NTFS 反之）。
  const files = (await sortedWalk(ROOT))
    .filter(f => !PRECACHE_SKIP_DIRS.test(f))
    .filter(f => !PRECACHE_SKIP_FILES.has(f))
    .filter(f => !PRECACHE_SKIP_DEV_ONLY.has(f))
    .filter(f => !f.endsWith('.md'))
    .filter(f => /\.(html|css|js|json|webmanifest|png|jpg|svg|ogg|mp3|wav|woff2?|ttf)$/.test(f));
  const list = ['./', ...files.map(f => './' + f)];
  await writeFile(join(ROOT, 'precache.json'), JSON.stringify(list, null, 0));
  return list.length;
}

/* ---------- 给 Service Worker 盖上版本戳 ----------
   sw.js 里的 VERSION 决定缓存名，也决定浏览器会不会重新安装这个 SW。
   它的**字节必须随内容变化** —— 否则发版后老用户永远在跑旧代码：
     · 浏览器只在 sw.js 字节变化时才重新 install，install 才会重新预缓存
     · activate 只删「缓存名 != VERSION」的旧缓存，版本不变就永远不清理
   手工维护版本号必然被忘记（README 原先就写着"改动代码后把 VERSION 加一"），
   所以这里按内容算哈希自动盖戳。幂等：内容没变就不会改写 sw.js。

   ⚠️ 2026-10-12 修了一个**严重的漏哈希**：原先只哈希
      precache.json + index.html + css + dist/bundle.js + sw.js 自身，
      而 **precache.json 里只有「文件名列表」，没有任何内容哈希** —— 于是
      **只改素材内容（不改文件名）时 VERSION 不变** →
      浏览器认为 SW 没更新 → 永不重新 install / 预缓存 →
      **用户拿到的永远是旧贴图**。
      实测就是它：我把 Boss 立绘从 308B 重画成 128B 并部署上线，
      线上 PNG 确实换了，但 `sw.js` 的 VERSION 仍是旧的，
      浏览器里看到的还是那三张灰色石面具（"改了好像没变化"）。
      现在把**每一个预缓存资源的内容**都纳入哈希，这类"只换内容"的部署必然触发更新。 */
async function stampServiceWorkerVersion() {
  const swPath = join(ROOT, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  const cur = /const VERSION = '([^']*)'/.exec(sw)?.[1];

  const h = createHash('sha1');
  // ① 所有预缓存资源的**内容**（这是覆盖面最广的一层：素材、js、css、字体、音频都在里面）
  let precacheList = [];
  try {
    precacheList = JSON.parse(await readFile(join(ROOT, 'precache.json'), 'utf8'));
  } catch { /* 没有清单就退回到下面那几项 */ }
  const files = new Set();
  for (const u of precacheList) {
    const rel = String(u).replace(/^\.\//, '');
    if (rel) files.add(rel);
  }
  // ② 清单本身 + 发布产物（单文件版、bundle）也参与，防止清单生成逻辑变化而内容未变
  for (const f of ['precache.json', 'index.html', 'css/style.css', 'manifest.webmanifest', 'dist/bundle.js']) files.add(f);
  // 排序后再哈希，让结果与文件系统枚举顺序无关（precache.json 已按码位序，这里再兜一次）
  for (const f of [...files].sort()) {
    h.update(f);                                  // 文件名也进哈希（新增/删除要变）
    try { h.update(await readFile(join(ROOT, f))); } catch { /* 清单里有但磁盘没有，跳过 */ }
  }
  // ③ sw.js **自身**也要参与（把 VERSION 那一行剔掉，否则自指、永远在变）。
  //    不加的话有个坑：只改 SW 逻辑（比如这次回退掉 navigate）时 VERSION 不变，
  //    浏览器认为 SW 没更新、不会重新 install —— 修复推不下去。
  //    实测踩到了：回退 navigate 之后线上 sw.js 变了，但 VERSION 还是旧的。
  h.update(sw.replace(/const VERSION = '[^']*'/, ''));

  const ver = 'abyss-' + h.digest('hex').slice(0, 12);
  if (cur === ver) return { changed: false, to: ver, from: cur, files: files.size };
  await writeFile(swPath, sw.replace(/const VERSION = '[^']*'/, `const VERSION = '${ver}'`));
  return { changed: true, from: cur, to: ver, files: files.size };
}

/* ---------- 跑 ---------- */
const code = await bundleJS();
console.log(`✅ JS 打包完成  dist/bundle.js  (${(code.length / 1024).toFixed(0)} KB)`);

const nPre = await buildPrecache();
console.log(`✅ 预缓存清单  precache.json  (${nPre} 个资源)`);

const sw = await stampServiceWorkerVersion();
console.log(sw.changed
  ? `✅ Service Worker 版本 stamped  ${sw.from} → ${sw.to}`
  : `✅ Service Worker 版本未变  ${sw.to}`);

if (SINGLE) {
  const r = await buildSingle(code);
  console.log(`✅ 单文件产出  dist/abyss-deck.html`);
  console.log(`   内联素材 ${r.assets} 个（原始 ${(r.assetBytes / 1024).toFixed(0)} KB）`);
  console.log(`   最终体积 ${(r.size / 1024 / 1024).toFixed(2)} MB`);
}

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

async function walk(dir, base = ROOT, out = []) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    const st = await stat(p);
    if (st.isDirectory()) await walk(p, base, out);
    else out.push(relative(base, p));
  }
  return out;
}

// 图标不需要进 JS 资源表：它们由 HTML 的 <link> 和 manifest 引用，
// 塞进来会被 base64 两次，白白多几百 KB。
const SKIP_IN_JS_MAP = /^assets\/icons\//;

async function buildAssetMap() {
  const files = (await walk(join(ROOT, 'assets'))).filter(f => !SKIP_IN_JS_MAP.test(f.split('\\').join('/')));
  const map = {};
  let total = 0;
  for (const rel of files) {
    const mime = MIME[extname(rel).toLowerCase()];
    if (!mime) continue;
    const buf = await readFile(join(ROOT, rel));
    total += buf.length;
    map[rel.split('\\').join('/')] = dataURI(buf, mime);
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
async function buildPrecache() {
  const files = (await walk(ROOT))
    .map(f => f.split('\\').join('/'))
    .filter(f => !f.startsWith('dist/') && !f.startsWith('tools/') && !f.startsWith('_')
                 && !f.endsWith('.md') && f !== 'package.json' && f !== 'precache.json'
                 && f !== 'sw.js' && f !== 'server.mjs' && f !== 'start.sh')
    .filter(f => /\.(html|css|js|json|webmanifest|png|jpg|svg|ogg|mp3|wav|woff2?|ttf)$/.test(f));
  const list = ['./', ...files.map(f => './' + f)];
  await writeFile(join(ROOT, 'precache.json'), JSON.stringify(list, null, 0));
  return list.length;
}

/* ---------- 跑 ---------- */
const code = await bundleJS();
console.log(`✅ JS 打包完成  dist/bundle.js  (${(code.length / 1024).toFixed(0)} KB)`);

const nPre = await buildPrecache();
console.log(`✅ 预缓存清单  precache.json  (${nPre} 个资源)`);

if (SINGLE) {
  const r = await buildSingle(code);
  console.log(`✅ 单文件产出  dist/abyss-deck.html`);
  console.log(`   内联素材 ${r.assets} 个（原始 ${(r.assetBytes / 1024).toFixed(0)} KB）`);
  console.log(`   最终体积 ${(r.size / 1024 / 1024).toFixed(2)} MB`);
}

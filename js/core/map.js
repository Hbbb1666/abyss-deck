/**
 * 地图生成：分层节点图
 *   行 0..ROWS-1 为普通层，最后一行是 Boss
 *   从下往上走，每步只能连到相邻列的节点
 */
import { makeRng } from './util.js';

export const MAP_COLS = 4;
export const MAP_ROWS = 15;      // 含 Boss 行
export const PATHS = 6;

export const NODE_TYPES = {
  battle: { label: '战斗', icon: 'bars', color: '#e05a4a' },
  elite: { label: '精英', icon: 'boss_demon', color: '#ff3b6b' },
  event: { label: '事件', icon: 'gargoyle', color: '#c07bff' },
  shop: { label: '商店', icon: 'anvil', color: '#ffcc52' },
  rest: { label: '营火', icon: 'torch', color: '#ff9a3c' },
  treasure: { label: '宝箱', icon: 'chest_gold', color: '#6ee7a8' },
  boss: { label: 'Boss', icon: 'gate', color: '#ff2d55' },
  start: { label: '起点', icon: 'portal', color: '#8fa8c0' },
};

export function generateMap(seed, act = 1) {
  const rng = makeRng(seed);
  const grid = new Map();          // key `r,c` -> node
  const key = (r, c) => `${r},${c}`;
  const nodeAt = (r, c) => grid.get(key(r, c));

  /* Boss **独占**最后一行：路径游走和补漏都不许在这一行产生节点。
     为什么必须这样 —— 最后一行之后没有行了，落在这一行的普通节点没有任何后继，
     玩家一旦走进去就再也出不来，整局进度卡死（实测 300/300 张地图都有这个问题，
     最后一行累计多出 753 个普通节点，而且全是死路）。 */
  const BOSS_ROW = MAP_ROWS - 1;
  const TOP_ROW = MAP_ROWS - 2;

  const add = (r, c, type) => {
    const k = key(r, c);
    if (!grid.has(k)) grid.set(k, { r, c, type: type || null, next: [], prev: [] });
    const n = grid.get(k);
    if (type && !n.type) n.type = type;
    return n;
  };
  const link = (a, b) => {
    if (!a.next.some(x => x.r === b.r && x.c === b.c)) a.next.push({ r: b.r, c: b.c });
    if (!b.prev.some(x => x.r === a.r && x.c === a.c)) b.prev.push({ r: a.r, c: a.c });
  };

  /* ---- 1. 走出 PATHS 条路径（只走到倒数第二行） ---- */
  const starts = rng.shuffle([0, 1, 2, 3]).concat([rng.int(MAP_COLS), rng.int(MAP_COLS)]).slice(0, PATHS);
  for (const sc of starts) {
    let c = sc;
    let cur = add(0, c);
    for (let r = 1; r <= TOP_ROW; r++) {
      // 越靠上越容易收敛到中间，避免贴边
      const opts = [c - 1, c, c + 1].filter(x => x >= 0 && x < MAP_COLS);
      let nc = rng.pick(opts);
      if (nc === c && rng.chance(0.45)) nc = rng.pick(opts);
      c = nc;
      const nxt = add(r, c);
      link(cur, nxt);
      cur = nxt;
    }
  }

  /* ---- 2. 保证每行都有节点（补漏；同样不碰 Boss 行） ---- */
  for (let r = 1; r <= TOP_ROW; r++) {
    if (![...grid.values()].some(n => n.r === r)) {
      const c = rng.int(MAP_COLS);
      const n = add(r, c);
      const below = [...grid.values()].filter(x => x.r === r - 1);
      if (below.length) link(rng.pick(below), n);
    }
  }

  /* ---- 3. 分配房间类型 ---- */
  const rowsWith = r => [...grid.values()].filter(n => n.r === r).sort((a, b) => a.c - b.c);
  // 固定行
  for (const n of rowsWith(0)) n.type = 'battle';
  for (const n of rowsWith(TOP_ROW)) n.type = 'rest';
  for (const n of rowsWith(1)) n.type = 'battle';
  // 宝箱行
  for (const n of rowsWith(8)) if (rng.chance(0.7)) n.type = 'treasure';

  const weights = n => {
    const p = [];
    p.push(['battle', 46]);
    p.push(['event', 24]);
    if (n.r >= 4) p.push(['elite', n.r >= 10 ? 20 : 13]);
    if (n.r >= 4) p.push(['shop', 11]);
    if (n.r >= 5) p.push(['rest', 13]);
    if (n.r >= 6) p.push(['treasure', 5]);
    return p;
  };
  for (const n of grid.values()) {
    if (n.type || n.r === BOSS_ROW) continue;   // Boss 行留给第 5 步
    n.type = rng.weighted(weights(n));
  }

  /* ---- 4. 保底：至少 2 商店、3 营火、3 精英 ---- */
  const ensure = (type, min, minRow, maxRow) => {
    for (let guard = 0; guard < 60; guard++) {
      const list = [...grid.values()].filter(n => n.type === type);
      if (list.length >= min) return;
      const cands = [...grid.values()].filter(n => !n.type || (n.type === 'battle' && n.r >= minRow && n.r <= maxRow));
      const pick = cands.filter(n => n.r >= minRow && n.r <= (maxRow ?? TOP_ROW - 1));
      if (!pick.length) return;
      rng.pick(pick).type = type;
    }
  };
  ensure('shop', 2, 4, TOP_ROW - 1);
  ensure('rest', 3, 5, TOP_ROW);
  ensure('elite', 3, 4, TOP_ROW - 1);

  /* ---- 5. Boss 节点 ----
     注意两点：
     ① 这一格通常在第 3 步就已经被随机分配了类型，而 add() 只在「格子还没有类型」时
        才写类型，所以必须在这里无条件覆盖，否则 Boss 会变成一个普通房间 ——
        打完顶层也进不了下一层，整局卡死。
     ② 先把 Boss 行上的杂节点清掉（现在的游走不会产生它们；这行是给将来改动兜底），
        并把指向它们的边改接到 Boss，否则会留下走不出去的孤岛。 */
  for (const s of rowsWith(BOSS_ROW)) {
    for (const p of s.prev) {
      const pn = nodeAt(p.r, p.c);
      if (pn) pn.next = pn.next.filter(x => !(x.r === s.r && x.c === s.c));
    }
    grid.delete(key(s.r, s.c));
  }

  const boss = add(BOSS_ROW, rng.int(MAP_COLS), 'boss');
  boss.type = 'boss';
  boss.c = 1.5; // 居中显示
  for (const n of rowsWith(TOP_ROW)) link(n, boss);

  /* ---- 5.5 兜底：不留死路 ----
     任何**非 Boss** 节点都必须至少有一条出边，否则玩家走进去就卡死在那里。
     这条不变量以前没人守：地图测试只验了"从起点能走到 Boss"，
     而别的分支走进死角它是测不到的。 */
  const deadEnds = [];
  for (const n of grid.values()) {
    if (n.type === 'boss' || n.next.length) continue;
    const above = [...grid.values()].filter(x => x.r === n.r + 1).sort((a, b) => a.c - b.c);
    if (above.length) { link(n, rng.pick(above)); deadEnds.push(`${n.r},${n.c}`); }
    else { n.next.push({ r: boss.r, c: boss.c }); deadEnds.push(`${n.r},${n.c}->boss`); }
  }

  /* ---- 6. 起点 ---- */
  const row0 = rowsWith(0);
  const start = { r: -1, c: (row0.reduce((s, n) => s + n.c, 0) / row0.length), type: 'start', next: row0.map(n => ({ r: n.r, c: n.c })), prev: [] };
  for (const n of row0) n.prev.push({ r: -1, c: start.c });

  const nodes = [...grid.values()].sort((a, b) => a.r - b.r || a.c - b.c);
  const byRow = [];
  for (let r = 0; r < MAP_ROWS; r++) byRow.push(nodes.filter(n => n.r === r));

  return { act, nodes, byRow, start, boss, seed };
}

/** 根据当前所在节点，返回可前往的节点 */
export function reachable(map, cur) {
  if (!cur) return map.start.next.map(p => nodeAt(map, p.r, p.c)).filter(Boolean);
  const n = nodeAt(map, cur.r, cur.c);
  if (!n) return [];
  return n.next.map(p => nodeAt(map, p.r, p.c)).filter(Boolean);
}
export function nodeAt(map, r, c) { return map.nodes.find(n => n.r === r && n.c === c); }

/** 布局：返回每个节点的屏幕坐标（0..1 归一化，y 从下往上） */
export function layout(map) {
  const pos = new Map();
  const put = (r, c, x, y) => pos.set(`${r},${c}`, { x, y });
  put(-1, map.start.c, 0.5, 1);
  for (const n of map.nodes) {
    // 同一行内均分，行内节点数少的居中。
    // 注意：必须按 (r,c) 查找而不是 indexOf —— 存档经过 JSON.parse 之后，
    // map.nodes 与 map.byRow 里是两份不同的对象，用引用相等会一律找不到，
    // 算出来的 x 变成负数，整张地图就跑到屏幕外了。
    const row = (map.byRow[n.r] || []).slice().sort((a, b) => a.c - b.c);
    const i = row.findIndex(x => x.r === n.r && x.c === n.c);
    const spread = 0.86;
    const ii = i < 0 ? (row.length >> 1) : i;   // 兜底：实在找不到就放行中间
    const x = 0.07 + (row.length <= 1 ? spread / 2 : (ii / (row.length - 1)) * spread);
    const y = n.r === MAP_ROWS - 1 ? 0.02 : 0.94 - (n.r + 0.6) / MAP_ROWS * 0.86;
    put(n.r, n.c, Math.max(0.04, Math.min(0.96, x)), y);
  }
  return pos;
}

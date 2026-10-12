import { el, clear, sleep, toast, fxFloat } from '../core/util.js';
import { G, save, hasRelic } from '../core/state.js';
import { NODE_TYPES, reachable, nodeAt, layout, MAP_ROWS } from '../core/map.js';
import { sfx } from '../core/audio.js';
import { SPR, relicEl, bindTip, hpBar, modal } from './widgets.js';
import { showHelp, deckBody } from './scene-battle.js';

const key = n => `${n.r},${n.c}`;

export function mapScene({ onEnter }) {
  const root = el('div', { class: 'screen' });

  /* ---------- 顶栏 ---------- */
  const topbar = el('div', { class: 'topbar' });
  const hpWrap = el('div', { class: 'grow' });
  const bar = hpBar(G.hp, G.maxHp, 0);
  hpWrap.append(bar);
  const goldStat = el('div', { class: 'stat' }, el('span', { class: 'ico', style: { backgroundImage: `url(${SPR('key_gold')})` } }), el('span', { class: 'gold', text: G.gold }));
  const actStat = el('div', { class: 'stat', html: `<span class="dim">第</span>${G.act}<span class="dim">层</span>` });
  const btnDeck = el('button', { class: 'btn sm ghost', text: '卡组', onClick: showDeck });
  const btnHelp = el('button', { class: 'btn sm ghost', text: '?', onClick: showHelp });
  topbar.append(el('div', { class: 'avatar', style: { backgroundImage: `url(${SPR(classSprite())})` } }), hpWrap, goldStat, actStat, btnDeck, btnHelp);

  /* ---------- 遗物条 ---------- */
  const relicbar = el('div', { class: 'relicbar' });
  for (const id of G.relics) relicbar.append(relicEl(id));
  const potionBar = el('div', { class: 'relicbar', style: { gap: '6px' } });
  for (let i = 0; i < G.potionSlots; i++) {
    const p = G.potions[i];
    if (p) {
      const n = el('div', { class: 'relic', style: { backgroundImage: `url(${SPR(p.sprite)})`, width: '30px', height: '30px', borderColor: '#7ee78760' } });
      bindTip(n, () => `<div class="tname">${p.name}</div>${p.text}<br><span class="dim tiny">战斗中点击使用</span>`);
      n.addEventListener('click', () => usePotion(i));
      potionBar.append(n);
    } else {
      potionBar.append(el('div', { class: 'relic', style: { width: '30px', height: '30px', opacity: '.28' } }));
    }
  }

  /* ---------- 地图 ---------- */
  const wrap = el('div', { class: 'map-wrap' });
  const inner = el('div', { class: 'map-inner' });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'map-lines');
  svg.setAttribute('preserveAspectRatio', 'none');
  inner.append(svg);

  const map = G.map;
  const pos = layout(map);
  const avail = new Set(reachable(map, G.node).map(key));

  // 连线
  const drawLines = () => {
    const W = 1000, H = 1000;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    clear(svg);
    const line = (a, b, cls) => {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('x1', a.x * W); l.setAttribute('y1', a.y * H);
      l.setAttribute('x2', b.x * W); l.setAttribute('y2', b.y * H);
      l.setAttribute('stroke', cls);
      l.setAttribute('stroke-width', '3');
      l.setAttribute('stroke-dasharray', '7 6');
      l.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.append(l);
    };
    // 起点连线
    const sp = pos.get(`${-1},${map.start.c}`) || { x: 0.5, y: 1 };
    for (const n of map.byRow[0] || []) {
      const p = pos.get(key(n));
      if (p) line(sp, p, visited(n) ? '#ffcc5280' : '#ffffff22');
    }
    for (const n of map.nodes) {
      const a = pos.get(key(n)); if (!a) continue;
      for (const nx of n.next) {
        const b = pos.get(`${nx.r},${nx.c}`); if (!b) continue;
        line(a, b, (visited(n) && visited({ r: nx.r, c: nx.c })) ? '#ffcc5280' : '#ffffff22');
      }
    }
  };

  const visited = n => !!(G.visited && G.visited[key(n)]);
  const isCurrent = n => G.node && G.node.r === n.r && G.node.c === n.c;

  const renderNodes = () => {
    for (const n of map.nodes) {
      const p = pos.get(key(n));
      if (!p) continue;
      const t = NODE_TYPES[n.type] || NODE_TYPES.event;
      const cls = ['mnode', n.type];
      if (avail.has(key(n))) cls.push('avail');
      if (visited(n) || isCurrent(n)) cls.push('done');
      if (isCurrent(n)) cls.push('cur');
      const node = el('div', {
        class: cls.join(' '),
        style: { left: (p.x * 100) + '%', top: (p.y * 100) + '%' },
        data: { r: n.r, c: n.c },
      }, el('div', { class: 'ico', style: { backgroundImage: `url(${SPR(t.icon)})` } }));
      bindTip(node, () => `<div class="tname">${t.label}</div>${nodeHint(n)}`);
      node.addEventListener('click', () => enter(n));
      inner.append(node);
    }
    drawLines();
  };

  // 起点节点
  const sp = pos.get(`${-1},${map.start.c}`);
  if (sp) {
    const s = el('div', { class: 'mnode cur', style: { left: (sp.x * 100) + '%', top: (sp.y * 100) + '%' } },
      el('div', { class: 'ico', style: { backgroundImage: `url(${SPR('portal')})` } }));
    inner.append(s);
  }
  renderNodes();

  if (!avail.size && !G.node) toast('地图异常：无可用节点');
  wrap.append(inner);
  root.append(topbar, relicbar, potionBar, wrap);

  /* ---------- 自动滚到"接下来要走的位置" ---------- */
  // 定位目标不是当前所在节点，而是它上方那批可前往的节点 ——
  // 玩家关心的是"下一步能去哪"，所以把它们放到屏幕偏上的位置，
  // 上方留出余量，走到边界时也还有路可看。
  function scrollToFrontier(animate) {
    const innerH = inner.offsetHeight, wrapH = wrap.offsetHeight;
    if (!innerH || !wrapH) return;
    let y;
    const availNodes = [...avail].map(k => pos.get(k)).filter(Boolean);
    if (availNodes.length) {
      const ys = availNodes.map(p => p.y);
      y = (Math.min(...ys) + Math.max(...ys)) / 2;   // 可前往节点的中间高度
    } else {
      const cur = G.node ? pos.get(key(G.node)) : pos.get(`${-1},${map.start.c}`);
      y = cur ? cur.y : 1;
    }
    const target = y * innerH - wrapH * 0.42;        // 放在屏幕 42% 处，上方留出余量
    const max = innerH - wrapH;
    const top = Math.max(0, Math.min(max, target));
    if (animate && typeof wrap.scrollTo === 'function') wrap.scrollTo({ top, behavior: 'smooth' });
    else wrap.scrollTop = top;
  }

  // 布局尺寸可能要等一两帧才稳定，滚两次确保落点正确
  requestAnimationFrame(() => { scrollToFrontier(false); requestAnimationFrame(() => scrollToFrontier(false)); });
  addEventListener('resize', () => requestAnimationFrame(() => scrollToFrontier(false)));

  // 手动滑动到底/到顶时提示一下，避免以为是卡住了
  wrap.addEventListener('scroll', () => {
    const max = inner.offsetHeight - wrap.offsetHeight;
    if (max <= 4) return;
    const atTop = wrap.scrollTop <= 2;
    const atBottom = wrap.scrollTop >= max - 2;
    if (atTop || atBottom) wrap.dataset.edge = atTop ? 'top' : 'bottom';
    else delete wrap.dataset.edge;
  }, { passive: true });

  /* ---------- 交互 ---------- */
  function enter(n) {
    if (!avail.has(key(n))) {
      if (visited(n) || isCurrent(n)) toast('这里已经走过了');
      else toast('前方无路可通');
      sfx.error();
      return;
    }
    sfx.step();
    G.node = { r: n.r, c: n.c };
    G.visited = G.visited || {};
    G.visited[key(n)] = true;
    save();
    onEnter(n);
  }

  function usePotion(i) {
    toast('药水只能在战斗中使用');
    sfx.error();
  }

  function showDeck() {
    sfx.open();
    modal({ title: `当前卡组（${G.deck.length} 张）`, closable: true, body: deckBody(), buttons: [{ label: '关闭', cls: 'primary' }] });
  }

  return root;
}

function classSprite() { return { knight: 'hero_knight', mage: 'hero_mage', rogue: 'hero_rogue' }[G.cls] || 'hero_knight'; }

function nodeHint(n) {
  return {
    battle: '普通敌人。打赢能拿金币和卡牌奖励。',
    elite: '<b style="color:#ff6b8a">强力敌人</b>。血厚伤害高，但必定掉落遗物。',
    event: '随机事件。可能是好事，也可能是坏事。',
    shop: '用金币购买卡牌、遗物和药水。',
    rest: '营火：回复生命，或升级一张卡牌。',
    treasure: '免费开箱，直接拿遗物或金币。',
    boss: '<b style="color:#ff5c5c">本层首领</b>。击败后进入下一层。',
    start: '起点。',
  }[n.type] || '';
}

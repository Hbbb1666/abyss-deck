import { el, clear, $, $$, toast, asset, onSceneCleanup } from '../core/util.js';
import { RARITY, TYPE_LABEL, CARDS } from '../data/cards.js';
import { RELICS } from '../data/relics.js';
import { ST, stText } from '../core/battle.js';
import { sfx } from '../core/audio.js';

export const SPR = n => asset(`assets/sprites/${n}.png`);
/** 弹层要挂在 #stage 里，这样能跟着舞台一起缩放；拿不到就退回 body */
export const overlayRoot = () => document.getElementById('stage') || document.body;
export const UI = n => asset(`assets/ui/${n}.png`);

/* ---------------- 卡牌 ---------------- */
/** 卡牌大图弹窗（长按任意地方的卡都能看全效果） */
export function openCardPreview(card) {
  sfx.open();
  const body = el('div', { class: 'preview-wrap' },
    cardEl(card, { preview: false, extraClass: 'inspect' }));
  const foot = el('div', { style: { textAlign: 'center' } });
  modal({
    title: `${card.name}${card.upgraded ? ' +' : ''}　<span class="tiny dim">${TYPE_LABEL[card.type] || ''}</span>`,
    body, buttons: [{ label: '关闭', cls: 'primary' }], closable: true,
  });
}

/**
 * 描述太长会把卡面撑爆 —— 逐档缩字号直到放得下。
 * 需要在元素已经进入 DOM 之后调用（要能量出真实高度）。
 */
export function fitCardText(node) {
  const t = node.querySelector ? node.querySelector('.ctext') : null;
  if (!t) return;
  const base = 10.5, min = 8.5;
  t.style.fontSize = '';
  let fs = base;
  // 最多降 5 档，每档 0.5px
  for (let i = 0; i < 6; i++) {
    if (t.scrollHeight <= t.clientHeight + 1) break;
    fs = Math.max(min, fs - 0.5);
    t.style.fontSize = fs + 'px';
    if (fs <= min) break;
  }
}

/** 把一棵子树里的所有卡牌都做一次文字适配 */
export function fitAllCards(root = document) {
  root.querySelectorAll?.('.card').forEach(fitCardText);
}

export function cardEl(card, opts = {}) {
  const r = RARITY[card.rarity] || RARITY.common;
  const cls = [
    'card',
    'r-' + (card.rarity || 'common'),
    't-' + card.type,
    card.upgraded ? 'up' : '',
    card.unplayable ? 'unplayable' : '',
    opts.extraClass || '',
  ].filter(Boolean).join(' ');

  const costTxt = card.unplayable ? '—' : (card.cost === 0 ? '0' : card.cost);
  const costCls = card.unplayable ? '' : (card.cost === 0 ? 'free' : '');

  const node = el('div', {
    class: cls, data: { cid: card.uid || card.id },
  },
    el('div', { class: 'cost ' + costCls }, costTxt),
    el('div', { class: 'cname', text: card.name }),
    el('div', { class: 'cart', style: { backgroundImage: `url(${SPR(card.art)})` } }),
    // 注意：这里必须包一层 span。.ctext 是 flex 容器（用来垂直居中），
    // flex 容器会把行内内容块级化 —— 直接塞带 <b> 的 HTML 会被拆成
    // 「文字」「数字」「文字」好几段各占一行，卡片高度直接爆掉。
    el('div', { class: 'ctext' }, el('span', { class: 'ctext-in', html: card.text(card) })),
    el('div', { class: 'ctype', text: TYPE_LABEL[card.type] || '' }),
  );
  // 长按看大图 —— 统一在这里挂，各个场景（手牌/奖励/商店/卡组）都自动有
  if (opts.preview !== false) {
    let lastPreview = 0;
    onLongPress(node, () => { lastPreview = Date.now(); openCardPreview(card); }, 420);
    node.addEventListener('click', e => {
      if (Date.now() - lastPreview < 700) { e.stopPropagation(); return; }   // 刚弹过预览，忽略这次点击
      e.stopPropagation();
      opts.onClick?.(card, node);
    });
  } else if (opts.onClick) {
    node.addEventListener('click', e => { e.stopPropagation(); opts.onClick(card, node); });
  }
  return node;
}

/* ---------------- 血条 ---------------- */
export function hpBar(hp, maxHp, block = 0, cls = '') {
  const pct = Math.max(0, Math.min(100, hp / maxHp * 100));
  const bar = el('div', { class: 'hpbar ' + cls },
    el('div', { class: 'fill', style: { width: pct + '%' } }),
  );
  if (block > 0) {
    const b = el('div', { class: 'fill blk', style: { width: Math.min(100, block / maxHp * 100) + '%' } });
    bar.insertBefore(b, bar.firstChild);
  }
  bar.append(el('div', { class: 'txt', text: block > 0 ? `${hp}/${maxHp} ⛨${block}` : `${hp}/${maxHp}` }));
  return bar;
}

/** 只更新已有血条节点，避免整块重绘导致动画丢失 */
export function updateHpBar(bar, hp, maxHp, block = 0) {
  const pct = Math.max(0, Math.min(100, hp / maxHp * 100));
  const fills = bar.querySelectorAll('.fill');
  const red = fills[fills.length - 1];
  if (red) red.style.width = pct + '%';
  let blk = bar.querySelector('.fill.blk');
  if (block > 0) {
    if (!blk) { blk = el('div', { class: 'fill blk' }); bar.insertBefore(blk, bar.firstChild); }
    blk.style.width = Math.min(100, block / maxHp * 100) + '%';
  } else if (blk) blk.remove();
  bar.querySelector('.txt').textContent = block > 0 ? `${hp}/${maxHp} ⛨${block}` : `${hp}/${maxHp}`;
}

/* ---------------- 状态图标 ---------------- */
/**
 * 状态标签。直接把「名称 + 层数」写在标签上，不用记图标是啥；
 * 长按还能看到这个状态具体在干什么（文案来自 ST 表，加状态时只改一处）。
 */
export function statusRow(e) {
  const wrap = el('div', { class: 'sts' });
  for (const [k, v] of Object.entries(e.st || {})) {
    if (!v) continue;
    const d = ST[k];
    if (!d) continue;
    const chip = el('span', {
      class: 'st ' + (d.buff ? 'buff' : 'debuff'),
      style: { color: d.color },
      data: { stk: k },
    },
      el('span', { class: 'sti', text: d.icon }),
      el('span', { class: 'stn', text: d.name }),
      el('b', { class: 'stv', text: String(v) }),
    );
    bindTip(chip, () => `<div class="tname" style="color:${d.color}">${d.icon} ${d.name} ×${v}</div>${stText(k, v)}`);
    wrap.append(chip);
  }
  return wrap;
}

/* ---------------- 长按提示 ---------------- */
let tipNode = null;
export function showTip(anchor, html) {
  hideTip();
  const r = anchor.getBoundingClientRect();
  tipNode = el('div', { class: 'tip', html });
  document.body.append(tipNode);   // 气泡不缩放，用真实屏幕坐标
  const tr = tipNode.getBoundingClientRect();
  let left = r.left + r.width / 2 - tr.width / 2;
  left = Math.max(6, Math.min(innerWidth - tr.width - 6, left));
  let top = r.top - tr.height - 8;
  if (top < 6) top = r.bottom + 8;
  tipNode.style.left = left + 'px';
  tipNode.style.top = top + 'px';
}
export function hideTip() { if (tipNode) { tipNode.remove(); tipNode = null; } }

/** 给元素绑定长按显示提示（触屏友好） */
export function bindTip(node, htmlFn) {
  let timer = null;
  const start = () => { timer = setTimeout(() => showTip(node, htmlFn()), 420); };
  const end = () => { clearTimeout(timer); hideTip(); };
  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('touchend', end);
  node.addEventListener('touchcancel', end);
  node.addEventListener('mousedown', start);
  node.addEventListener('mouseup', end);
  node.addEventListener('mouseleave', end);
  return node;
}

let pressTimer = null;
/** 绑定「长按 → 回调」（用于按需弹提示，避免误触） */
export function onLongPress(node, fn, ms = 380) {
  const s = () => { pressTimer = setTimeout(() => { sfx.click(); fn(node); }, ms); };
  const e = () => clearTimeout(pressTimer);
  node.addEventListener('touchstart', s, { passive: true });
  node.addEventListener('touchend', e);
  node.addEventListener('touchmove', e);
  node.addEventListener('touchcancel', e);
  node.addEventListener('mousedown', s);
  node.addEventListener('mouseup', e);
  node.addEventListener('mouseleave', e);
  return node;
}

/* ---------------- 「点一下看说明，再点一下执行」 ---------------- */
let armedState = null;   // { node, onAction, timer } —— 当前已点开、等待第二次确认的那个

/** 收起当前气泡并解除待确认状态。
    注意：**即使 armedState 为空也要清定时器**（用独立的句柄）——
    否则前一次的超时回调会在 5 秒后回来，把**新开**的气泡关掉：
    玩家点开说明、还没看够就自己消失了。 */
let armTimer = null;
export function disarmTipAction() {
  if (armTimer) { clearTimeout(armTimer); armTimer = null; }
  if (armedState) {
    armedState.node?.classList.remove('armed');
    armedState = null;
  }
  hideTip();
}

/**
 * 两段式点击：**第一次点开说明，第二次点同一个才真的执行**。
 *
 * 为什么不用 dblclick：触屏上双击有判定延迟，还会和已有的长按气泡互相干扰；
 * 两段式在手机和桌面上行为完全一致，而且第一次点击本身就有反馈（说明当场看得见），
 * 玩家不会"点了一下什么都没发生"。
 *
 * 不传 onAction 时退化成「点一下看说明」（遗物、地图上的药水都是这种）。
 *
 * @param node      要绑定的元素
 * @param html      说明内容（字符串或返回字符串的函数）
 * @param onAction  第二次点击时执行；不传则只显示说明
 * @param hint      第二次点击前的提示文案
 * @param sceneNode 所属场景节点。传入后切场景会自动收起气泡 ——
 *                  气泡挂在 body 上，不会随 clear(#app) 一起消失。
 */
export function bindTipAction(node, { html, onAction, hint = '再点一次使用', sceneNode } = {}) {
  const render = () => {
    const body = typeof html === 'function' ? html() : (html || '');
    return onAction ? `${body}<br><span class="dim tiny">${hint}</span>` : body;
  };
  const arm = () => {
    disarmTipAction();                       // 同时只允许一个处于待确认状态（并清掉旧定时器）
    if (onAction) node.classList.add('armed');
    showTip(node, render());
    armTimer = setTimeout(disarmTipAction, 5000);
    armedState = { node, onAction };
  };
  node.addEventListener('click', ev => {
    ev.stopPropagation();
    if (armedState && armedState.node === node && armedState.onAction) {
      const run = armedState.onAction;
      disarmTipAction();
      run();                                  // 先收起气泡再执行，避免动作里重建 DOM 时残留
      return;
    }
    arm();
  });
  if (sceneNode) onSceneCleanup(sceneNode, disarmTipAction);
  return node;
}

/* ---------------- 弹窗 ---------------- */
export function modal({ title, body, buttons = [], closable = false, onClose }) {
  const bg = el('div', { class: 'modal-bg' });
  const box = el('div', { class: 'modal panel' });
  if (title) box.append(el('div', { class: 'mhead', html: title }));
  const bodyWrap = el('div', { class: 'mbody' });
  if (typeof body === 'string') bodyWrap.innerHTML = body;
  else if (body) bodyWrap.append(body);
  box.append(bodyWrap);
  const foot = el('div', { class: 'mfoot' });
  const close = () => { bg.remove(); onClose?.(); };
  const made = [];
  for (const b of buttons) {
    // 防呆：这里要的是 { label, cls, onClick } 描述对象。
    // 之前 pickCards 误传了一个 <button> DOM 元素进来 —— b.label 是 undefined，
    // 结果渲染出一个空白按钮、点了也什么都不做，非常难查。宁可当场报错。
    if (!b || typeof b !== 'object' || b.nodeType || typeof b.label !== 'string' || !b.label) {
      throw new Error('modal(): buttons 必须是 { label, cls, onClick, keepOpen, disabled } 描述对象，收到的是 ' +
        (b && b.nodeType ? `<${b.tagName?.toLowerCase()}> 元素` : String(b)));
    }
    const btn = el('button', {
      class: 'btn ' + (b.cls || ''), html: b.label,
      onClick: () => {
        sfx.click();
        if (b.keepOpen) b.onClick?.(close);   // 自己决定什么时候关
        else { b.onClick?.(close); close(); }
      },
    });
    if (b.disabled) btn.classList.add('disabled');
    made.push(btn);
    foot.append(btn);
  }
  if (foot.children.length) box.append(foot);
  bg.append(box);
  bg.addEventListener('click', e => { if (e.target === bg && closable) { sfx.back(); close(); } });
  overlayRoot().append(bg);
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fitAllCards(bg));
  return { close, box, bodyWrap, buttons: made, foot };
}

export function confirm(text, onYes, yesLabel = '确定', noLabel = '取消') {
  modal({
    title: '请确认', body: `<div style="text-align:center;padding:8px 4px">${text}</div>`,
    buttons: [
      { label: noLabel, cls: 'ghost', onClick: () => sfx.back() },
      { label: yesLabel, cls: 'primary', onClick: onYes },
    ],
  });
}

/** 选牌器：从 list 里选 n 张（list 元素为 {id, up} 或卡实例） */
export function pickCards(list, { n = 1, title = '选择卡牌', hint = '', onDone, renderCard, extraButton, cardBadge } = {}) {
  const chosen = new Set();
  const body = el('div');
  if (hint) body.append(el('div', { class: 'small dim', style: { textAlign: 'center', marginBottom: '8px' }, html: hint }));
  const grid = el('div', { class: 'deck-grid' });
  body.append(grid);
  let m = null;

  let okBtn = null;
  const update = () => {
    $$('.card', grid).forEach((c, i) => c.classList.toggle('selected', chosen.has(i)));
    okBtn?.classList.toggle('disabled', chosen.size !== n);
    cnt.textContent = `已选 ${chosen.size}/${n}${chosen.size === n ? '　✅ 点右下角「确定」' : ''}`;
  };
  /** 确认并关掉弹窗（按钮和「再点一次已选中的牌」都会走这里） */
  const confirm = () => {
    if (chosen.size !== n) { sfx.error(); toast(`请先选择 ${n} 张牌`); return false; }
    const sel = [...chosen].map(i => list[i]);
    m?.close();
    onDone?.(sel);
    return true;
  };

  list.forEach((c, i) => {
    const card = renderCard ? renderCard(c) : c;
    const node = cardEl(card, {
      onClick: () => {
        sfx.click();
        if (chosen.has(i)) {
          // 再点一次已选中的牌：单张选择时直接确认（更符合直觉，少点一次按钮）
          if (n === 1) { confirm(); return; }
          chosen.delete(i);
        } else {
          if (chosen.size >= n) chosen.delete([...chosen][0]);
          chosen.add(i);
        }
        update();
      },
    });
    grid.append(cardBadge
      ? el('div', { class: 'col center gap4' }, el('div', { class: 'card-badge', text: cardBadge }), node)
      : node);
  });
  const cnt = el('div', { class: 'small dim', style: { textAlign: 'center', marginTop: '8px' } });
  body.append(cnt);

  const buttons = [
    { label: '取消', cls: 'ghost', keepOpen: true, onClick: (close) => { sfx.back(); close(); onDone?.(null); } },
  ];
  if (extraButton) buttons.push(extraButton);
  buttons.push({
    label: n === 1 ? '确定' : `确定（${n} 张）`, cls: 'primary', keepOpen: true,
    onClick: () => { confirm(); },
  });

  m = modal({ title, body, buttons });
  okBtn = m.buttons[m.buttons.length - 1];
  update();
  return m;
}

/* ---------------- 数值输入弹层（商店等） ---------------- */
export function infoModal(title, html) {
  return modal({ title, body: `<div style="padding:4px">${html}</div>`, buttons: [{ label: '知道了', cls: 'primary' }], closable: true });
}

/* ---------------- 遗物图标 ----------------
   遗物没有"使用"动作，所以是纯查看：**点一下就把作用显示出来**（以前只能长按，
   很多人根本不知道能按）。长按仍然有效，两条路径写的是同一个 .tip。 */
export function relicEl(id, { sceneNode } = {}) {
  const r = RELICS[id];
  const node = el('div', {
    class: 'relic ' + (r.rarity === 'boss' ? 'boss' : ''),
    style: { backgroundImage: `url(${SPR(r.sprite)})` },
  });
  const tip = () => `<div class="tname">${r.name}</div>${r.desc}`;
  bindTip(node, tip);                                    // 长按（老习惯）
  bindTipAction(node, { html: tip, sceneNode });          // 点一下（主要路径）
  return node;
}

/* ---------------- 全屏闪 ---------------- */
export function screenFlash() {
  const n = el('div', { class: 'screenflash on' });
  document.body.append(n);
  setTimeout(() => n.remove(), 300);
}

import { el, clear, $, $$, sleep, fxFloat, shake, toast, clamp, onScene } from '../core/util.js';
import { G, save, relicMods, hydrate } from '../core/state.js';
import { RELICS } from '../data/relics.js';
import { CARDS, makeCard, RARITY, TYPE_LABEL } from '../data/cards.js';
import { ST, stText } from '../core/battle.js';
import { sfx } from '../core/audio.js';
import { classSprite, className } from '../data/classes.js';
import { cardEl, hpBar, updateHpBar, statusRow, SPR, relicEl, bindTip, bindTipAction, disarmTipAction, onLongPress, modal, screenFlash, pickCards, fitAllCards, goldIcon } from './widgets.js';

/**
 * 构建战斗界面，并把 view 回调挂到 B 上
 * onFinish(result) 在战斗结束时调用
 */
export function battleScene(B, { onFinish, onQuit, resumed }) {
  // 根节点带上职业标记：能量球（.orb）据此换色。
  // 带职业标记的容器会给整棵子树设 --cc-* 变量，但卡牌自己会覆盖（见 css 的 .card）。
  const root = el('div', { class: 'screen battle c-' + G.cls });

  /* ---------- 顶栏 ---------- */
  const topbar = el('div', { class: 'topbar' });
  const avatar = el('div', { class: 'avatar', style: { backgroundImage: `url(${SPR(classSprite(G.cls))})` } });
  const hpWrap = el('div', { class: 'grow' });
  const playerBar = hpBar(B.player.hp, B.player.maxHp, B.player.block);
  hpWrap.append(playerBar);
  const goldStat = el('div', { class: 'stat' }, goldIcon(), el('span', { class: 'gold', text: G.gold }));
  const floorStat = el('div', { class: 'stat', html: `<span class="dim">第</span>${G.act}<span class="dim">层</span>` });
  const btnDeck = el('button', { class: 'btn sm ghost', text: '卡组', onClick: () => showDeck() });
  const btnMenu = el('button', { class: 'btn sm ghost', text: '≡', onClick: () => pauseMenu() });
  topbar.append(avatar, hpWrap, goldStat, floorStat, btnDeck, btnMenu);

  /* ---------- 遗物条 ---------- */
  const relicbar = el('div', { class: 'relicbar' });
  const rebuildRelics = () => {
    clear(relicbar);
    for (const id of G.relics) relicbar.append(relicEl(id, { sceneNode: root }));
    if (!G.relics.length) relicbar.append(el('span', { class: 'tiny dim', text: '（暂无遗物）' }));
  };
  rebuildRelics();

  /* ---------- 药水条 ---------- */
  const potionBar = el('div', { class: 'relicbar potionbar' });
  let potionsDrawn = -1;          // 上一次渲染出来的药水数量，用来判断需不需要重建
  const rebuildPotions = () => {
    disarmTipAction();                       // 药水被消耗后 DOM 会重建，收起可能还挂着的气泡
    clear(potionBar);
    potionsDrawn = G.potions.length;
    if (!G.potions.length) {
      potionBar.append(el('span', { class: 'tiny dim', text: '（没有药水）' }));
      return;
    }
    G.potions.forEach((p, i) => {
      const n = el('div', {
        class: 'relic potion',
        style: { backgroundImage: `url(${SPR(p.sprite)})`, width: '32px', height: '32px' },
      });
      // 两段式：点一下看作用，再点一下才真的喝掉（避免误触，尤其是战斗中）
      bindTipAction(n, {
        html: () => `<div class="tname">${p.name}</div>${p.text}`,
        hint: '再点一次使用（不消耗能量）',
        onAction: () => usePotion(i),
        sceneNode: root,
      });
      potionBar.append(n);
    });
  };
  rebuildPotions();

  async function usePotion(i) {
    if (busy || finished) return;
    const p = G.potions[i];
    if (!p) return;
    const needsTarget = p.target === 'enemy' && B.aliveEnemies().length > 1;
    if (needsTarget) {
      toast('点一个敌人作为目标', 1200);
      pendingTarget = 'potion';
      potionIndex = i;
      sync();
      return;
    }
    busy = true;
    G.potions.splice(i, 1);
    sfx.confirm();
    toast(`使用药水「<span style="color:#7ee787">${p.name}</span>」<br><span class="tiny">${p.text}</span>`, 2000);
    await B.usePotion(p, B.aliveEnemies()[0]);
    save();
    rebuildPotions();
    busy = false;
    sync();
  }
  let potionIndex = -1;

  /* ---------- 战场 ---------- */
  const field = el('div', { class: 'field' });
  const enemyNodes = new Map();

  function buildEnemy(e) {
    const node = el('div', { class: 'enemy', data: { uid: e.uid } });
    const intent = el('div', { class: 'intent unk' });
    const body = el('div', { class: 'body' });
    const base = Math.round(76 * (e.body || 1));
    const sprite = el('div', {
      class: 'sprite',
      style: {
        backgroundImage: `url(${SPR(e.sprite)})`,
        // 只给基准尺寸，实际大小交给 CSS 的 min(基准, 战场上限)
        '--spr-base': base + 'px',
        filter: (e.def?.tint || e.tint) ? `${e.def?.tint || e.tint} drop-shadow(0 4px 3px #0009)` : '',
      },
    });
    body.append(sprite);
    const ebar = hpBar(e.hp, e.maxHp, e.block, 'ebar');
    const nm = el('div', { class: 'name', text: e.name });
    // 名字 + 血条包在一个深色名牌里，保证任何背景上都看得清
    const plate = el('div', { class: 'plate' }, nm, ebar);
    const sts = el('div', { class: 'sts' });
    node.append(intent, body, plate, sts);
    node.addEventListener('click', () => onEnemyClick(e));
    node._refs = { intent, sprite, ebar, sts, node };
    enemyNodes.set(e.uid, node._refs);
    return node;
  }

  // 点战场空白处 = 取消选目标
  field.addEventListener('click', e => {
    if (e.target === field || e.target.classList.contains('field')) {
      if (pendingTarget) { sfx.back(); cancelSelect(); }
    }
  });

  /* ---------- 敌人尺寸自适应 ----------
     战场高度是 flex 撑出来的，屏幕矮 / 敌人多 / Boss 体型大时，
     敌人很容易顶穿战场边框，盖到上面的药水条或下面的玩家区。
     这里按「可用宽高 + 预估行数」算出每个精灵的上限，写进 --spr-cap。 */
  let lastFitKey = '';
  /** 敌人整体实际占用的高度（布局px）。offsetTop/offsetHeight 才是布局单位，
      别用 getBoundingClientRect —— 那是被 #stage 的 zoom 放大过的视觉像素。 */
  function enemyBlockHeight() {
    // 只量**还活着**的怪：死了的节点在淡出动画期间仍占布局，会把高度算大，
    // 导致尺寸被过度压缩、重排不及时
    const nodes = [...field.querySelectorAll('.enemy:not(.dead)')];
    if (!nodes.length) return 0;
    const tops = nodes.map(n => n.offsetTop);
    const bots = nodes.map(n => n.offsetTop + n.offsetHeight);
    return Math.max(...bots) - Math.min(...tops);
  }

  function updateEnemySizing(force) {
    const alive = B.aliveEnemies();
    if (!alive.length) {
      field.style.removeProperty('--spr-cap');
      field.style.removeProperty('--enemy-max-w');
      lastFitKey = '';
      return;
    }
    // 这函数里有强制回流，不能每次 sync 都跑满迭代 —— 输入没变就直接跳过。
    // 状态数量也要进 key：多一个状态标签就可能多折一行。
    const key = alive.map(e => e.body || 1).join(',')
      + '|' + alive.map(e => Object.keys(e.st || {}).length).join(',')
      + '|' + field.clientWidth + 'x' + field.clientHeight;
    if (!force && key === lastFitKey) return;
    lastFitKey = key;

    const cs = getComputedStyle(field);
    const availW = field.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = field.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    if (availW <= 0 || availH <= 0) return;

    const GAP = 8;            // 与 CSS 里 .field 的横向 gap 一致
    const PAD = 12;           // .enemy 容器左右内边距
    const MIN_W = 88;         // .enemy 的 min-width
    const n = alive.length;

    // 预估一行能放几个（按基准宽度），再据此给每个敌人一个宽度上限。
    // 这个上限是**必需**的：状态标签是 nowrap 的，不封顶就会被撑爆、
    // 一行变两行，高度直接翻倍顶穿战场。
    const bases = alive.map(e => Math.max(MIN_W, Math.round(76 * (e.body || 1)) + PAD));
    let perRow = 0, acc = 0, rows = 1;
    for (const w of bases) {
      if (acc > 0 && acc + GAP + w > availW) { rows++; perRow = Math.max(perRow, acc); acc = w; }
      else acc += (acc > 0 ? GAP : 0) + w;
    }
    perRow = Math.max(perRow, acc);
    const cols = Math.max(1, Math.min(n, Math.round((perRow + GAP) / (MIN_W + GAP))));
    const rowW = Math.floor((availW - (Math.max(1, cols) - 1) * GAP) / Math.max(1, cols));
    field.style.setProperty('--enemy-max-w', Math.max(MIN_W, rowW) + 'px');

    // 初值：按行数分高度
    const RESERVE = 74;       // 意图 + 名牌 + 间距（状态标签另行实测修正）
    let cap = Math.round(availH / Math.max(1, rows) - RESERVE);
    cap = Math.min(cap, rowW - PAD);
    cap = Math.max(32, cap);

    // 迭代修正：直接量**实际**占用高度，超标就按比例缩。
    // 为什么不能只靠估算 —— 状态标签的数量/文字长度会把敌人撑宽撑高，
    // 折不折行取决于内容，估不准；量结果最可靠，而且对长名字等一切情况都成立。
    for (let i = 0; i < 6; i++) {
      field.style.setProperty('--spr-cap', cap + 'px');
      void field.offsetHeight;                     // 强制回流，让新尺寸生效
      const need = enemyBlockHeight();
      if (need <= availH || cap <= 30) break;
      const next = Math.max(30, Math.floor(cap * availH / need));
      if (next >= cap) break;
      cap = next;
    }

    // 迭代到底还是装不下时：把居中对齐改成顶对齐。
    // 否则 flex 的 align-content:center 会让内容**上下同时溢出**，上排连同意图一起被裁掉。
    // 拥挤时再切紧凑样式，把意图/名牌/状态压紧，让更多意图同屏。
    field.classList.toggle('crowded', alive.length >= 5);
    void field.offsetHeight;
    const stillOver = enemyBlockHeight() > availH + 1;
    field.style.alignContent = stillOver ? 'flex-start' : '';
    field.style.setProperty('--spr-cap', cap + 'px');
  }

  const rebuildField = () => {
    clear(field);
    enemyNodes.clear();
    for (const e of B.enemies) {
      if (e.dead && !enemyNodes.has(e.uid)) continue;
      field.append(buildEnemy(e));
    }
  };
  rebuildField();

  /* ---------- 玩家区 ---------- */
  const playerZone = el('div', { class: 'player-zone' });
  const playerSprite = el('div', { class: 'player-sprite', style: { backgroundImage: `url(${SPR(classSprite(G.cls))})` } });
  const playerSts = el('div', { class: 'sts' });
  const blockBadge = el('div', { class: 'blockbadge' });
  playerZone.append(playerSprite, el('div', { class: 'col center gap4' }, playerSts), blockBadge);
  playerSprite.addEventListener('click', () => { if (playerSprite.style.outline) {} });

  /* ---------- 能量 / 牌堆 ---------- */
  const orb = el('div', { class: 'orb', text: '3' });
  const drawPile = el('div', { class: 'pile' }, el('div', { class: 'disc' }), el('span', { class: 'num', text: '0' }), el('span', { text: '抽牌' }));
  const discPile = el('div', { class: 'pile' }, el('div', { class: 'disc' }), el('span', { class: 'num', text: '0' }), el('span', { text: '弃牌' }));
  const exhaustPile = el('div', { class: 'pile' }, el('div', { class: 'disc', style: { opacity: .45 } }), el('span', { class: 'num', text: '0' }), el('span', { text: '消耗' }));
  const endTurnBtn = el('button', { class: 'btn primary', text: '结束回合', onClick: () => doEndTurn() });
  const piles = el('div', { class: 'piles' }, drawPile, orb, exhaustPile, discPile, endTurnBtn);
  drawPile.addEventListener('click', () => viewPile('抽牌堆', B.draw));
  discPile.addEventListener('click', () => viewPile('弃牌堆', B.discard));
  exhaustPile.addEventListener('click', () => viewPile('消耗堆', B.exhaustPile));

  /* ---------- 手牌 ---------- */
  const handWrap = el('div', { class: 'hand-wrap' });
  const hand = el('div', { class: 'hand' });
  handWrap.append(hand);

  root.append(topbar, relicbar, potionBar, field, playerZone, piles, handWrap);

  /* ================= 状态 ================= */
  let selected = null;       // 正在选目标的卡
  let pendingTarget = false;
  let busy = false;
  let finished = false;


  /* ================= 渲染 ================= */
  function renderIntent(e) {
    const refs = enemyNodes.get(e.uid);
    if (!refs) return;
    const it = B.intentOf(e);
    const cls = { attack: 'atk', attack_debuff: 'atk', defend: 'def', buff: 'buf', debuff: 'deb', heal: 'buf', unknown: 'unk' }[it.intent] || 'unk';
    const ico = { attack: '⚔', attack_debuff: '⚔↓', defend: '⛨', buff: '⬆', debuff: '↓', heal: '✚', unknown: '?' }[it.intent] || '?';
    let txt = ico;
    if (it.dmg) txt = `${ico} ${it.dmg}${it.hits > 1 ? `×${it.hits}` : ''}`;
    // 加甲意图也把数字显示出来（原来只有长按气泡里才有），
    // 和攻击意图一个写法 —— 玩家一眼就能看到敌人这回合会挡多少。
    else if (it.blk) txt = `${ico} ${it.blk}`;
    refs.intent.className = 'intent ' + cls;
    refs.intent.innerHTML = `<span>${txt}</span>`;
    /* ⚠️ 气泡内容必须在**长按那一刻**重新取一次意图，不能在首次渲染时把 `it` 闭包进去。
       以前写的是 `() => intentDesc(it)`，而 bindTipOnce 只绑一次 ——
       于是敌人换招之后，长按看到的永远是**它第一次被渲染时**的招式说明
       （数字对得上只是巧合：意图行每次都重画，气泡却没重画）。 */
    bindTipOnce(refs.intent, () => {
      const cur = B.intentOf(e);
      return `<div class="tname">${cur.name}</div>` + intentDesc(cur);
    });
  }

  function bindTipOnce(node, fn) {
    if (node._tipped) return;
    node._tipped = true;
    bindTip(node, fn);
  }

  function intentDesc(it) {
    const p = [];
    // 不在数字上体现的机制排在最前面 —— 「出招前先吞你一半护甲」这种话
    // 必须比"造成 14 点伤害"更早被看到，否则玩家会以为自己还有 14 点护甲。
    for (const n of (it.notes || [])) p.push(`<span class="gold">${n}</span>`);
    if (it.dmg) p.push(`将造成 <b>${it.dmg}</b> 点伤害${it.hits > 1 ? ` × ${it.hits} 次` : ''}`);
    if (it.blk) p.push(`将获得 <b>${it.blk}</b> 点护甲`);
    if (it.intent === 'buff') p.push('将强化自身');
    if (it.intent === 'debuff' || it.intent === 'attack_debuff') p.push('将施加负面状态');
    if (it.intent === 'heal') p.push('将回复生命');
    if (it.intent === 'unknown') p.push('意图不明');
    return p.join('<br>');
  }

  /** 怪物死亡：先淡出，动画结束后**真正从 DOM 移除**并重排。
      以前只加个 .dead（opacity:0），节点仍占布局空间 —— 死了怪剩下的也不会变大，
      而且 enemyBlockHeight 会把死节点算进去，尺寸被白白压缩。 */
  function fadeOutEnemy(e) {
    const refs = enemyNodes.get(e.uid);
    if (!refs || refs._removing) return;
    refs._removing = true;
    refs.node.classList.add('dead');
    setTimeout(() => {
      refs.node.remove();
      enemyNodes.delete(e.uid);
      updateEnemySizing(true);     // 死了一只 → 剩下的重新分配空间
      layoutHand();
    }, 380);
  }

  function renderEnemy(e) {
    const refs = enemyNodes.get(e.uid);
    if (!refs) return;
    updateHpBar(refs.ebar, Math.max(0, e.hp), e.maxHp, e.block);
    const s = statusRow(e);
    refs.sts.replaceWith(s);
    refs.sts = s;
    if (e.dead) refs.node.classList.add('dead');
    // 被冰冻：整体盖一层浅蓝滤镜，一眼看出"这个怪这回合动不了"
    refs.node.classList.toggle('frozen', B.get(e, 'freeze') > 0);
    refs.node.classList.toggle('selectable', pendingTarget && !e.dead);
    refs.node.classList.toggle('selected', pendingTarget && e === selectedTarget);
  }

  function renderPlayer() {
    updateHpBar(playerBar, Math.max(0, B.player.hp), B.player.maxHp, 0);
    const s = statusRow(B.player);
    playerStsRef.replaceWith(s);
    playerStsRef = s;
    blockBadge.classList.toggle('on', B.player.block > 0);
    blockBadge.innerHTML = `⛨ ${B.player.block}`;
  }
  let playerStsRef = playerSts;

  function renderHand() {
    clear(hand);
    for (const c of B.hand) {
      const playable = B.canPlay(c);
      const node = cardEl(c, {
        extraClass: [playable ? 'playable' : '', selected === c ? 'selected' : ''].join(' '),
        battle: B,                       // 让终结牌知道条件满足没有（决定要不要变暗）
        onClick: () => onCardTap(c, node),
      });
      if (!playable) node.classList.add('unplayable');
      hand.append(node);   // 长按看大图由 cardEl 统一处理
    }
    if (!B.hand.length) {
      hand.append(el('div', { class: 'dim small', style: { padding: '40px 0 0 12px' }, text: '（手牌为空，点「结束回合」）' }));
      return;
    }
    // 手牌叠放：牌多时自动错开，保证不用横向滚动也能一眼看全
    requestAnimationFrame(() => { fitAllCards(hand); layoutHand(); });
  }

  function renderCounts() {
    orb.textContent = B.energy;
    drawPile.querySelector('.num').textContent = B.draw.length;
    discPile.querySelector('.num').textContent = B.discard.length;
    exhaustPile.querySelector('.num').textContent = B.exhaustPile.length;
  }

  /** 按可用宽度算每张牌露出的宽度，太窄就自动叠起来 */
  function layoutHand() {
    const cards = [...hand.querySelectorAll('.card')];
    const n = cards.length;
    if (!n) return;
    const CW = cards[0].offsetWidth;
    const gap = 7;
    const avail = hand.clientWidth - 24;      // 两侧内边距
    let step = CW + gap;
    if (n > 1) step = Math.min(step, (avail - CW) / (n - 1));
    const MIN_STEP = Math.round(CW * 0.66);   // 至少露出 2/3，看得清费用和名字
    step = Math.max(step, MIN_STEP);
    const overlap = CW + gap - step;
    cards.forEach((c, i) => {
      c.style.marginLeft = i === 0 || overlap <= 0 ? '' : `-${overlap.toFixed(1)}px`;
      c.style.zIndex = String(10 + i);
    });
    hand.style.justifyContent = step < CW * 0.9 ? 'flex-start' : 'center';
  }
  onScene(root, window, 'resize', () => requestAnimationFrame(layoutHand));

  let selectedTarget = null;
  function sync() {
    updateEnemySizing();
    for (const e of B.enemies) renderEnemy(e);
    persist();
    renderPlayer();
    renderHand();
    renderCounts();
    // 用「上次渲染的数量」判断，而不是 childElementCount ——
    // 空态会往药水条里放一句「（没有药水）」，于是 0 瓶和 1 瓶的 childElementCount
    // 都是 1（Math.max(1, 1) === 1），从 0 变 1 时**不会重建**，新拿到的药水图标不显示。
    if (potionsDrawn !== G.potions.length) rebuildPotions();
    for (const e of B.aliveEnemies()) renderIntent(e);
    endTurnBtn.classList.toggle('disabled', busy || finished);
    goldStat.querySelector('.gold').textContent = G.gold;
  }

  /* ================= 交互 ================= */
  function onCardTap(card, node) {
    if (busy || finished) return;
    if (card.unplayable) { sfx.error(); toast('这张牌不能被打出'); return; }
    if (!B.canPlay(card)) {
      sfx.error(); shake(node);
      // 说清**为什么**不能打 —— 终结牌有两道门，笼统报"能量不足"会让玩家
      // 以为是能量问题，实际是条件没满足（或没有合法目标）。
      if (card.costN && B.energy < B.cardCost(card)) toast('能量不足');
      else if (card.cond && !card.cond(B)) toast('条件还没满足 —— ' + finisherHint(card));
      else if (card.targetFilter && !B.validTargets(card).length) toast('没有合法目标 —— ' + finisherHint(card));
      else toast('能量不足');
      return;
    }

    const alive = B.aliveEnemies();
    // 有 targetFilter 的牌必须让玩家自己点目标 —— 即使场上只剩 2 只，
    // 也得筛出**合法的**那一只；auto-target 会打到不可选的敌人身上。
    const needTarget = card.target === 'enemy' && (card.targetFilter ? B.validTargets(card).length > 1 : alive.length > 1);
    if (!needTarget) {
      const only = card.targetFilter ? B.validTargets(card)[0] : alive[0];
      play(card, only);
      return;
    }
    if (selected === card) { cancelSelect(); return; }
    cancelSelect();
    selected = card;
    pendingTarget = true;
    node.classList.add('selected');
    sfx.click();
    toast(`选择「${card.name}」的目标`, 1200);
    sync();
  }

  /** 终结牌的条件说明 —— 说明见文件底部的 finisherHint()。
      以前这里有一份**手抄的 id → 文案映射表**，改条件忘改文案就会说谎
      （真理牌：条件已提到 7 层、提示还写着 3 层），现已删掉。 */

  function cancelSelect() {
    selected = null; pendingTarget = false; selectedTarget = null; potionIndex = -1;
    sync();
  }

  function onEnemyClick(e) {
    if (finished || e.dead) return;
    if (pendingTarget === 'potion' && potionIndex >= 0) {
      const i = potionIndex;
      cancelSelect();
      usePotion(i);
      return;
    }
    if (pendingTarget && selected) {
      const c = selected;
      // 终结尾的目标限制也要在这里拦：点错目标不该"照着打"，而是明确拒绝
      if (c.targetFilter && !c.targetFilter(e, B)) {
        sfx.error();
        toast('这个目标不合法 —— ' + finisherHint(c));
        return;
      }
      cancelSelect();
      play(c, e);
    } else {
      // 只是看一眼
      sfx.click();
    }
  }

  async function play(card, target) {
    busy = true; cancelSelect();
    await B.playCard(card, target);
    busy = false;
    sync();
    if (finished) return;
    if (B.over) return;
    // 敌人全死 -> 结束
    if (!B.aliveEnemies().length) return;
  }

  async function doEndTurn() {
    if (busy || finished) return;
    busy = true;
    endTurnBtn.classList.add('disabled');
    await B.endTurn();
    busy = false;
    sync();
  }

  /* ================= 卡组 / 暂停 ================= */
  function showDeck() {
    sfx.open();
    modal({ title: `当前卡组（${G.deck.length} 张）`, closable: true, body: deckBody(), buttons: [{ label: '关闭', cls: 'primary' }] });
  }
  function viewPile(title, pile) {
    sfx.open();
    const body = el('div');
    if (!pile.length) body.append(el('div', { class: 'dim', style: { textAlign: 'center', padding: '20px' }, text: '（空）' }));
    else {
      const g = el('div', { class: 'deck-grid' });
      for (const c of [...pile].sort((a, b) => a.name.localeCompare(b.name))) g.append(cardEl(c));
      body.append(g);
    }
    modal({ title: `${title}（${pile.length} 张）`, body, buttons: [{ label: '关闭', cls: 'primary' }], closable: true });
  }
  function pauseMenu() {
    sfx.open();
    modal({
      title: '菜单', closable: true,
      body: `<div style="text-align:center;padding:6px" class="small dim">
        职业：${className(G.cls)}<br>
        第 ${G.act} 层 · 已走 ${G.stats.floors} 层<br>
        击杀 ${G.stats.kills} · 精英 ${G.stats.elites} · Boss ${G.stats.bosses}<br>
        <span class="tiny">进度已自动保存</span></div>`,
      buttons: [
        { label: '继续', cls: 'primary' },
        { label: '玩法说明', cls: 'ghost', onClick: () => showHelp() },
        { label: '放弃本局', cls: 'danger', onClick: () => onQuit?.() },
      ],
    });
  }

  /* ================= 状态变化提示 ================= */
  // 引擎每次改状态都会回调 onStatus，这里跟上一次的值比对，
  // 把「谁被施加了什么、变化多少」直接飘出来（虚弱 +2 / 易伤 -1），
  // 免得玩家只看到一个紫色图标不知道发生了什么。
  const lastSt = new Map();
  function diffStatus(e) {
    const prev = lastSt.get(e.uid) || {};
    const cur = e.st || {};
    const out = [];
    for (const [k, v] of Object.entries(cur)) {
      const d = v - (prev[k] || 0);
      if (d) out.push([k, d]);
    }
    for (const [k, v] of Object.entries(prev)) if (!(k in cur) && v) out.push([k, -v]);
    lastSt.set(e.uid, { ...cur });
    return out;
  }
  function floatStatus(e, changes) {
    if (!changes.length) return;
    const node = e.isPlayer ? playerSprite : enemyNodes.get(e.uid)?.sprite;
    if (!node) return;
    changes.forEach(([k, d], i) => {
      const def = ST[k];
      if (!def) return;
      setTimeout(() => {
        fxFloat(node, `${def.name} ${d > 0 ? '+' : ''}${d}`, 'st');
        const n = document.getElementById('fx-layer')?.lastElementChild;
        if (n) n.style.color = def.color;
      }, i * 130);
    });
  }

  /* ================= 战斗自动存档 =================
     中途关掉页面再进来，敌人 / 血量 / 手牌都要和刚才一模一样。 */
  let lastPersist = 0;
  function persist(force) {
    if (finished || B.over) return;
    const now = Date.now();
    if (!force && now - lastPersist < 900) return;
    lastPersist = now;
    G.hp = B.player.hp;                       // 让地图/战报看到实时血量
    G.pending = { scene: 'battle', kind: B.kind, type: B.kind, snap: B.serialize(), ts: now };
    save();
  }
  // 关页面/切后台都要立刻落盘 —— beforeunload 在移动端不可靠，visibilitychange 更稳
  // 这四个监听器必须跟着场景走（onScene）：否则每进一次战斗就多留一份，
  // 旧的闭包会一直攥着这一整场战斗的 Battle 和 DOM。
  onScene(root, window, 'beforeunload', () => { try { persist(true); } catch {} });
  onScene(root, document, 'visibilitychange', () => { if (document.hidden) { try { persist(true); } catch {} } });
  onScene(root, window, 'pagehide', () => { try { persist(true); } catch {} });

  /* ================= 引擎回调 ================= */
  const view = {
    async step(ms = 70) { if (ms > 0) await sleep(ms); },
    sync,
    log() {},
    onDamage(target, real, blocked, total, isDot) {
      if (target.isPlayer) {
        updateHpBar(playerBar, Math.max(0, B.player.hp), B.player.maxHp, 0);
        if (real > 0) {
          fxFloat(playerSprite, '-' + real, 'dmg' + (real >= 12 ? ' big' : ''));
          playerSprite.classList.add('hurt'); setTimeout(() => playerSprite.classList.remove('hurt'), 340);
          sfx.hit(); if (real >= 12) screenFlash();
        } else if (blocked > 0) { fxFloat(playerSprite, '⛨', 'blk'); sfx.block(); }
      } else {
        const refs = enemyNodes.get(target.uid);
        if (refs) {
          updateHpBar(refs.ebar, Math.max(0, target.hp), target.maxHp, target.block);
          if (real > 0) {
            fxFloat(refs.sprite, '-' + real, 'dmg' + (real >= 12 ? ' big' : ''));
            refs.sprite.classList.add('hurt'); setTimeout(() => refs.sprite.classList.remove('hurt'), 340);
            sfx.hit();
          } else if (blocked > 0) { fxFloat(refs.sprite, '⛨', 'blk'); sfx.block(); }
        }
      }
    },
    onHeal(e, n) {
      const node = e.isPlayer ? playerSprite : enemyNodes.get(e.uid)?.sprite;
      fxFloat(node, '+' + n, 'heal'); sfx.confirm();
    },
    onBlock(e, n) {
      const node = e.isPlayer ? playerSprite : enemyNodes.get(e.uid)?.sprite;
      fxFloat(node, '⛨+' + n, 'blk');
    },
    onStatus(e) {
      const refs = e.isPlayer ? null : enemyNodes.get(e.uid);
      if (refs) { const s = statusRow(e); refs.sts.replaceWith(s); refs.sts = s; }
      renderPlayer();
      floatStatus(e, diffStatus(e));
    },
    onDraw() { sfx.draw(); },
    onPlay(card) {
      sfx.playCard();
      if (card.type === 'attack') sfx.slash(); else sfx.place();
    },
    onExhaust(card) { toast(`「${card.name}」被消耗`); },
    onEnergy() { renderCounts(); },
    onGold() { sfx.coin(); goldStat.querySelector('.gold').textContent = G.gold; },
    onTurnStart(n) {
      renderCounts();
      toast(`第 ${n} 回合`, 900);
    },
    onEnemyAct(e, def) {
      const refs = enemyNodes.get(e.uid);
      if (!refs) return;
      refs.node.classList.add('attacking');
      setTimeout(() => refs.node.classList.remove('attacking'), 460);
      if (def.dmg) sfx.slash2();
    },
    onSummon(e) {
      const node = buildEnemy(e);
      field.append(node);
      updateEnemySizing();     // 多了一只，尺寸上限要重算
      sync();
      toast(`${e.name} 出现了！`, 1100);
    },
    // 出牌结束 / 回合切换：立刻存一次，保证"刚打完一张牌就关页面"不会丢
    afterAction() { persist(true); },
    /** 弃牌代价（「飞刀」）：弹选牌器让玩家自己挑，返回要丢的那张在手牌里的下标。
        玩家点取消就返回 -1 —— 引擎侧会退化成随机弃一张，
        因为卡面写的"弃 1 张牌"是**代价**：付不出也不能白赚。
        返回 Promise，引擎的 discardFromHand() 会 await 它。 */
    requestDiscard(hand) {
      return new Promise(resolve => {
        if (!hand.length) { resolve(-1); return; }
        let settled = false;
        const done = v => { if (!settled) { settled = true; resolve(v); } };
        pickCards(hand.slice(), {
          n: 1, title: '弃一张牌', hint: '「飞刀」的代价：选中的牌进入弃牌堆',
          onDone: sel => {
            if (!sel || !sel[0]) { done(-1); return; }
            // 用对象身份找回下标（hand 里就是这些卡实例本身）
            const i = hand.indexOf(sel[0]);
            done(i >= 0 ? i : -1);
          },
        });
      });
    },
    onDeath(e) {
      fadeOutEnemy(e);
      sfx.bell();
    },
    // 斩杀触发时给一次明显反馈 —— 不然玩家只看到敌人突然没了，不知道是效果生效
    onExecute(e, card) {
      const refs = enemyNodes.get(e.uid);
      if (refs) fxFloat(refs.sprite, '斩杀！', 'dmg big');
      sfx.bell();
      screenFlash();
      toast(`「${card?.name || '效果'}」直接斩杀了 <b>${e.name}</b>`, 1500);
    },
    onVanish(e) {
      fadeOutEnemy(e);
      toast(`${e.name} 随之溃散`, 900);
    },
    onPotion(p) { sfx.confirm(); },
    onEnd(result) { finish(result); },
  };
  B.view = view;

  async function finish(result) {
    if (finished) return;
    finished = true;
    await sleep(600);
    if (result === 'win') sfx.confirm();
    onFinish(result, B);
  }

  /* ================= 启动 ================= */
  sync();
  (async () => {
    if (resumed) {
      // 读档续战：直接沿用快照里的敌人和手牌，不重新随机
      toast('战斗继续', 1200);
      await sleep(260);
      await B.resume();
      sync();
      persist(true);
      return;
    }
    B.rollIntents();
    sync();
    await sleep(300);
    await B.start();
    sync();
    persist(true);
  })();

  return root;
}

/* ================= 引擎外的小工具 ================= */

/** 终结牌「为什么打不出去」的说明。
 *
 *  **唯一真源是卡牌自己的 `condText`**（见 cards.js 的终结牌区块）。
 *  这里以前是一张手抄映射表，于是"改条件忘改文案"必然发生：
 *  真理牌的条件从 3 层提到 **7 层** 后，提示还写着"需要 3 层以上真理" ——
 *  玩家照着提示攒到 3 层，点下去只会被拒绝，还不知道差在哪。
 *  测试（AH 段）会逐张验证：提示文本 == condText，且 condText 里写的数字
 *  正好就是 `cond` 的触发边界（差 1 点必须打不出去）。 */
export function finisherHint(card) {
  return CARDS[card?.id]?.condText || '条件未满足';
}

export function deckBody() {
  const body = el('div');
  const groups = [
    ['攻击', 'attack'], ['技能', 'skill'], ['能力', 'power'], ['诅咒 / 状态', null],
  ];
  for (const [label, type] of groups) {
    const list = G.deck.filter(e => {
      const c = CARDS[e.id];
      return type ? c.type === type : (c.type === 'curse' || c.type === 'status');
    });
    if (!list.length) continue;
    body.append(el('div', { class: 'small gold', style: { margin: '10px 0 6px' }, text: `${label}（${list.length}）` }));
    const g = el('div', { class: 'deck-grid' });
    for (const e of [...list].sort((a, b) => CARDS[a.id].cost - CARDS[b.id].cost || CARDS[a.id].name.localeCompare(CARDS[b.id].name))) {
      g.append(cardEl(makeCard(e.id, e.up)));
    }
    body.append(g);
  }
  return body;
}

export function showHelp() {
  modal({
    title: '玩法说明', closable: true,
    body: `<div class="small" style="line-height:1.7">
      <b>目标</b>：从地牢一路打到深渊之主。<br><br>
      <b>战斗</b>：每回合 <b>3 点能量</b>、抽 <b>5</b> 张牌。点手牌即可打出；需要选目标的牌会先让你点敌人。<br>
      <b>长按卡牌</b>可放大查看。<br>
      回合结束时手牌会全部弃掉，<b>护甲也会清空</b>（除非有「壁垒」）。<br><br>
      <b>意图</b>：敌人头顶的图标是它下回合要干的事——⚔ 伤害、⛨ 加甲、⬆ 强化、↓ 弱化。先看意图再决定攻防。<br><br>
      <b>状态</b>：<br>
      ☠ 中毒 · 轮到它行动时掉血，无视护甲，每回合 **-2**<br>
      🔥 灼烧 · 同上，但每回合 **-1**<br>
      🩸 流血 · 行动**之后**结算，层数**减半**（8→4→2→1，合计 15）<br>
      ✸ 易伤 · 每层使受到的**每一段**伤害 **+1**<br>
      ▽ 脆弱 · 每层使受到的**每一段**伤害 **+7%**（最多 9 层）—— 与易伤是两个不同的乘区：<br>
      <span class="dim">易伤对「多段小伤害」更狠，脆弱对「单发大伤害」更狠</span><br>
      ↓ 虚弱 · 每层使造成的**每一段**伤害 **-1**（每段至少留 1）<br>
      ❄ 冰霜 · 集满转化为 1 层冰冻（小怪 4 / 精英 7 / 玩家 4 / Boss 9 层）<br>
      ❄ 冰冻 · 怪物跳过整次行动；**玩家则本回合能量减半**<br>
      ⬆ 力量 · 每次攻击 +N 伤害<br>
      ✦ 敏捷 · 每次获得护甲 +N<br>
      ✹ 荆棘 · 被近战攻击时反弹伤害<br>
      ◈ 抵挡 · 免疫接下来 N 次减益<br><br>
      <b>地图</b>：每层选一条路往上走。🔥 营火回血或升级卡牌，🏪 商店买卡和遗物，💀 精英给遗物但很硬。<br>
      <b>深层机制</b>：敌人招式里可能有 ⚠ 标记 —— <b>护甲溶解</b>（出招前先吞你一半护甲）、
      <b>能量掠夺</b>（夺走你当前能量），它们的意图气泡里会写明，记得先看一眼。<br>
      <span class="dim">进度自动保存在本地，随时可以关掉浏览器。</span>
    </div>`,
    buttons: [{ label: '知道了', cls: 'primary' }],
  });
}

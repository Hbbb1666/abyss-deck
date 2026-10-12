import { el, clear, $, $$, sleep, fxFloat, shake, toast, clamp } from '../core/util.js';
import { G, save, relicMods, hydrate } from '../core/state.js';
import { RELICS } from '../data/relics.js';
import { CARDS, makeCard, RARITY, TYPE_LABEL } from '../data/cards.js';
import { ST, stText } from '../core/battle.js';
import { sfx } from '../core/audio.js';
import { cardEl, hpBar, updateHpBar, statusRow, SPR, relicEl, bindTip, onLongPress, modal, screenFlash, pickCards, fitAllCards } from './widgets.js';

/**
 * 构建战斗界面，并把 view 回调挂到 B 上
 * onFinish(result) 在战斗结束时调用
 */
export function battleScene(B, { onFinish, onQuit, resumed }) {
  const root = el('div', { class: 'screen battle' });

  /* ---------- 顶栏 ---------- */
  const topbar = el('div', { class: 'topbar' });
  const avatar = el('div', { class: 'avatar', style: { backgroundImage: `url(${SPR(classSprite())})` } });
  const hpWrap = el('div', { class: 'grow' });
  const playerBar = hpBar(B.player.hp, B.player.maxHp, B.player.block);
  hpWrap.append(playerBar);
  const goldStat = el('div', { class: 'stat' }, el('span', { class: 'ico', style: { backgroundImage: `url(${SPR('key_gold')})` } }), el('span', { class: 'gold', text: G.gold }));
  const floorStat = el('div', { class: 'stat', html: `<span class="dim">第</span>${G.act}<span class="dim">层</span>` });
  const btnDeck = el('button', { class: 'btn sm ghost', text: '卡组', onClick: () => showDeck() });
  const btnMenu = el('button', { class: 'btn sm ghost', text: '≡', onClick: () => pauseMenu() });
  topbar.append(avatar, hpWrap, goldStat, floorStat, btnDeck, btnMenu);

  /* ---------- 遗物条 ---------- */
  const relicbar = el('div', { class: 'relicbar' });
  const rebuildRelics = () => {
    clear(relicbar);
    for (const id of G.relics) relicbar.append(relicEl(id));
    if (!G.relics.length) relicbar.append(el('span', { class: 'tiny dim', text: '（暂无遗物）' }));
  };
  rebuildRelics();

  /* ---------- 药水条 ---------- */
  const potionBar = el('div', { class: 'relicbar potionbar' });
  const rebuildPotions = () => {
    clear(potionBar);
    if (!G.potions.length) {
      potionBar.append(el('span', { class: 'tiny dim', text: '（没有药水）' }));
      return;
    }
    G.potions.forEach((p, i) => {
      const n = el('div', {
        class: 'relic potion',
        style: { backgroundImage: `url(${SPR(p.sprite)})`, width: '32px', height: '32px' },
      });
      bindTip(n, () => `<div class="tname">${p.name}</div>${p.text}<br><span class="dim tiny">点击使用（本回合免费）</span>`);
      n.addEventListener('click', () => usePotion(i));
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
    const size = Math.round(76 * (e.body || 1));
    const sprite = el('div', {
      class: 'sprite',
      style: {
        backgroundImage: `url(${SPR(e.sprite)})`,
        width: size + 'px', height: size + 'px',
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
  const playerSprite = el('div', { class: 'player-sprite', style: { backgroundImage: `url(${SPR(classSprite())})` } });
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
    refs.intent.className = 'intent ' + cls;
    refs.intent.innerHTML = `<span>${txt}</span>`;
    bindTipOnce(refs.intent, () => `<div class="tname">${it.name}</div>` + intentDesc(it));
  }

  function bindTipOnce(node, fn) {
    if (node._tipped) return;
    node._tipped = true;
    bindTip(node, fn);
  }

  function intentDesc(it) {
    const p = [];
    if (it.dmg) p.push(`将造成 <b>${it.dmg}</b> 点伤害${it.hits > 1 ? ` × ${it.hits} 次` : ''}`);
    if (it.blk) p.push(`将获得 <b>${it.blk}</b> 点护甲`);
    if (it.intent === 'buff') p.push('将强化自身');
    if (it.intent === 'debuff' || it.intent === 'attack_debuff') p.push('将施加负面状态');
    if (it.intent === 'heal') p.push('将回复生命');
    if (it.intent === 'unknown') p.push('意图不明');
    return p.join('<br>');
  }

  function renderEnemy(e) {
    const refs = enemyNodes.get(e.uid);
    if (!refs) return;
    updateHpBar(refs.ebar, Math.max(0, e.hp), e.maxHp, e.block);
    const s = statusRow(e);
    refs.sts.replaceWith(s);
    refs.sts = s;
    if (e.dead) refs.node.classList.add('dead');
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
  addEventListener('resize', () => requestAnimationFrame(layoutHand));

  let selectedTarget = null;
  function sync() {
    for (const e of B.enemies) renderEnemy(e);
    persist();
    renderPlayer();
    renderHand();
    renderCounts();
    if (potionBar.childElementCount !== Math.max(1, G.potions.length)) rebuildPotions();
    for (const e of B.aliveEnemies()) renderIntent(e);
    endTurnBtn.classList.toggle('disabled', busy || finished);
    goldStat.querySelector('.gold').textContent = G.gold;
  }

  /* ================= 交互 ================= */
  function onCardTap(card, node) {
    if (busy || finished) return;
    if (card.unplayable) { sfx.error(); toast('这张牌不能被打出'); return; }
    if (!B.canPlay(card)) { sfx.error(); shake(node); toast('能量不足'); return; }

    const alive = B.aliveEnemies();
    const needTarget = card.target === 'enemy' && alive.length > 1;
    if (!needTarget) {
      // 需要选目标但只有一个敌人，直接打
      play(card, alive[0]);
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
        职业：${({ knight: '铁誓骑士', mage: '流亡法师', rogue: '暗巷游侠' })[G.cls]}<br>
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
  addEventListener('beforeunload', () => { try { persist(true); } catch {} });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { try { persist(true); } catch {} } });
  addEventListener('pagehide', () => { try { persist(true); } catch {} });

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
      sync();
      toast(`${e.name} 出现了！`, 1100);
    },
    // 出牌结束 / 回合切换：立刻存一次，保证"刚打完一张牌就关页面"不会丢
    afterAction() { persist(true); },
    onDeath(e) {
      const refs = enemyNodes.get(e.uid);
      if (refs) refs.node.classList.add('dead');
      sfx.bell();
    },
    onVanish(e) {
      const refs = enemyNodes.get(e.uid);
      if (refs) refs.node.classList.add('dead');
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
function classSprite() { return { knight: 'hero_knight', mage: 'hero_mage', rogue: 'hero_rogue' }[G.cls] || 'hero_knight'; }

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
      ☠ 中毒 · 回合开始掉血，无视护甲<br>
      ✸ 易伤 · 受到伤害 +50%<br>
      ↓ 虚弱 · 造成伤害 -25%<br>
      ⬆ 力量 · 每次攻击 +N 伤害<br>
      ✦ 敏捷 · 获得的护甲 +N<br>
      ✹ 荆棘 · 被近战攻击时反弹伤害<br><br>
      <b>地图</b>：每层选一条路往上走。🔥 营火回血或升级卡牌，🏪 商店买卡和遗物，💀 精英给遗物但很硬。<br>
      <span class="dim">进度自动保存在本地，随时可以关掉浏览器。</span>
    </div>`,
    buttons: [{ label: '知道了', cls: 'primary' }],
  });
}

import { el, clear, sleep, toast, fxFloat } from '../core/util.js';
import { gainGold, G, save, addRelic, addPotion, addCardToDeck, removeCardAt, upgradeCardAt, rollCardChoices, rollRelic, rollPotion, relicMods, hydrate, gainMaxHp } from '../core/state.js';
import { CARDS, makeCard, rewardPool, RARITY } from '../data/cards.js';
import { RELICS } from '../data/relics.js';
import { POTIONS } from '../data/potions.js';
import { EVENTS } from '../data/events.js';
import { sfx } from '../core/audio.js';
import { cardEl, modal, pickCards, pickPotionToReplace, SPR, relicEl, bindTip, hpBar, updateHpBar, fitAllCards, GOLD_ICON, goldIcon } from './widgets.js';
import { showHelp, deckBody } from './scene-battle.js';

function topbar(title, { onBack } = {}) {
  return el('div', { class: 'topbar' },
    onBack ? el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }) : el('div', { style: { width: '38px' } }),
    el('div', { class: 'grow', style: { textAlign: 'center' }, html: `<span class="gold">${title}</span>` }),
    el('button', { class: 'btn sm ghost', text: '卡组', onClick: () => { sfx.open(); modal({ title: `当前卡组（${G.deck.length} 张）`, closable: true, body: deckBody(), buttons: [{ label: '关闭', cls: 'primary' }] }); } }),
  );
}

/**
 * 血量条 + 金币。注意必须能刷新 ——
 * 买东西会扣血上限、营火会回血，这些栏位如果只在进场景时渲染一次，
 * 玩家就会看到"数字变了但血条没动"。凡是改动 G 的操作都要调 strip.refresh()。
 */
function statusStrip() {
  const bar = hpBar(G.hp, G.maxHp, 0);
  const goldNum = el('span', { class: 'goldAmt', text: String(G.gold) });
  const node = el('div', { class: 'row gap8', style: { padding: '6px 10px' } },
    bar,
    el('div', { class: 'stat' }, goldIcon(), goldNum));
  node.refresh = () => {
    updateHpBar(bar, Math.max(0, G.hp), G.maxHp, 0);
    goldNum.textContent = String(G.gold);
  };
  return node;
}

/* =====================================================================
   战斗奖励
   ===================================================================== */
export function rewardScene(kind, { onDone }) {
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 12px 12px' } });
  const rwStrip = statusStrip();
  root.append(topbar(kind === 'boss' ? '击败首领！' : kind === 'elite' ? '击败精英！' : '战斗胜利'), rwStrip);

  const goldAmt = kind === 'boss' ? 90 + G.act * 25 : kind === 'elite' ? 45 + G.act * 12 : 18 + G.rng.int(6, 14);
  const bonus = relicMods().battleGold || 0;
  const total = goldAmt + bonus;
  gainGold(total);
  if (kind === 'boss') G.stats.bosses++;
  else if (kind === 'elite') G.stats.elites++;
  save();

  const cards = rollCardChoices(3 + (relicMods().cardChoice || 0));
  const relicId = (kind === 'elite' || kind === 'boss') ? rollRelic(kind === 'boss' ? ['rare', 'boss'] : ['common', 'uncommon', 'rare']) : null;
  const potion = G.rng.chance(kind === 'battle' ? 0.42 : 0.6) ? rollPotion() : null;

  const got = el('div', { class: 'col gap6', style: { padding: '10px 12px 2px' } });
  got.append(el('div', { class: 'row gap6 small', html: `${GOLD_ICON} 获得 <b>${total}</b> 金币${bonus ? ` <span class="dim">(含遗物 +${bonus})</span>` : ''}` }));
  body.append(got);

  /* --- 遗物 --- */
  if (relicId) {
    addRelic(relicId);
    const r = RELICS[relicId];
    body.append(el('div', { class: 'small gold', style: { margin: '12px 0 6px' }, text: '获得遗物' }));
    const box = el('div', { class: 'row gap8', style: { background: '#ffcc5210', border: '2px solid #ffcc5240', borderRadius: '6px', padding: '10px' } },
      el('div', { class: 'relic', style: { width: '38px', height: '38px', backgroundImage: `url(${SPR(r.sprite)})`, flex: 'none' } }),
      el('div', { class: 'col gap4' }, el('div', { class: 'gold', text: r.name }), el('div', { class: 'tiny dim', html: r.desc })));
    body.append(box);
    sfx.bell();
    save();
  }

  /* --- 药水 --- */
  if (potion && G.potions.length < G.potionSlots) {
    addPotion(potion);
    body.append(el('div', { class: 'small gold', style: { margin: '12px 0 6px' }, text: '获得药水' }));
    body.append(el('div', { class: 'row gap8', style: { background: '#7ee78710', border: '2px solid #7ee78740', borderRadius: '6px', padding: '10px' } },
      el('div', { class: 'relic', style: { width: '38px', height: '38px', backgroundImage: `url(${SPR(potion.sprite)})`, flex: 'none' } }),
      el('div', { class: 'col gap4' }, el('div', { style: { color: '#7ee787' }, text: potion.name }), el('div', { class: 'tiny dim', html: potion.text }))));
    save();
  } else if (potion) {
    body.append(el('div', { class: 'tiny dim', style: { marginTop: '10px' }, text: '药水槽已满，错过了这次掉落。' }));
  }
  rwStrip.refresh();   // 拿到的遗物可能改了最大生命（比如「贪婪之心」）

  /* --- 选牌 --- */
  let picked = false;
  body.append(el('div', { class: 'small gold', style: { margin: '14px 0 6px' }, text: '选择一张卡牌加入卡组' }));
  const grid = el('div', { class: 'deck-grid' });
  const cont = el('button', { class: 'btn primary block mt16', text: '继续前进 →', onClick: () => { sfx.confirm(); onDone(); } });
  cont.classList.add('disabled');
  const skip = el('button', { class: 'btn ghost block mt8', text: '都不要，直接前进', onClick: () => { sfx.back(); onDone(); } });

  const nodes = cards.map(c => {
    const node = cardEl(makeCard(c.id), {
      onClick: () => {
        if (picked) return;
        picked = true;
        addCardToDeck(c.id);
        save();
        sfx.place();
        node.classList.add('selected');
        toast(`「${CARDS[c.id].name}」已加入卡组`);
        cont.classList.remove('disabled');
        skip.classList.add('disabled');
      },
    });
    return node;
  });
  nodes.forEach(n => grid.append(n));
  body.append(grid, cont, skip);

  root.append(body);
  return root;
}

/* =====================================================================
   商店
   ===================================================================== */
export function shopScene({ onDone }) {
  const mods = relicMods();
  const discount = mods.shopDiscount || 0;
  // 难度「奸商」：所有商品涨价（在遗物折扣之后乘，两者可以同时存在）
  const priceMult = (mods.shopPriceMult || 1);
  const price = p => Math.max(1, Math.round(p * (1 - discount) * priceMult));
  // 难度「药水禁令」：药水栏整个不出现
  const noPotion = !!mods.shopNoPotion;
  // 难度「奸商」：本次进店最多只能移除 1 张
  const removeLimit = mods.shopRemoveLimit || Infinity;
  // 增益「熟人折扣」：卡牌栏里有一张 5 折
  const hasHalfCard = !!mods.shopHalfCard;
  // 难度「诅咒缠身」：进店就往卡组塞一张诅咒（只塞一次）
  const curseOnShop = !!mods.curseOnShop;
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 12px 12px' } });
  const shopStrip = statusStrip();
  root.append(topbar('商店', {}), shopStrip);

  // 商品
  const cardStock = rollCardChoices(5).map((c, i) => ({ ...c, half: hasHalfCard && i === 0, price: 0 }));
  for (const c of cardStock) c.price = Math.max(1, Math.round(price(cardPrice(c)) * (c.half ? 0.5 : 1)));
  const relicStock = (() => {
    const out = [];
    for (let i = 0; i < 2; i++) {
      const r = rollRelic(['common', 'uncommon', 'rare']);
      if (r && !out.some(x => x.id === r)) out.push({ id: r, price: price(relicPrice(r)) });
    }
    return out;
  })();
  const potionStock = noPotion ? [] : (() => {
    const out = [];
    for (let i = 0; i < 3; i++) { const p = rollPotion(); if (!out.some(x => x.id === p.id)) out.push({ ...p, price: price(p.price) }); }
    return out;
  })();

  // 进店塞诅咒（不占商品位、不可拒绝 —— 这正是这条难度的代价）
  let curseMsg = '';
  if (curseOnShop) {
    const cid = G.rng.pick(['curse_wound', 'curse_pain', 'curse_regret']);
    addCardToDeck(cid);
    curseMsg = `「诅咒缠身」：一张「${CARDS[cid].name}」被塞进了你的卡组`;
    save();
  }

  // 移除卡牌：同一次进店每移除一张涨 50 金（75 / 125 / 175…）。
  // 难度「奸商」把次数限制到 1 次。
  let removalsThisVisit = 0;
  const removePriceOf = () => price(75 + removalsThisVisit * 50);
  const removeLeft = () => Math.max(0, removeLimit - removalsThisVisit);

  function cardPrice(c) {
    // 加防护：老存档里的卡 id 可能已经不存在了，不能因为查不到稀有度就崩
    const r = CARDS[c.id] && CARDS[c.id].rarity;
    return { common: 50, uncommon: 80, rare: 130 }[r] || 60;
  }
  function relicPrice(id) {
    const r = RELICS[id] && RELICS[id].rarity;
    return { common: 150, uncommon: 200, rare: 280, boss: 340 }[r] || 160;
  }

  function section(title) { return el('div', { class: 'small gold', style: { margin: '14px 0 8px' }, text: title }); }

  function rerender() {
    clear(body);
    if (discount) body.append(el('div', { class: 'tiny dim', style: { paddingTop: '10px' }, html: `「商人徽章」生效中：价格已降低 <b>${Math.round(discount * 100)}%</b>` }));
    if (priceMult !== 1) body.append(el('div', { class: 'tiny', style: { paddingTop: '10px', color: '#ff8a8a' }, html: `难度「奸商」生效中：所有商品涨价 <b>${Math.round((priceMult - 1) * 100)}%</b>` }));
    if (curseMsg) body.append(el('div', { class: 'tiny', style: { paddingTop: '6px', color: '#c07bff' }, html: curseMsg }));
    /* 卡牌 */
    body.append(section('卡牌'));
    const cg = el('div', { class: 'shop-grid' });
    for (const c of cardStock) {
      if (c.bought) { cg.append(el('div', { class: 'reward-card gone' }, cardEl(makeCard(c.id)))); continue; }
      const node = cardEl(makeCard(c.id));
      const price_ = el('div', { class: 'price' + (G.gold < c.price ? ' cant' : ''), html: `${c.half ? '<span style="color:#7ee787">5折</span> ' : ''}${GOLD_ICON}${c.price}` });
      const wrap = el('div', { class: 'reward-card' }, node, price_);
      node.addEventListener('click', () => buy(c.price, () => { c.bought = true; addCardToDeck(c.id); toast(`买下了「${CARDS[c.id].name}」`); }, rerender));
      cg.append(wrap);
    }
    body.append(cg);

    /* 遗物 */
    if (relicStock.length) {
      body.append(section('遗物'));
      const rg = el('div', { class: 'col gap8' });
      for (const r of relicStock) {
        if (r.bought) { continue; }
        const info = RELICS[r.id];
        const row = el('div', { class: 'row gap8', style: { border: '2px solid #ffcc5230', borderRadius: '6px', padding: '8px', background: '#ffcc5208' } },
          el('div', { class: 'relic', style: { width: '36px', height: '36px', backgroundImage: `url(${SPR(info.sprite)})`, flex: 'none' } }),
          el('div', { class: 'grow col' }, el('div', { class: 'gold small', text: info.name }), el('div', { class: 'tiny dim', html: info.desc })),
          el('div', { class: 'price' + (G.gold < r.price ? ' cant' : ''), html: `${GOLD_ICON}${r.price}` }));
        row.addEventListener('click', () => buy(r.price, () => { r.bought = true; addRelic(r.id); toast(`获得遗物「${info.name}」`); sfx.bell(); }, rerender));
        rg.append(row);
      }
      body.append(rg);
    }

    /* 药水 */
    if (potionStock.length) {
      body.append(section('药水'));
      const pg = el('div', { class: 'col gap8' });
      for (const p of potionStock) {
        if (p.bought) continue;
        const row = el('div', { class: 'row gap8', style: { border: '2px solid #7ee78730', borderRadius: '6px', padding: '8px', background: '#7ee78708' } },
          el('div', { class: 'relic', style: { width: '36px', height: '36px', backgroundImage: `url(${SPR(p.sprite)})`, flex: 'none' } }),
          el('div', { class: 'grow col' }, el('div', { class: 'small', style: { color: '#7ee787' }, text: p.name }), el('div', { class: 'tiny dim', html: p.text })),
          el('div', { class: 'price' + (G.gold < p.price ? ' cant' : ''), html: `${GOLD_ICON}${p.price}` }));
        row.addEventListener('click', () => {
          const applyNew = () => { p.bought = true; addPotion({ ...p }); toast(`买下了「${p.name}」`); };
          if (G.potions.length < G.potionSlots) { buy(p.price, applyNew, rerender); return; }
          // 槽满了：先让玩家挑一瓶替换（能看到效果），选完再走 buy 扣钱。
          // buy() 的 apply 是同步的，塞不进等待玩家的弹窗，所以判断必须提到前面。
          if (G.gold < p.price) { sfx.error(); toast('金币不够'); return; }
          pickPotionToReplace(G.potions, { ...p }, (idx) => {
            buy(p.price, () => {
              const old = G.potions[idx];
              G.potions[idx] = { ...p };
              p.bought = true;
              toast(`用「${p.name}」替换了「${old.name}」`, 1600);
            }, rerender);
          });
        });
        pg.append(row);
      }
      body.append(pg);
    }

    /* 移除卡牌（可重复） */
    body.append(section('服务'));
    const rmPrice = removePriceOf();
    const outOfRemovals = removeLeft() <= 0;
    const rmHint = outOfRemovals
      ? `本次进店已用完（难度「奸商」限 ${removeLimit} 次）`
      : removeLimit !== Infinity
        ? `把碍事的牌从卡组里拿掉 · 本次还可移除 ${removeLeft()} 次`
        : removalsThisVisit ? `本次已移除 ${removalsThisVisit} 张 · 可以继续移除` : '把碍事的牌从卡组里拿掉 · 可重复购买';
    const rm = el('div', { class: 'row gap8', style: { border: '2px solid #ffffff18', borderRadius: '6px', padding: '8px', opacity: outOfRemovals ? '.45' : '1' } },
      el('div', { class: 'relic', style: { width: '36px', height: '36px', backgroundImage: `url(${SPR('coil')})`, flex: 'none' } }),
      el('div', { class: 'grow col' },
        el('div', { class: 'small', text: '移除一张卡牌' }),
        el('div', { class: 'tiny dim', text: rmHint })),
      el('div', { class: 'price' + (G.gold < rmPrice || outOfRemovals ? ' cant' : ''), html: `${GOLD_ICON}${rmPrice}` }));
    rm.addEventListener('click', () => {
      if (outOfRemovals) { sfx.error(); toast(`难度「奸商」：本次进店最多只能移除 ${removeLimit} 张`, 1800); return; }
      if (G.gold < rmPrice) { sfx.error(); toast('金币不够'); return; }
      pickCards(G.deck.map(e => makeCard(e.id, e.up)), {
        n: 1, title: '移除一张卡牌', hint: '选中的牌会永久离开你的卡组',
        onDone: sel => {
          if (!sel) return;
          const target = G.deck.findIndex(e => e.id === sel[0].id && e.up === !!sel[0].upgraded);
          if (target < 0) return;
          G.gold -= rmPrice;
          removeCardAt(target);
          G._removes = (G._removes || 0) + 1;
          removalsThisVisit++;
          save();
          sfx.place(); toast(`移除了「<b>${CARDS[sel[0].id].name}</b>」`, 1500);
          rerender();
        },
      });
    });
    body.append(rm);

    body.append(el('button', { class: 'btn primary block', style: { marginTop: '18px' }, text: '离开商店 →', onClick: () => { sfx.door(); onDone(); } }));
    shopStrip.refresh();
    // 买完会整块重建卡牌 —— 新卡是刚创建的，必须重算卡面字号，
    // 否则它们会停在默认字号，长文案被 .ctext{overflow:hidden} 直接裁掉。
    // （go() 只在首次进入场景时统一适配一次，管不到这里。）
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => fitAllCards(body));
  }

  function buy(cost, apply, after) {
    if (G.gold < cost) { sfx.error(); toast('金币不够'); return; }
    if (apply() === false) return;
    G.gold -= cost;
    sfx.coin();
    save();
    after();
  }

  root.append(body);
  rerender();
  return root;
}

/* =====================================================================
   随机事件
   ===================================================================== */
/**
 * 事件场景。
 *   ev  —— 可传入指定事件（每层的开场事件走这条路）；不传就随机抽一个。
 *   intro —— true 时是「开场事件」，标题与继续按钮的文案不同。
 */
export function eventScene({ onDone, onFight, ev: givenEv, intro } = {}) {
  const ev = givenEv || G.rng.pick(EVENTS);
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 14px 14px' } });
  const evStrip = statusStrip();
  root.append(topbar(intro ? `第 ${ev.act} 层 · ${ev.name}` : '事件', {}), evStrip);

  body.append(el('div', { class: 'col center', style: { padding: '10px 0' } },
    el('div', { style: { width: '76px', height: '76px', backgroundImage: `url(${SPR(ev.art)})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'drop-shadow(0 4px 6px #0008)' } }),
    el('div', { class: 'gold', style: { fontSize: '18px', marginTop: '8px' }, text: ev.name }),
  ));
  body.append(el('div', { class: 'small', style: { lineHeight: '1.8', color: '#d8cfc0', padding: '6px 2px 14px' }, text: ev.text }));

  const log = [];
  const logBox = el('div', { class: 'col gap4', style: { marginBottom: '10px' } });
  body.append(logBox);

  const optWrap = el('div', { class: 'col gap8' });
  body.append(optWrap);

  let done = false;
  const cont = el('button', { class: 'btn primary block mt16', text: intro ? `进入第 ${ev.act} 层 →` : '继续前进 →', onClick: () => { sfx.confirm(); onDone(); } });
  cont.classList.add('disabled');
  body.append(cont);

  const api = {
    rng: () => G.rng(),
    heal: n => { const b = G.hp; G.hp = Math.min(G.maxHp, G.hp + n); log.push(`回复了 <b>${G.hp - b}</b> 点生命`); },
    damage: n => { G.hp = Math.max(0, G.hp - n); log.push(`失去了 <b>${n}</b> 点生命`); },
    maxHp: n => { gainMaxHp(n); log.push(n > 0 ? `最大生命 <b>+${n}</b>（当前生命同步 +${n}）` : `最大生命 <b>${n}</b>`); },
    gold: n => { const g = gainGold(n); log.push(n >= 0 ? `获得 <b>${g}</b> 金币` : `失去 <b>${-g}</b> 金币`); },
    addRelic: id => { const r = id || rollRelic(['common', 'uncommon', 'rare', 'boss']); if (!r) return; addRelic(r); log.push(`获得遗物「<b>${RELICS[r].name}</b>」`); },
    addPotion: id => { const p = id ? { ...POTIONS[id] } : rollPotion(); if (G.potions.length >= G.potionSlots) { log.push('<span class="dim">药水槽已满，没能拿上</span>'); return; } addPotion(p); log.push(`获得药水「<b>${p.name}</b>」`); },
    addCard: id => { const cid = id || G.rng.pick(rewardPool(G.cls)).id; addCardToDeck(cid); log.push(`获得卡牌「<b>${CARDS[cid].name}</b>」`); },
    addCurse: id => { const cid = id || G.rng.pick(['curse_wound', 'curse_pain', 'curse_regret']); addCardToDeck(cid); log.push(`获得诅咒「<b>${CARDS[cid].name}</b>」`); },
    randomRelic: pool => rollRelic(pool || ['common', 'uncommon', 'rare']),
    randomCard: (rs) => G.rng.pick(rewardPool(G.cls, rs || ['common', 'uncommon', 'rare'])).id,
    removeCard: () => new Promise(res => {
      pickCards(G.deck.map(e => makeCard(e.id, e.up)), {
        n: 1, title: '移除一张卡牌',
        onDone: sel => {
          if (sel) {
            const t = G.deck.findIndex(e => e.id === sel[0].id && e.up === !!sel[0].upgraded);
            if (t >= 0) { removeCardAt(t); log.push(`移除了「<b>${CARDS[sel[0].id].name}</b>」`); }
          } else log.push('<span class="dim">取消了选择</span>');
          res();
        },
      });
    }),
    upgradeCard: () => new Promise(res => {
      const cand = G.deck.filter(e => CARDS[e.id].up && !e.up);
      if (!cand.length) { log.push('<span class="dim">没有可以升级的卡牌</span>'); return res(); }
      pickCards(cand.map(e => makeCard(e.id, e.up ? false : false)), {
        n: 1, title: '升级一张卡牌', hint: '仅显示可升级的卡牌',
        onDone: sel => {
          if (sel) {
            const t = G.deck.findIndex(e => e.id === sel[0].id && CARDS[e.id].up && !e.up);
            if (t >= 0) { upgradeCardAt(t); log.push(`升级了「<b>${CARDS[G.deck[t].id].name}</b>」`); }
          } else log.push('<span class="dim">取消了选择</span>');
          res();
        },
      });
    }),
    transformCard: () => new Promise(res => {
      pickCards(G.deck.map(e => makeCard(e.id, e.up)), {
        n: 1, title: '变化一张卡牌',
        onDone: sel => {
          if (sel) {
            const t = G.deck.findIndex(e => e.id === sel[0].id && e.up === !!sel[0].upgraded);
            if (t >= 0) {
              const old = CARDS[G.deck[t].id];
              const pool = rewardPool(G.cls, [old.rarity === 'basic' ? 'common' : old.rarity]).filter(c => c.id !== old.id);
              if (pool.length) { const nc = G.rng.pick(pool); G.deck[t] = { id: nc.id, up: false }; log.push(`「<b>${old.name}</b>」变成了「<b>${nc.name}</b>」`); }
            }
          } else log.push('<span class="dim">取消了选择</span>');
          res();
        },
      });
    }),
    upgradeBasics: () => { let n = 0; for (const e of G.deck) if ((e.id === 'strike' || e.id === 'defend') && CARDS[e.id].up && !e.up) { e.up = true; n++; } log.push(n ? `升级了 <b>${n}</b> 张基础牌` : '<span class="dim">没有可升级的基础牌</span>'); },
    fightElite: () => { onFight(); },
  };

  const finishOpt = () => {
    done = true;
    clear(optWrap);
    clear(logBox);
    for (const l of log) logBox.append(el('div', { class: 'small', html: '· ' + l }));
    save();
    evStrip.refresh();      // 事件会改血量/上限/金币，必须刷新
    cont.classList.remove('disabled');
    if (G.hp <= 0) { toast('你倒下了…'); }
  };

  for (const o of ev.options) {
    const available = !o.req || o.req(G);
    const btn = el('button', { class: 'btn block', style: { textAlign: 'left', justifyContent: 'flex-start', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '10px 12px' } },
      el('span', { text: o.label }),
      el('span', { class: 'tiny dim', html: o.desc || '' }));
    if (!available) btn.classList.add('disabled');
    btn.addEventListener('click', async () => {
      if (done) return;
      sfx.confirm();
      const r = o.run(G, api);
      if (r && typeof r.then === 'function') await r;
      finishOpt();
    });
    optWrap.append(btn);
  }

  root.append(body);
  return root;
}

/* =====================================================================
   营火
   ===================================================================== */
export function restScene({ onDone }) {
  const mods = relicMods();
  // 难度「冷掉的余烬」：营火治疗量降低 50%
  const healMult = mods.restHealMult || 1;
  // 增益「血之献祭」：多出一个"花 5 点生命换随机遗物"的选项
  const hpForRelic = !!mods.restHpForRelic;
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 14px 14px' } });
  const restStrip = statusStrip();
  root.append(topbar('营火', {}), restStrip);

  body.append(el('div', { class: 'col center', style: { padding: '14px 0' } },
    el('div', { style: { width: '80px', height: '80px', backgroundImage: `url(${SPR('torch')})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'drop-shadow(0 0 18px #ff9a3c80)' } }),
    el('div', { class: 'small dim', style: { marginTop: '10px', textAlign: 'center', lineHeight: '1.8' }, html: '篝火噼啪作响。<br>你可以在这里歇一会儿。' }),
  ));

  const healAmt = Math.floor(G.maxHp * 0.3 * healMult);
  const opts = el('div', { class: 'col gap8' });
  const cont = el('button', { class: 'btn primary block mt16', text: '继续前进 →', onClick: () => { sfx.confirm(); onDone(); } });
  cont.classList.add('disabled');
  let used = false;

  /** 一行可点选项 */
  const option = (label, desc, fn, disabled) => {
    const b = el('button', {
      class: 'btn block' + (disabled ? ' disabled' : ''),
      style: { textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: '2px', padding: '10px 12px' },
    }, el('span', { text: label }), el('span', { class: 'tiny dim', html: desc }));
    if (!disabled) b.addEventListener('click', () => { if (used) return; used = true; sfx.confirm(); fn(); done(); });
    return b;
  };

  const done = () => {
    clear(opts);
    opts.append(el('div', { class: 'small gold', style: { textAlign: 'center', padding: '8px' }, text: '休息完毕。' }));
    cont.classList.remove('disabled');
    restStrip.refresh();
  };

  const doRest = () => {
    const before = G.hp;
    G.hp = Math.min(G.maxHp, G.hp + healAmt);
    toast(`回复了 <b>${G.hp - before}</b> 点生命`, 1500);
    save();
  };

  const doForge = () => {
    const upgradable = G.deck.filter(e => CARDS[e.id].up && !e.up);
    if (!upgradable.length) { toast('没有可升级的卡牌'); used = false; return; }
    pickCards(upgradable.map(e => makeCard(e.id)), {
      n: 1,
      title: '升级一张卡牌',
      hint: '卡面显示的是<b style="color:#7ee787">升级后</b>的效果，确认后该牌就变为此形态',
      cardBadge: '↑ 升级后',
      renderCard: c => makeCard(c.id, true),   // 直接渲染升级后的卡面，方便对比判断
      onDone: sel => {
        if (!sel) { used = false; return; }     // 取消：把选择权还给玩家
        const t = G.deck.findIndex(e => e.id === sel[0].id && CARDS[e.id].up && !e.up);
        if (t >= 0) { upgradeCardAt(t); sfx.mining(); toast(`「${CARDS[sel[0].id].name}」升级了！`, 1600); save(); }
      },
    });
  };

  const render = () => {
    clear(opts);
    if (used) { done(); return; }
    const upgradable = G.deck.filter(e => CARDS[e.id].up && !e.up);
    opts.append(option('🔥 休息', `回复 <b>${healAmt}</b> 点生命（当前 ${G.hp}/${G.maxHp}）${healMult !== 1 ? '<span style="color:#ff8a8a"> · 难度减半</span>' : ''}`, doRest, G.hp >= G.maxHp));
    opts.append(option('⚒ 锻造', upgradable.length ? `升级一张卡牌（可升级 <b>${upgradable.length}</b> 张）` : '<span class="dim">没有可升级的卡牌</span>', doForge, !upgradable.length));
    // 增益「血之献祭」：花 5 点生命换随机遗物（血不足 6 点时禁用 —— 不能把自己扣死）
    if (hpForRelic) {
      const canPay = G.hp > 5;
      opts.append(option('🩸 血之献祭',
        canPay ? '消耗 <b>5</b> 点生命，获得一件<b>随机遗物</b>' : '<span class="dim">生命不足，无法献祭</span>',
        doBloodPact, !canPay));
    }
  };

  const doBloodPact = () => {
    G.hp = Math.max(1, G.hp - 5);          // 至少留 1 点，别让"献祭"把自己变成尸体
    const id = rollRelic(['common', 'uncommon', 'rare']);
    if (id) { addRelic(id); toast(`献出 5 点生命，获得「<b>${RELICS[id].name}</b>」`, 1800); sfx.bell(); }
    else { gainGold(50); toast('已经没有可拿的遗物了，改为获得 50 金币', 1800); }
    save();
  };

  render();
  body.append(opts, cont);
  root.append(body);
  return root;
}

/* =====================================================================
   宝箱
   ===================================================================== */
export function treasureScene({ onDone }) {
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 14px 14px' } });
  const trStrip = statusStrip();
  root.append(topbar('宝箱', {}), trStrip);

  const roll = G.rng();
  let title, html;
  if (roll < 0.42) {
    const id = rollRelic(['common', 'uncommon', 'rare']);
    if (id) { addRelic(id); const r = RELICS[id];
      title = `获得遗物：${r.name}`; html = `<div class="tiny dim">${r.desc}</div>`; sfx.bell(); }
    else { const g = gainGold(60 + G.act * 20); title = `获得 ${g} 金币`; html = ''; sfx.coin(); }
  } else if (roll < 0.75) {
    const g = gainGold(55 + G.act * 22 + G.rng.int(0, 30));
    title = `获得 ${g} 金币`; html = ''; sfx.coin();
  } else {
    const p = rollPotion();
    if (G.potions.length < G.potionSlots) { addPotion(p); title = `获得药水：${p.name}`; html = `<div class="tiny dim">${p.text}</div>`; sfx.confirm(); }
    else { const g = gainGold(45); title = `药水槽已满，改拿 ${g} 金币`; html = ''; sfx.coin(); }
  }
  save();
  trStrip.refresh();   // 遗物可能改了最大生命

  body.append(el('div', { class: 'col center', style: { padding: '20px 0' } },
    el('div', { style: { width: '84px', height: '84px', backgroundImage: `url(${SPR('chest_gold')})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'drop-shadow(0 0 16px #6ee7a860)' } }),
    el('div', { class: 'gold', style: { fontSize: '17px', marginTop: '12px', textAlign: 'center' }, text: title }),
    el('div', { style: { marginTop: '6px', textAlign: 'center' }, html }),
  ));
  body.append(el('button', { class: 'btn primary block', text: '继续前进 →', onClick: () => { sfx.confirm(); onDone(); } }));
  root.append(body);
  return root;
}

import { el, clear, sleep, toast } from '../core/util.js';
import { G, hasSave, loadSave, clearSave, loadMeta, newRun } from '../core/state.js';
import { CLASS_LIST, CLASSES, className } from '../data/classes.js';
import { scoreOf, scoreLabel } from '../data/difficulty.js';
import { RELICS } from '../data/relics.js';
import { sfx } from '../core/audio.js';
import { SPR, modal, relicEl, bindTip, GOLD_ICON } from './widgets.js';
import { showHelp } from './scene-battle.js';
import { installable, canPrompt, promptInstall, isIOS, iosHint, onInstallStateChange, isStandalone } from '../core/pwa.js';

export function menuScene({ onNew, onContinue }) {
  const root = el('div', { class: 'screen title-screen' });
  const meta = loadMeta();

  root.append(
    el('div', { class: 'game-title', html: '深渊牌局' }),
    el('div', { class: 'game-sub', text: 'ABYSS  DECK' }),
    el('div', {
      class: 'small dim', style: { maxWidth: '300px', margin: '10px 0 18px', lineHeight: '1.7' },
      html: '一副卡组，一条不归路。<br>每走一层，都要在三张牌里挑一张。',
    }),
  );

  const col = el('div', { class: 'col gap8', style: { width: '100%', maxWidth: '300px' } });
  if (hasSave()) {
    col.append(el('button', { class: 'btn primary block', html: '▶ 继续游戏', onClick: () => { sfx.confirm(); onContinue(); } }));
  }
  col.append(el('button', {
    class: 'btn ' + (hasSave() ? '' : 'primary') + ' block',
    html: hasSave() ? '✦ 新的冒险' : '▶ 开始游戏',
    onClick: () => {
      sfx.confirm();
      if (hasSave()) modal({
        title: '开始新的一局？', body: '<div style="text-align:center">当前进度会被覆盖。</div>',
        buttons: [{ label: '取消', cls: 'ghost' }, { label: '开始', cls: 'primary', onClick: () => { clearSave(); onNew(); } }],
      });
      else onNew();
    },
  }));
  col.append(el('button', { class: 'btn ghost block', html: '? 玩法说明', onClick: () => { sfx.click(); showHelp(); } }));

  /* ---- 装到桌面 ---- */
  const installBtn = el('button', {
    class: 'btn ghost block', html: '📲 安装到桌面',
    onClick: async () => {
      sfx.click();
      if (canPrompt()) {
        const ok = await promptInstall();
        if (ok) { toast('已安装，可以从桌面直接打开', 2000); installBtn.remove(); }
        else toast('取消了安装');
      } else {
        modal({
          title: '安装到桌面', closable: true,
          body: `<div class="small" style="line-height:1.9;text-align:center">
            装到桌面后可以<b>全屏打开</b>、<b>离线游玩</b>，和真 App 一样。<br><br>
            ${isIOS()
              ? 'iPhone / iPad：' + iosHint()
              : '在浏览器菜单里找「<b>安装应用</b>」或「<b>添加到主屏幕</b>」'}
          </div>`,
          buttons: [{ label: '知道了', cls: 'primary' }],
        });
      }
    },
  });
  const syncInstall = () => {
    if (installable()) { if (!installBtn.isConnected) col.insertBefore(installBtn, col.firstChild); }
    else installBtn.remove();
  };
  syncInstall();
  onInstallStateChange(syncInstall);
  col.append(el('div', {
    class: 'tiny dim', style: { textAlign: 'center', marginTop: '8px', lineHeight: '1.8' },
    html: `通关 <b>${meta.wins}</b> 次 · 出发 <b>${meta.runs}</b> 次 · 最深 <b>${meta.best}</b> 层<br>累计击杀 <b>${meta.totalKills}</b>`,
  }));
  root.append(col);
  root.append(el('div', { class: 'tiny dim', style: { position: 'absolute', bottom: '10px', left: 0, right: 0, textAlign: 'center' }, html: '美术 / 音效：Kenney（CC0）· 字体：Fusion Pixel（OFL）' }));
  return root;
}

/* ---------------- 新手 / 老手（整条流程的第一步） ----------------
   点「新的冒险」后先问这一句。两个分支完全不同：
     新手 → 铁誓骑士直接开局（跳过难度与职业）
     老手 → 先选难度与增益，再选职业（职业按难度分**解锁**）
   ⚠️ 询问必须排在**职业之前**：职业解锁的门槛是难度分（`CLASSES[].unlockScore`），
   而分数要先在难度页选出来 —— 顺序反了就没法解锁。
   ⚠️ 只在**从未通关过**时才问（见 main.js 的 beginNewRun）：通关过一次之后
   一律默认老手、直接进难度页 —— 那时玩家已经熟悉规则，再问只是多一次点击。 */
export function veteranScene({ onNovice, onVeteran, onBack }) {
  const meta = loadMeta();
  const root = el('div', { class: 'screen' });
  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }),
    el('div', { class: 'grow', style: { textAlign: 'center' }, html: '<span class="gold">你是新手还是老手？</span>' }),
    el('div', { style: { width: '38px' } })));

  const body = el('div', { class: 'scroll grow col gap12', style: { padding: '14px' } });
  body.append(el('div', { class: 'col center', style: { padding: '10px 0 2px' } },
    el('div', { style: { width: '58px', height: '58px', backgroundImage: `url(${SPR('portal')})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'drop-shadow(0 4px 6px #0008)' } }),
    el('div', { class: 'small dim', style: { marginTop: '6px', textAlign: 'center', lineHeight: '1.7' }, html: '一副卡组，一条不归路。' }),
  ));

  const pick = (label, desc, hint, onClick, highlight) => {
    const b = el('button', {
      class: 'btn block',
      style: { textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start', gap: '3px', padding: '12px 14px', borderColor: highlight ? '#ffcc5260' : undefined },
    },
      el('span', { class: highlight ? 'gold' : '', text: label }),
      el('span', { class: 'tiny dim', html: desc }),
      el('span', { class: 'tiny', style: { color: '#8fa8c0', marginTop: '2px' }, text: hint }),
    );
    b.addEventListener('click', () => { sfx.confirm(); onClick(); });
    return b;
  };

  body.append(
    pick('🌱 我是新手', '还没通关过，想先熟悉规则。<br>用<b>铁誓骑士</b>直接开始（标准难度）。',
      '跳过难度与职业选择，玩法与原版一致', onNovice),
    pick('⚔ 我是老手', '已经熟悉这套玩法，想自己调难度。<br>先选<b>难度与增益</b>，再选职业。',
      '难度分越高，能解锁的职业越多', onVeteran, true),
  );

  if (meta.runs > 0 && !meta.wins) {
    body.append(el('div', { class: 'tiny dim', style: { textAlign: 'center', padding: '4px' },
      html: `你已经尝试过 <b>${meta.runs}</b> 局但还没通关。<br>随时可以改主意 —— 老手也能只选 0 条难度（依旧是标准难度）。` }));
  }

  root.append(body);
  return root;
}

/* ---------------- 选职业 ---------------- */
export function classScene({ picks = [], onPick, onBack }) {
  // 难度分在这一步**已经选好了**（难度页排在前面），职业按它解锁
  const score = scoreOf(picks);
  const root = el('div', { class: 'screen' });
  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }),
    el('div', { class: 'grow', style: { textAlign: 'center' },
      html: `<span class="gold">选择你的职业</span> <span class="tiny dim">当前难度 <b class="gold">${score > 0 ? '+' : ''}${score}</b> 分</span>` }),
    el('div', { style: { width: '38px' } })));

  // 6 个职业一屏放不下：列表本身要能滚（.screen 是 overflow:hidden）
  const list = el('div', { class: 'col gap8 scroll', style: { padding: '12px 14px' } });
  for (const c of CLASS_LIST) {
    const card = el('div', { class: 'class-card' },
      el('div', { class: 'cspr', style: { backgroundImage: `url(${SPR(c.sprite)})` } }),
      el('div', { class: 'grow col gap4' },
        el('div', { class: 'row gap6' }, el('span', { class: 'cname2', text: c.name }), el('span', { class: 'tiny dim', text: c.tagline })),
        el('div', { class: 'tiny dim', html: c.desc }),
        el('div', { class: 'row gap8 tiny', style: { marginTop: '3px' } },
          el('span', { html: `<span style="color:#d94b3f">♥</span> ${c.hp}` }),
          el('span', { html: `${GOLD_ICON} ${c.gold}` }),
          el('span', { class: 'dim', text: '10 张起始卡组' }),
        ),
        // 起始遗物：每个职业都把自己的那件写出来（图标 + 名称 + 效果）。
        // 以前只写"10 张起始卡组"，玩家选职业时根本不知道会带什么遗物。
        (() => {
          const r = RELICS[c.relic];
          if (!r) return null;
          return el('div', { class: 'crelic row gap6' },
            el('div', { class: 'relic', style: { width: '19px', height: '19px', backgroundImage: `url(${SPR(r.sprite)})` } }),
            el('div', { class: 'grow tiny', html: `<b class="crelic-name">${r.name}</b> ${r.desc}` }),
          );
        })(),

      ),
    );
    // 难度分不够 → 置灰、显示门槛、点不动。
    // ⚠️ `alwaysUnlocked` 的职业（铁誓骑士）**跳过这整套判定**：
    // 增益拉满时总分是 **−40**，而骑士门槛是 0，`0 > −40` 会把骑士也锁掉 ——
    // 8 个职业全锁、游戏直接进不去（2026-10-13 实测）。
    const need = c.unlockScore || 0;
    if (!c.alwaysUnlocked && need > score) {
      card.classList.add('locked');
      card.append(el('div', { class: 'locknote', text: `🔒 需要 ${need} 难度分` }));
      card.addEventListener('click', () => {
        sfx.back();
        toast(`「${c.name}」需要 <b>${need}</b> 难度分才能选（当前 ${score}）`, 2200);
      });
    } else {
      card.addEventListener('click', () => { sfx.confirm(); onPick(c.id); });
    }
    list.append(card);
  }
  root.append(list);
  return root;
}

/* ---------------- 结算 ---------------- */
export function endScene(result, { onMenu, onRetry }) {
  const win = result === 'win';
  const root = el('div', { class: 'screen end-screen' });

  /* ⚠️ 这两行**必须在** root.append 之前 —— JS 的 `const` 有暂时性死区（TDZ），
     而下面那个模板字符串是**立即求值**的。以前它们写在 append 之后，于是
     `ReferenceError: Cannot access 'sc' before initialization` 会在渲染时抛出：
     `go('end')` 抛错 → 新界面根本没被挂上去 → **玩家卡在上一屏，通关结算界面出不来**
     （2026-10-13 产品实测报的"最终 Boss 通关后卡死"就是这个）。
     教训：模板字符串里的变量一定要先声明；把 `const` 写在用它之后，
     读起来像"先渲染再补充"，实际是**先崩溃**。 */
  const sc = scoreOf(G.picks || []);
  const picks = (G.picks && G.picks.length)
    ? `<span class="dim"> · 已选 ${G.picks.length} 条</span>`
    : `<span class="dim"> · 标准难度（未选任何条目）</span>`;

  root.append(
    el('div', { class: 'end-title ' + (win ? 'win' : 'lose'), text: win ? '通 关' : '陨 落' }),
    el('div', { class: 'dim small', text: win ? '你击败了深渊之主，牌局结束了。' : '你的牌局到此为止。' }),
    el('div', {
      class: 'small', style: { margin: '14px 0', lineHeight: '2', textAlign: 'center' },
      html: `职业：<b>${className(G.cls)}</b><br>
        抵达：第 <b>${G.act}</b> 层 · 通过 <b>${G.stats.floors}</b> 个房间<br>
        击杀 <b>${G.stats.kills}</b> 个敌人（精英 ${G.stats.elites} · Boss ${G.stats.bosses}）<br>
        打出 <b>${G.stats.cardsPlayed}</b> 张牌 · 造成 <b>${G.stats.dmgDealt}</b> 伤害<br>
        最终卡组 <b>${G.deck.length}</b> 张 · 遗物 <b>${G.relics.length}</b> 件<br>
        本局难度分：<b class="gold">${sc > 0 ? '+' : ''}${sc}</b> <span class="dim">（${scoreLabel(sc)}）</span>${picks}`,
    }),
  );
  const col = el('div', { class: 'col gap8', style: { width: '100%', maxWidth: '280px' } });
  col.append(el('button', { class: 'btn primary block', html: '↻ 再来一局', onClick: () => { sfx.confirm(); onRetry(); } }));
  col.append(el('button', { class: 'btn ghost block', html: '返回主菜单', onClick: () => { sfx.back(); onMenu(); } }));
  root.append(col);
  return root;
}

import { el, clear, sleep, toast } from '../core/util.js';
import { G, hasSave, loadSave, clearSave, loadMeta, newRun } from '../core/state.js';
import { CLASS_LIST, CLASSES, className } from '../data/classes.js';
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

/* ---------------- 选职业 ---------------- */
export function classScene({ onPick, onBack }) {
  const root = el('div', { class: 'screen' });
  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }),
    el('div', { class: 'grow', style: { textAlign: 'center' }, html: '<span class="gold">选择你的职业</span>' }),
    el('div', { style: { width: '38px' } })));

  // 5 个职业之后一屏放不下了：列表本身要能滚（.screen 是 overflow:hidden）
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
    card.addEventListener('click', () => { sfx.confirm(); onPick(c.id); });
    list.append(card);
  }
  root.append(list);
  return root;
}

/* ---------------- 新手 / 老手 ----------------
   选完职业后问一句。两个按钮的分支完全不同：
     新手 → 直接进地图（0 分标准难度，不接触难度系统）
     老手 → 进难度积分界面
   ⚠️ 只在**从未通关过**时才问（见 main.js 的 askOrSkip）。通关过一次之后
   一律当老手处理、直接进难度界面 —— 那时玩家已经熟悉规则，再问是多余的点击。 */
export function veteranScene({ clsId, onNovice, onVeteran, onBack }) {
  const cls = CLASSES[clsId];
  const meta = loadMeta();
  const root = el('div', { class: 'screen' });
  root.append(el('div', { class: 'topbar' },
    el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }),
    el('div', { class: 'grow', style: { textAlign: 'center' }, html: '<span class="gold">你是新手还是老手？</span>' }),
    el('div', { style: { width: '38px' } })));

  const body = el('div', { class: 'scroll grow col gap12', style: { padding: '14px' } });
  body.append(el('div', { class: 'col center', style: { padding: '6px 0 2px' } },
    el('div', { style: { width: '58px', height: '58px', backgroundImage: `url(${SPR(cls.sprite)})`, backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center', filter: 'drop-shadow(0 4px 6px #0008)' } }),
    el('div', { class: 'small dim', style: { marginTop: '6px' }, text: `${cls.name} · ${cls.tagline}` }),
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
    pick('🌱 我是新手', '还没通关过，想先熟悉规则。<br>直接开始，<b>标准难度</b>。',
      '不接触难度系统，玩法与原版一致', onNovice),
    pick('⚔ 我是老手', '已经熟悉这套玩法，想自己调难度。<br>进入<b>难度与增益</b>选择。',
      '难度 +9 分／增益 −4 分，最多选 10 条', onVeteran, true),
  );

  // 给个"跳过询问"的提示 —— 通关过一次后这里就不再出现了
  if (meta.runs > 0 && !meta.wins) {
    body.append(el('div', { class: 'tiny dim', style: { textAlign: 'center', padding: '4px' },
      html: `你已经尝试过 <b>${meta.runs}</b> 局但还没通关。<br>任何时候都可以改主意 —— 老手也能只选 0 条难度。` }));
  }

  root.append(body);
  return root;
}

/* ---------------- 结算 ---------------- */
export function endScene(result, { onMenu, onRetry }) {
  const win = result === 'win';
  const root = el('div', { class: 'screen end-screen' });
  root.append(
    el('div', { class: 'end-title ' + (win ? 'win' : 'lose'), text: win ? '通 关' : '陨 落' }),
    el('div', { class: 'dim small', text: win ? '你击败了深渊之主，牌局结束了。' : '你的牌局到此为止。' }),
    el('div', {
      class: 'small', style: { margin: '14px 0', lineHeight: '2', textAlign: 'center' },
      html: `职业：<b>${className(G.cls)}</b><br>
        抵达：第 <b>${G.act}</b> 层 · 通过 <b>${G.stats.floors}</b> 个房间<br>
        击杀 <b>${G.stats.kills}</b> 个敌人（精英 ${G.stats.elites} · Boss ${G.stats.bosses}）<br>
        打出 <b>${G.stats.cardsPlayed}</b> 张牌 · 造成 <b>${G.stats.dmgDealt}</b> 伤害<br>
        最终卡组 <b>${G.deck.length}</b> 张 · 遗物 <b>${G.relics.length}</b> 件`,
    }),
  );
  const col = el('div', { class: 'col gap8', style: { width: '100%', maxWidth: '280px' } });
  col.append(el('button', { class: 'btn primary block', html: '↻ 再来一局', onClick: () => { sfx.confirm(); onRetry(); } }));
  col.append(el('button', { class: 'btn ghost block', html: '返回主菜单', onClick: () => { sfx.back(); onMenu(); } }));
  root.append(col);
  return root;
}

import { el, clear, sleep, toast } from '../core/util.js';
import { G, hasSave, loadSave, clearSave, loadMeta, newRun } from '../core/state.js';
import { CLASS_LIST, CLASSES, className } from '../data/classes.js';
import { RELICS } from '../data/relics.js';
import { sfx } from '../core/audio.js';
import { SPR, modal, relicEl, bindTip } from './widgets.js';
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

  const list = el('div', { class: 'col gap12', style: { padding: '14px' } });
  for (const c of CLASS_LIST) {
    const card = el('div', { class: 'class-card' },
      el('div', { class: 'cspr', style: { backgroundImage: `url(${SPR(c.sprite)})` } }),
      el('div', { class: 'grow col gap4' },
        el('div', { class: 'row gap6' }, el('span', { class: 'cname2', text: c.name }), el('span', { class: 'tiny dim', text: c.tagline })),
        el('div', { class: 'tiny dim', html: c.desc }),
        el('div', { class: 'row gap8 tiny', style: { marginTop: '3px' } },
          el('span', { html: `<span style="color:#d94b3f">♥</span> ${c.hp}` }),
          el('span', { html: `<span style="color:#ffcc52">◉</span> ${c.gold}` }),
          el('span', { class: 'dim', text: '10 张起始卡组' }),
        ),
      ),
    );
    card.addEventListener('click', () => { sfx.confirm(); onPick(c.id); });
    list.append(card);
  }
  root.append(list);
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

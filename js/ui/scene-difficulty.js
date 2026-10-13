/**
 * 难度选择界面
 * =====================================================================
 * 流程中的位置：**老手路径的第一步**（新手直接骑士开局，不进这里）。
 * 它只负责选出 picks，选完交给职业页 —— 职业按这一页的**难度分**解锁。
 * 左侧/上方是**难度规则**（每条 +9 分），下方是**增益**（每条 −4 分），最多共 10 条。
 * 底部实时显示当前总分与档位（0 分 = 标准难度）。
 *
 * 设计取舍：
 *   · 不做成"难度等级 1/2/3"，而是**自由勾选** —— 玩家可以只挑自己觉得公平的代价，
 *     比如"要钱不要命"（选涨价 + 增益加血），这比选一个整体难度更有表达空间。
 *   · 分数是**加减法**，实时可算 —— 玩家勾的时候立刻知道自己选了多重，
 *     不用等到结算。
 */
import { el, clear, toast } from '../core/util.js';
import { G, loadMeta } from '../core/state.js';
import { DIFFICULTY, BOONS, DIFF_POINTS, BOON_POINTS, MAX_PICKS, scoreOf, scoreLabel, splitPicks, pickById } from '../data/difficulty.js';
import { sfx } from '../core/audio.js';
import { SPR, modal } from './widgets.js';

export function difficultyScene({ picks = [], onStart, onBack }) {
  // 难度页现在排在**职业页之前**（产品要求），所以这里不再接收职业 id，也不再读 G.cls。
  // 它只负责选出 picks，选完交给职业页（职业按难度分解锁）。
  const meta = loadMeta();
  const root = el('div', { class: 'screen' });
  const body = el('div', { class: 'scroll grow', style: { padding: '0 12px 12px' } });

  const topbar = el('div', { class: 'topbar' },
    el('button', { class: 'btn sm ghost', text: '←', onClick: () => { sfx.back(); onBack(); } }),
    el('div', { class: 'grow', style: { textAlign: 'center' }, html: '<span class="gold">选择难度与增益</span>' }),
    el('div', { style: { width: '38px' } }),
  );
  root.append(topbar);

  /** 已选中的 id（顺序无关）。
      从职业页点「返回」过来时带着上一次的选择 —— 回来一看全空了会很难受。 */
  const picked = new Set(picks.filter(id => pickById(id)));

  /* ---------- 顶部说明 ---------- */
  body.append(el('div', {
    class: 'tiny dim', style: { padding: '10px 2px 6px', lineHeight: '1.8' },
    html: `难度规则每条 <b style="color:#ff8a8a">+${DIFF_POINTS}</b> 分，增益每条 <b style="color:#7ee787">${BOON_POINTS}</b> 分；<b>最多选 ${MAX_PICKS} 条</b>。<br>不选任何条目就是 <b>0 分标准难度</b>。<br><b class="gold">难度分决定你能选哪些职业</b>（骑士永远可选）。<br>` +
      (meta.bestWinScore ? `你通关过的最高分：<b class="gold">${meta.bestWinScore}</b>` : ''),
  }));

  /* ---------- 实时分数条 ---------- */
  const scoreBox = el('div', { class: 'row gap8', style: { padding: '8px 10px', background: '#ffffff08', borderRadius: '6px', marginBottom: '8px', alignItems: 'center' } });
  const scoreNum = el('div', { class: 'gold', style: { fontSize: '20px', minWidth: '52px' } });
  const scoreTag = el('div', { class: 'grow' });
  const scoreCnt = el('div', { class: 'tiny dim' });
  scoreBox.append(scoreNum, scoreTag, scoreCnt);
  body.append(scoreBox);

  /* ---------- 分组渲染 ---------- */
  function row(item, kind) {
    const isDiff = kind === 'd';
    const pts = isDiff ? DIFF_POINTS : BOON_POINTS;
    const btn = el('button', {
      class: 'btn block',
      style: {
        textAlign: 'left', flexDirection: 'column', alignItems: 'flex-start',
        gap: '2px', padding: '9px 11px', borderColor: picked.has(item.id) ? (isDiff ? '#ff6b8a' : '#7ee787') : undefined,
      },
    },
      el('div', { class: 'row gap6', style: { alignItems: 'baseline' } },
        el('span', { class: 'grow', text: item.name }),
        el('span', {
          class: 'tiny',
          style: { color: isDiff ? '#ff8a8a' : '#7ee787', flex: 'none' },
          text: `${pts > 0 ? '+' : ''}${pts}`,
        }),
        el('span', { class: 'tiny', style: { color: picked.has(item.id) ? (isDiff ? '#ff8a8a' : '#7ee787') : '#ffffff30', flex: 'none' }, text: picked.has(item.id) ? '✔' : '○' }),
      ),
      el('span', { class: 'tiny dim', html: item.desc }),
    );
    btn.addEventListener('click', () => {
      if (picked.has(item.id)) { picked.delete(item.id); sfx.back(); }
      else {
        if (picked.size >= MAX_PICKS) { sfx.error(); toast(`最多只能选 ${MAX_PICKS} 条`, 1600); return; }
        picked.add(item.id); sfx.confirm();
      }
      refresh();
    });
    return btn;
  }

  function refresh() {
    const ids = [...picked];
    const sc = scoreOf(ids);
    scoreNum.textContent = `${sc > 0 ? '+' : ''}${sc}`;
    scoreTag.innerHTML = `<b>${scoreLabel(sc)}</b> <span class="dim tiny">${ids.length ? `已选 ${ids.length} 条` : '标准难度'}</span>`;
    scoreCnt.innerHTML = `<span class="dim">难度 ${splitPicks(ids).difficulty.length} · 增益 ${splitPicks(ids).boons.length}</span>`;
    // 重画两组（勾选态与分值都要刷新）
    clear(diffWrap);
    for (const it of DIFFICULTY) diffWrap.append(row(it, 'd'));
    clear(boonWrap);
    for (const it of BOONS) boonWrap.append(row(it, 'b'));
  }

  const sect = (title, hint) => el('div', { style: { margin: '14px 0 8px' } },
    el('div', { class: 'small gold', text: title }),
    el('div', { class: 'tiny dim', html: hint }));

  body.append(sect('难度规则', `每条 <b style="color:#ff8a8a">+${DIFF_POINTS}</b> 分 —— 让你更难，但分值更高`));
  const diffWrap = el('div', { class: 'col gap8' });
  body.append(diffWrap);

  body.append(sect('增益', `每条 <b style="color:#7ee787">${BOON_POINTS}</b> 分 —— 让你更轻松，但会降低分值`));
  const boonWrap = el('div', { class: 'col gap8' });
  body.append(boonWrap);

  /* ---------- 底部按钮 ---------- */
  const startBtn = el('button', {
    class: 'btn primary block', style: { marginTop: '18px' },
    text: '以当前设置出发 →',
    onClick: () => { sfx.door(); onStart([...picked]); },
  });
  const clearBtn = el('button', {
    class: 'btn block', style: { marginTop: '8px' },
    text: '清空（回到 0 分标准难度）',
    onClick: () => { picked.clear(); sfx.back(); refresh(); },
  });
  body.append(startBtn, clearBtn);

  /* ---------- 难度说明帮助 ---------- */
  body.append(el('button', {
    class: 'btn block ghost', style: { marginTop: '8px' },
    text: '这些规则具体怎么生效？',
    onClick: () => modal({
      title: '难度系统说明', closable: true,
      body: el('div', { class: 'col gap8 small', style: { lineHeight: '1.9' } },
        el('div', { html: `· 各条<b>独立生效</b>，可以只挑你认可的代价，不必整套一起选。<br>· 难度分<b>只在通关时记入</b>「通关最高分」—— 没通关的局不改变你的记录。<br>· 选择会写进存档，中途关页面再回来仍然生效。<br>· 基准难度已下调：怪物每层攻击增幅由 <b>20% 降至 15%</b>。` }),
      ),
      buttons: [{ label: '知道了', cls: 'primary' }],
    }),
  }));

  root.append(body);
  refresh();
  return root;
}

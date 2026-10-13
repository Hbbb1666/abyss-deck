/**
 * 价值表报表 / 平衡检查工具
 * =====================================================================
 * 用法：
 *   node tools/balance-report.mjs              # 全部卡牌：超/欠预算清单
 *   node tools/balance-report.mjs knight       # 只看某个职业（含其可用基础牌）
 *   node tools/balance-report.mjs --markdown    # 输出 Markdown 报告（给人工审阅）
 *   node tools/balance-report.mjs --class-pools # 只输出各职业牌池简介
 *
 * 为什么要有这个工具：
 *   `tools/test.mjs` 只守一条线（"不得超预算 2 点以上"），
 *   但它不告诉你**哪张牌欠了多少**、也不方便一次看全职业。
 *   调数值时我要的是"全表 + 每张牌的偏差"，所以单独做成可重复运行的报表。
 *
 * ⚠️ 价值表在 `js/data/values.js`（唯一真源），这里只是它的**展示层**。
 *    不要在报表里另写一份权重。
 */
import { CARDS } from '../js/data/cards.js';
import { CLASS_LIST } from '../js/data/classes.js';
import { valueOf, budgetOf, isModelBlind, VAL, BY_CLASS, PER_STACK, BUDGET } from '../js/data/values.js';

const args = process.argv.slice(2);
const wantMarkdown = args.includes('--markdown');
const onlyPools = args.includes('--class-pools');
const clsFilter = args.find(a => !a.startsWith('--'));

/** 全部可打出的牌（排除诅咒/状态） */
const playable = Object.entries(CARDS)
  .filter(([, c]) => c.type !== 'curse' && c.type !== 'status')
  .map(([id, c]) => ({ id, ...c }));

const val = c => valueOf(c);
const bud = c => budgetOf(c);
const blind = c => isModelBlind(c);

/** 基础牌（无 cls 或 cls==='basic'） */
const isBasic = c => !c.cls || c.cls === 'basic';

/** 某职业的可用池 = 自己的专属牌 + 基础牌 */
function poolOf(clsId) {
  return playable.filter(c => c.cls === clsId || isBasic(c));
}

/* ---------------- 全表偏差 ---------------- */
function reportAll() {
  const rows = playable.map(c => {
    const v = val(c), b = bud(c);
    return { c, v, b, d: v - b, blind: blind(c) };
  });
  const judged = rows.filter(r => !r.blind && r.c.rarity !== 'basic');
  const over = judged.filter(r => r.d > 2).sort((a, x) => x.d - a.d);
  const under = judged.filter(r => r.d < -3).sort((a, x) => a.d - x.d);

  console.log(`可打出卡牌 ${playable.length} 张；参与预算判定 ${judged.length} 张`);
  console.log(`超预算(>+2)：${over.length} 张    欠预算(<-3)：${under.length} 张\n`);

  const fmt = r => `  ${r.c.name.padEnd(6)} ${String(r.c.cost)}费${r.c.rarity.padEnd(9)} ` +
    `${r.v.toFixed(1).padStart(5)}/${String(r.b).padEnd(3)} ${r.d >= 0 ? '▲+' : '▼'}${r.d.toFixed(1)}` +
    `  [${r.c.cls || 'basic'}]`;

  if (over.length) { console.log('=== 超预算（需要削弱/提费）==='); over.forEach(r => console.log(fmt(r))); console.log(''); }
  if (under.length) { console.log('=== 欠预算（可以加强/降价）==='); under.forEach(r => console.log(fmt(r))); console.log(''); }

  // 按职业汇总
  console.log('=== 各职业偏差汇总 ===');
  for (const cls of CLASS_LIST) {
    const mine = judged.filter(r => r.c.cls === cls.id);
    const bad = mine.filter(r => r.d > 2).length;
    const low = mine.filter(r => r.d < -3).length;
    const avg = mine.length ? mine.reduce((s, r) => s + r.d, 0) / mine.length : 0;
    console.log(`  ${cls.name.padEnd(6)} 评 ${String(mine.length).padStart(2)} 张  超 ${bad}  欠 ${low}  平均偏差 ${avg >= 0 ? '+' : ''}${avg.toFixed(2)}`);
  }
}

/* ---------------- 分职业牌池简介（报告用） ---------------- */
function reportPools() {
  for (const cls of CLASS_LIST) {
    const mine = playable.filter(c => c.cls === cls.id);
    console.log(`\n## ${cls.name}`);
    const byCost = {};
    for (const c of mine) (byCost[c.cost] = byCost[c.cost] || []).push(c);
    for (const cost of Object.keys(byCost).sort((a, b) => a - b)) {
      for (const c of byCost[cost]) {
        const v = val(c), b = bud(c);
        const flag = blind(c) ? '  (模型不计)' : `  ${v.toFixed(1)}/${b}`;
        const sig = [...new Set((c.fx || []).map(f => f.t + (f.k ? ':' + f.k : '')))].join(' ');
        console.log(`  ${cost}费 ${c.rarity.padEnd(9)} ${c.name.padEnd(6)}${flag.padEnd(14)} ${sig}`);
      }
    }
  }
}

/* ---------------- Markdown 报告 ---------------- */
function reportMarkdown() {
  const L = [];
  L.push('# 全职业专属牌组审计报告');
  L.push('');
  L.push('> 由 `tools/balance-report.mjs --markdown` 生成。**价值表真源**：`js/data/values.js`。');
  L.push('> 每张牌后面的 `价值/预算` 是"这张牌值多少点 / 它这一档允许多少点"。');
  L.push('');
  L.push('## 价值表');
  L.push('');
  L.push('| 项目 | 价值 | 说明 |');
  L.push('|---|---|---|');
  const note = {
    dmg: '1 伤害', block: '1 护甲', heal: '1 生命', energy: '1 能量',
    draw: '抽 1 张', poison: '中毒 1 层', bleed: '流血 1 层', weak: '虚弱 1 层',
    burn: '点燃 1 层', truth: '真理 1 层', dexterity: '敏捷 1 层',
    thorns: '荆棘 1 层', frost: '冰霜 1 层（仅 ≥2 费寒冰牌）',
    energy_cap: '能量饱和：能量上限 +1', extra_draw: '洞察：每回合多抽 1',
    artifact: '抵挡：免疫 1 次减益', barricade: '壁垒（开关）',
  };
  const statCn = {
    strength: '力量', vulnerable: '易伤', regen: '再生', frail: '脆弱',
    poison_plus: '淬毒（施加中毒时额外 +N 层）', bleed_plus: '血涌（施加流血时额外 +N 层）',
    ritual: '强化（每回合开始 +N 层力量）', block_next: '备战（下回合 +N 护甲）',
  };
  const clsCn = { arcanist: '奥术法师', assassin: '暗影刺客', paladin: '圣骑士', base: '通用' };
  for (const [k, v] of Object.entries(VAL)) L.push(`| ${note[k] || k} | ${v} | |`);
  for (const [k, ov] of Object.entries(BY_CLASS)) {
    const per = Object.entries(ov).filter(([c]) => c !== 'base')
      .map(([c, v]) => `${clsCn[c] || c} ${v}`).join(' / ');
    L.push(`| ${statCn[k] || k} 1 层 | 通用 ${ov.base} | ${per} |`);
  }
  for (const [k, ps] of Object.entries(PER_STACK)) {
    L.push(`| ${statCn[k] || k} | ${ps.base} + ${ps.per}×N | 放大器型（N = 牌上的层数） |`);
  }
  L.push('');
  L.push('> **不参与价值体系**：冰冻、能量枯竭 —— 它们的效果（剥夺一次行动 / 扣下回合能量）');
  L.push('> 无法折成"点数"去和伤害比较，硬定价只会让门禁乱报。');
  L.push('');
  L.push('## 每档预算');
  L.push('');
  L.push('| | 普通 | 蓝(罕见) | 金(稀有) |');
  L.push('|---|---|---|---|');
  for (const cost of [1, 2, 3]) {
    L.push(`| ${cost} 费 | ${BUDGET[`${cost}-common`]} | ${BUDGET[`${cost}-uncommon`]} | ${BUDGET[`${cost}-rare`]} |`);
  }
  L.push('');
  for (const cls of CLASS_LIST) {
    const mine = playable.filter(c => c.cls === cls.id);
    L.push(`## ${cls.name}  `);
    L.push(`专属牌 **${mine.length}** 张（价值/预算；"模型不计"= 该效果无法折成点数）`);
    L.push('');
    const byCost = {};
    for (const c of mine) (byCost[c.cost] = byCost[c.cost] || []).push(c);
    for (const cost of Object.keys(byCost).sort((a, b) => a - b)) {
      for (const c of byCost[cost]) {
        const v = val(c), b = bud(c);
        const d = v - b;
        const flag = blind(c) ? '模型不计' :
          `${v.toFixed(1)}/${b}` + (d > 2 ? ` **超+${d.toFixed(1)}**` : d < -3 ? ` 欠${d.toFixed(1)}` : '');
        L.push(`- \`${cost}费 ${c.rarity}\` **${c.name}** — ${flag}`);
        L.push(`  - ${String(c.text(c)).replace(/<[^>]+>/g, '').replace(/\n/g, ' ')}`);
        L.push(`  - 效果：${(c.fx || []).map(f => f.t + (f.k ? `:${f.k}` : '')).join(', ') || '（无）'}`);
      }
    }
    L.push('');
  }
  console.log(L.join('\n'));
}

if (onlyPools) reportPools();
else if (wantMarkdown) reportMarkdown();
else if (clsFilter) {
  const cls = CLASS_LIST.find(c => c.id === clsFilter);
  if (!cls) { console.error('未知职业:', clsFilter); process.exit(1); }
  console.log(`\n=== ${cls.name} ===`);
  for (const c of poolOf(clsFilter)) {
    const v = val(c), b = bud(c);
    console.log(`  ${String(c.cost)}费 ${c.rarity.padEnd(9)} ${c.name.padEnd(6)} ` +
      `${blind(c) ? '(模型不计)' : `${v.toFixed(1)}/${b} (${(v - b).toFixed(1)})`}`);
  }
} else reportAll();

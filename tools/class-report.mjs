/**
 * 生成「全职业专属牌组简介报告」（给产品人工审阅）
 * 用法：node tools/class-report.mjs > docs/全职业牌组简介.md
 *
 * 和 balance-report.mjs 的分工：
 *   balance-report = 逐张牌的"价值/预算"审计表（查超模用）
 *   class-report   = 按职业讲"这套牌在讲什么故事"（审阅设计用）
 */
import { CARDS } from '../js/data/cards.js';
import { CLASS_LIST } from '../js/data/classes.js';
import { valueOf, budgetOf, isModelBlind, VAL } from '../js/data/values.js';

const L = [];
const playable = Object.entries(CARDS)
  .filter(([, c]) => c.type !== 'curse' && c.type !== 'status')
  .map(([id, c]) => ({ id, ...c }));

const RAR_CN = { basic: '基础', common: '普通', uncommon: '蓝', rare: '金', finisher: '终结' };
const KEY_CN = {
  strength: '力量', dexterity: '敏捷', vulnerable: '易伤', weak: '虚弱', poison: '中毒',
  burn: '点燃', bleed: '流血', frost: '冰霜', freeze: '冰冻', truth: '真理', thorns: '荆棘',
  ritual: '强化', barricade: '壁垒', energy_cap: '能量饱和', extra_draw: '洞察',
  poison_plus: '淬毒', bleed_plus: '血涌', block_next: '备战', regen: '再生', artifact: '抵挡',
};
const cn = k => KEY_CN[k] || k;

/** 把一张牌的 fx 说成人话 */
function describe(c) {
  const parts = [];
  for (const f of (c.fx || [])) {
    const v = typeof f.v === 'number' ? f.v : c[f.v];
    if (f.t === 'dmg') parts.push(`造成 ${c.dmg} 点伤害${(c.hits || 1) > 1 ? ` ×${c.hits}` : ''}`);
    else if (f.t === 'dmgAll') parts.push(`对全体造成 ${c.dmg} 点伤害${(c.hits || 1) > 1 ? ` ×${c.hits}` : ''}`);
    else if (f.t === 'dmgBlock') parts.push(`造成（当前护甲 + ${c.bonus ?? 0}）点伤害`);
    else if (f.t === 'dmgPoison') parts.push(`造成（目标中毒层数 × ${c.mult ?? 2}）点伤害`);
    else if (f.t === 'dmgBleed') parts.push(`造成（目标流血层数 × ${c.mult ?? 2}）点伤害`);
    else if (f.t === 'dmgPerHand') parts.push(`对目标造成（手牌数 × ${c.dmg}）点伤害`);
    else if (f.t === 'dmgPerEnergyMax') parts.push(`造成（能量上限 × ${c.per ?? 3}）点伤害`);
    else if (f.t === 'dmgPerPlayed') parts.push(`造成（本回合已打出牌数 × ${c.per ?? 4}）点伤害`);
    else if (f.t === 'block') parts.push(`获得 ${c.blk} 点护甲`);
    else if (f.t === 'blockFromBlock') parts.push(`获得（当前护甲 × ${c.mult ?? 1}）点护甲`);
    else if (f.t === 'draw') parts.push(`抽 ${c.draw} 张牌`);
    else if (f.t === 'energy') parts.push(`获得 ${c.nrg} 点能量`);
    else if (f.t === 'heal') parts.push(`回复 ${c.heal} 点生命`);
    else if (f.t === 'loseHp') parts.push(`失去 ${c.selfdmg ?? v} 点生命`);
    else if (f.t === 'gold') parts.push(`获得 ${c.gold} 金币`);
    else if (f.t === 'discard') parts.push(`弃 ${typeof f.v === 'number' ? f.v : c.v} 张牌`);
    else if (f.t === 'buff') parts.push(`获得 ${v} 层${cn(f.k)}`);
    else if (f.t === 'debuff') parts.push(`施加 ${v} 层${cn(f.k)}`);
    else if (f.t === 'debuffAll') parts.push(`对全体施加 ${v} 层${cn(f.k)}`);
    else if (f.t === 'detonate') parts.push(`引爆（立即结算一层 DoT）`);
    else parts.push(`${f.t}${f.k ? ':' + cn(f.k) : ''}`);
  }
  return parts.join('，');
}

/** 汇总一个职业"主打什么" */
function themes(mine) {
  const cnt = {};
  for (const c of mine) for (const f of (c.fx || [])) if (f.k) cnt[f.k] = (cnt[f.k] || 0) + 1;
  return Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, n]) => `${cn(k)}×${n}`).join(' · ');
}

L.push('# 全职业专属牌组简介');
L.push('');
L.push('> 按 2026-10-13 的**新价值表**重新配平后的结果。');
L.push('> 真源：`js/data/values.js`；逐张牌的"价值/预算"审计见 [卡牌价值审计.md](\u5361\u724c\u4ef7\u503c\u5ba1\u8ba1.md)。');
L.push('>');
L.push('> **怎么读"价值/预算"**：左边是这张牌按价值表算出来值多少点，右边是它这一档允许的额度。');
L.push('> 两个数接近 = 配平到位；`▲` 表示超、`▼` 表示欠。"模型不计"= 它的效果无法折成点数（如"按护甲结算伤害"）。');
L.push('>');
L.push('> **终结牌**（每职业 1 张）单独成节：费用是 **N**（吃掉当前全部能量）、彩色流光边框、');
L.push('> 有条件门、牌组唯一、出现权重低（约普通牌的 1/6）、参考价值 40。');
L.push('');

/* 价值表速览 */
L.push('## 价值表速览（本次重定的部分加粗）');
L.push('');
L.push(`伤害/护甲/生命 = 1 点 · 能量 = ${VAL.energy} 点 · **抽牌 = ${VAL.draw} 点**`);
L.push(`**中毒/流血/虚弱/点燃 = 3 点** · **敏捷 = ${VAL.dexterity}** · 荆棘 = ${VAL.thorns} · 真理 = ${VAL.truth}`);
L.push(`**冰霜 = ${VAL.frost}**（硬约束：只出现在 ≥2 费的寒冰法师牌上）`);
L.push(`能量饱和 = ${VAL.energy_cap} · **洞察 = ${VAL.extra_draw}** · **抵挡 = ${VAL.artifact}** · 壁垒 = ${VAL.barricade}`);
L.push(`**力量 = 4（奥术法师 6）** · **易伤 = 4（奥术法师 5 / 暗影刺客 3.5）** · 再生 = 4（圣骑士 3.5） · **脆弱 = 4（奥术法师 5）**`);
L.push(`放大器型：淬毒/血涌/强化 = 6 + 2.5×N · 备战 = 2 + 1×N`);
L.push('');

for (const cls of CLASS_LIST) {
  const mine = playable.filter(c => c.cls === cls.id);
  L.push('---');
  L.push('');
  L.push(`## ${cls.name}`);
  L.push('');
  L.push(`**定位**：${cls.tagline}`);
  L.push('');
  L.push(`${cls.desc}`);
  L.push('');
  L.push(`- 生命 ${cls.hp} · 起始金币 ${cls.gold} · 解锁难度分 ${cls.unlockScore}`);
  L.push(`- 专属牌 **${mine.length}** 张（${Object.entries(
    mine.reduce((a, c) => (a[c.rarity] = (a[c.rarity] || 0) + 1, a), {})
  ).map(([r, n]) => `${RAR_CN[r]} ${n}`).join(' / ')}）`);
  L.push(`- 主打状态：${themes(mine)}`);
  L.push(`- 起始卡组：${cls.deck.map(([id, n]) => `${CARDS[id]?.name || id}×${n}`).join(' + ')}`);
  L.push('');

  /* 终结牌单列一节：它的费用是 N、不走普通费用档，混在"3 费"里会让人误以为它是 3 费牌 */
  const fins = mine.filter(c => c.finisher);
  if (fins.length) {
    L.push(`### ⚡ 终结牌（${fins.length} 张 · 费用 N · 牌组唯一 · 低权重）`);
    L.push('');
    for (const f of fins) {
      L.push(`- **${f.name}** — 参考价值 ${valueOf(f).toFixed(1)}/${budgetOf(f)}`);
      L.push(`  - ${describe(f)}`);
      /* 条件文案统一读卡牌自己的 `condText` —— 这里以前也有一份手抄映射表，
         和 UI 那份一起漂移过（真理牌条件 7 层、文案 3 层）。 */
      L.push(`  - **使用条件**：${f.condText || '（见卡面）'}`);
    }
    L.push('');
  }

  const byCost = {};
  for (const c of mine.filter(c => !c.finisher)) (byCost[c.cost] = byCost[c.cost] || []).push(c);
  for (const cost of Object.keys(byCost).sort((a, b) => a - b)) {
    L.push(`### ${cost} 费（${byCost[cost].length} 张）`);
    L.push('');
    for (const c of byCost[cost]) {
      const blind = isModelBlind(c);
      const v = valueOf(c), b = budgetOf(c), d = v - b;
      const tag = blind ? '模型不计'
        : `${v.toFixed(1)}/${b}` + (d > 2 ? ` **超+${d.toFixed(1)}**` : d < -3 ? ` 欠${d.toFixed(1)}` : '');
      L.push(`- **${c.name}**（${RAR_CN[c.rarity]}）— ${tag}`);
      L.push(`  - ${describe(c)}`);
    }
    L.push('');
  }
}

/* 本次改动的牌 */
L.push('---');
L.push('');
L.push('## 附：本次为新价值表而调整的牌');
L.push('');
L.push('> 完整清单见提交信息；这里只列**改动较大、需要重点审阅**的。');
L.push('');
L.push('| 牌 | 职业 | 改动 | 原因 |');
L.push('|---|---|---|---|');
const notes = [
  ['剑柄打击 / 完美格挡 / 闪避 / 雪幕 / 火星迸射 / 暗影步 / 神恩 / 飞刀', '多个', '1 费 → 2 费，主效果补足预算', '抽牌从 2 点涨到 5 点，1 费档（5 点）装不下"伤害/护甲 + 抽牌"'],
  ['连击 / 符文视界', '游侠 / 奥术', '1 费 → 2 费', '抽 2 张 = 10 点，超出 1 费预算'],
  ['急智 / 直觉', '游侠 / 中立', '抽 2 → 抽 1', '0 费只有 5 点预算，装不下抽 2 张'],
  ['壁垒 / 影分身 / 烈焰引擎 / 荆棘之甲', '骑士 / 游侠 / 法师 / 骑士', '3 费金 → 1 费', '它们是"每回合型 / 开关型"牌，按新表只值 6~8 点，3 费金档（26 点）严重欠模'],
  ['寒冰箭 / 深度冻结', '寒冰法师', '1 费 → 2 费，并补强', '**冰霜硬约束**：1 层冰霜值 4.5 点，1 费档装不下'],
  ['不屈 / 余烬分身 / 铁誓 / 影纱 / 最后堡垒', '多职业', '「不屈」状态删除，改为**敏捷**', '产品决定：不屈（每回合开始 +N 护甲）与敏捷（每次获得护甲 +N）实质重复，只留敏捷'],
  ['狂战士', '骑士', '整体重做：改为「+2 力量，每回合再 +1 力量」', '「狂战 / 狂战代价」两个状态被删除'],
  ['飞刀 / 闪避 / 乱影', '游侠', '去掉抽牌，保住 1 费', '游侠的身份是"低费为主"，宁可少抽牌也不升费'],
  ['炼金 / 腐蚀瓦斯 / 瘟疫之瓶 / 大出血 / 剧毒之息 / 血雾', '炼金 / 游侠', 'DoT 层数上调', '中毒/流血从 4 点降到 3 点，同样的预算能带更多层'],
];
for (const [card, cls, chg, why] of notes) L.push(`| ${card} | ${cls} | ${chg} | ${why} |`);
L.push('');

console.log(L.join('\n'));

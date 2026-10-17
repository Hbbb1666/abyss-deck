/* 可证伪验证：按参数复原某一处 bug，看测试能否抓到。
   node tools/falsify.mjs stats   → 去掉 loadSave 的 stats 兜底
   node tools/falsify.mjs guard   → 去掉 go() 的场景兜底
   node tools/falsify.mjs restore → 从备份还原 */
import { readFileSync, writeFileSync, copyFileSync, existsSync, unlinkSync } from 'node:fs';

const R = 'D:/网盘文件/OneDrive/文档/deepseek-harness/default-workspace/abyss-deck/js';
const [what] = process.argv.slice(2);

const FILES = { state: R + '/core/state.js', main: R + '/main.js', battle: R + '/core/battle.js', cards: R + '/data/cards.js', rooms: R + '/ui/scene-rooms.js', enemies: R + '/data/enemies.js', relics: R + '/data/relics.js', classes: R + '/data/classes.js' };
const BAK = {};
for (const k of Object.keys(FILES)) BAK[k] = `C:/Users/Aaron-PC/AppData/Local/Temp/falsify-${k}.bak`;
// README 不在 js/ 下，单独备份一份（readmedoc 用例用）
const README = 'D:/网盘文件/OneDrive/文档/deepseek-harness/default-workspace/abyss-deck/README.md';
const README_BAK = 'C:/Users/Aaron-PC/AppData/Local/Temp/falsify-readme.bak';

/** 备份**当前**文件（每次改坏前都刷新一次）。
 *
 *  ⚠️ 这里以前是 `if (!existsSync(BAK))` —— 只在第一次运行时装一次备份。
 *  那意味着**上一轮遗留的备份会覆盖掉后来所有的手工修改**：
 *  我改完代码后跑一次 `falsify restore`，会把文件退回到几天前那份旧备份去
 *  （2026-10-17 差点真的踩到：%TEMP% 里躺着上一轮会话的 falsify-battle.bak）。
 *  每次备份都刷新，语义就变成"把这一轮改坏前的状态记下来"，restore 永远只回退这一轮。 */
function backup(k) {
  copyFileSync(FILES[k], BAK[k]);
}
function restore() {
  for (const k of Object.keys(FILES)) if (existsSync(BAK[k])) copyFileSync(BAK[k], FILES[k]);
  if (existsSync(README_BAK)) copyFileSync(README_BAK, README);
  console.log('已还原');
}
/** 清理遗留备份。留着它们本身不危险（backup 会刷新），
    但 `existsSync` 一眼看不出是不是这一轮的，容易误判，所以收尾时清掉。 */
function clean() {
  for (const k of Object.keys(FILES)) if (existsSync(BAK[k])) { unlinkSync(BAK[k]); }
  if (existsSync(README_BAK)) unlinkSync(README_BAK);
  console.log('已清理遗留备份');
}

if (what === 'restore') { restore(); }
else if (what === 'clean') { clean(); }
else if (what === 'stats') {
  backup('state');
  const p = FILES.state;
  let s = readFileSync(p, 'utf8');
  const a = "    s.stats = { kills: 0, elites: 0, bosses: 0, floors: 0, cardsPlayed: 0, dmgDealt: 0, dmgTaken: 0, turns: 0, ...(s.stats || {}) };";
  if (!s.includes(a)) throw new Error('没找到 stats 兜底');
  s = s.replace(a, '    /* TEMP 去掉 stats 兜底 */');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉 loadSave 的 stats 兜底');
} else if (what === 'guard') {
  backup('main');
  const p = FILES.main;
  let s = readFileSync(p, 'utf8');
  const a = `    try {
      node = buildScene(name, args);
    } catch (err) {
      // 场景**构造**就抛错（例如模板字符串读了未初始化的变量、数据缺失）
      recordSceneError(name, err);
      node = crashScene(name, err);
    }`;
  if (!s.includes(a)) throw new Error('没找到场景兜底');
  s = s.replace(a, '    node = buildScene(name, args);   // TEMP 去掉兜底');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉 go() 的场景兜底');
} else if (what === 'lowhp') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = `          if (f.ifLowHp != null && this.player.hp * 2 < this.player.maxHp) {
            hit += this.num(f.ifLowHp, card);
          }`;
  if (!s.includes(a)) throw new Error('没找到 ifLowHp 实现');
  s = s.replace(a, '          /* TEMP 去掉 ifLowHp */');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉 ifLowHp 实现（复原"卡面撒谎"）');
} else if (what === 'paldmg') {
  backup('cards');
  const p = R + '/data/cards.js';
  let s = readFileSync(p, 'utf8');
  const a = "art: 'hammer', dmg: 9, heal: 4, up: { dmg: 11, heal: 6 },";
  if (!s.includes(a)) throw new Error('没找到审判');
  s = s.replace(a, "art: 'hammer', dmg: 14, heal: 4, up: { dmg: 16, heal: 6 },");
  writeFileSync(p, s, 'utf8');
  console.log('已把审判伤害改回偏高的 14');
} else if (what === 'evdeath') {
  backup('rooms');
  const p = R + '/ui/scene-rooms.js';
  let s = readFileSync(p, 'utf8');
  const a = `    damage: n => {
      const before = G.hp;
      G.hp = Math.max(1, G.hp - n);`;
  if (!s.includes(a)) throw new Error('没找到事件 damage');
  s = s.replace(a, `    damage: n => {
      const before = G.hp;
      G.hp = Math.max(0, G.hp - n);   // TEMP 复原旧写法（允许扣到 0）`);
  // 同时去掉 finishOpt 里的安全网，才是真正的旧行为
  const b = `    if (G.hp <= 0) {
      console.warn('[abyss] 事件结束后生命 ≤0，已补到 1（战斗外不允许死亡）');
      G.hp = 1;
      save();
    }`;
  if (s.includes(b)) s = s.replace(b, '    /* TEMP 去掉安全网 */');
  writeFileSync(p, s, 'utf8');
  console.log('已复原"事件扣血允许归零"（0 血续玩 bug）');
} else if (what === 'split') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '    if (!target.isPlayer) await this.maybeSplit(target);';
  if (!s.includes(a)) throw new Error('没找到分裂调用');
  s = s.replace(a, '    /* TEMP 去掉分裂 */');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉「分裂」机制');
} else if (what === 'mawfx') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '      if (def.preFx) await this.resolveEnemyFx(def.preFx, e);';
  if (!s.includes(a)) throw new Error('没找到 preFx 调用');
  // 把"出招前吞甲"改成"出招后才吞"—— 等于那一击打在满甲上，机制失效
  s = s.replace(a, '      /* TEMP 去掉 preFx */');
  const b = '      if (def.fx) await this.resolveEnemyFx(def.fx, e);';
  if (!s.includes(b)) throw new Error('没找到 fx 调用');
  s = s.replace(b, '      if (def.preFx) await this.resolveEnemyFx(def.preFx, e);\n      if (def.fx) await this.resolveEnemyFx(def.fx, e);');
  writeFileSync(p, s, 'utf8');
  console.log('已把「吞护甲」挪到出招之后（那一击打在满甲上）');
} else if (what === 'drain') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '          this.energy -= take;';
  if (!s.includes(a)) throw new Error('没找到 drainEnergy 扣能量');
  s = s.replace(a, '          /* TEMP 不扣能量 */');
  writeFileSync(p, s, 'utf8');
  console.log('已让「吸魂」不真的扣能量');
} else if (what === 'bossbrood') {
  backup('enemies');
  const p = R + '/data/enemies.js';
  let s = readFileSync(p, 'utf8');
  const a = "      ascend: { name: '终极宣告', intent: 'unknown', fx: [{ t: 'buff', k: 'strength', v: 5 }] },";
  if (!s.includes(a)) throw new Error('没找到最终 Boss 招式');
  s = s.replace(a, a + "\n      brood: { name: '召唤深渊', intent: 'buff', fx: [{ t: 'summon', id: 'demonling', n: 2 }] },");
  writeFileSync(p, s, 'utf8');
  console.log('已把「召唤小弟」加回最终 Boss');
} else if (what === 'ondamaged') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = "    for (const [, hook] of relicHooks('onDamaged')) { await hook(this, real); }";
  if (!s.includes(a)) throw new Error('没找到 onDamaged 调用');
  s = s.replace(a, '    /* TEMP 不调用 onDamaged（复原"文档写了但引擎从没调过"） */');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉 onDamaged 钩子调用');
} else if (what === 'exhausted') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = "      for (const [, hook] of relicHooks('exhausted')) await hook(this, card);";
  if (!s.includes(a)) throw new Error('没找到 exhausted 调用');
  s = s.replace(a, '      /* TEMP 去掉 exhausted 钩子 */');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉 exhausted 钩子调用');
} else if (what === 'pierce') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '    if (this.mods.pierce && atk === this.player && !target.isPlayer && target.block > 0) {';
  if (!s.includes(a)) throw new Error('没找到 pierce');
  s = s.replace(a, '    if (false) {   // TEMP 去掉破甲');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉「破甲」');
} else if (what === 'powercap') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '    if (opts.hitIndex != null && opts.hitIndex >= POWER_STACK_CAP) {';
  if (!s.includes(a)) throw new Error('没找到力量封顶判断');
  s = s.replace(a, '    if (false) {   // TEMP 去掉多段力量封顶');
  writeFileSync(p, s, 'utf8');
  console.log('已去掉「多段力量封顶」（复原 3 段吃 3 倍力量）');
} else if (what === 'dexenemy') {
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = "    let b = base + this.get(e, 'dexterity');";
  if (!s.includes(a)) throw new Error('没找到 calcBlock 敏捷');
  s = s.replace(a, "    let b = base + (e && e.isPlayer ? this.get(e, 'dexterity') : 0);   // TEMP 只对玩家生效");
  writeFileSync(p, s, 'utf8');
  console.log('已让敏捷只对玩家生效（复原"怪物吃不到敏捷"）');
} else if (what === 'enemydmg') {
  // 把深渊之眼的连环撕裂改回 3 段、并且放大
  backup('enemies');
  const p = R + '/data/enemies.js';
  let s = readFileSync(p, 'utf8');
  const a = 'onslaught:';
  const i = s.indexOf(a);
  if (i < 0) throw new Error('没找到 onslaught');
  const end = s.indexOf('\n', i);
  const line = s.slice(i, end);
  s = s.slice(0, i) + "onslaught: { name: '连环撕裂', intent: 'attack', dmg: 13, hits: 3 }," + s.slice(end);
  writeFileSync(p, s, 'utf8');
  console.log('已把连环撕裂改回 13×3=39（复原超模）');
} else if (what === 'relicsprite') {
  // 把两件遗物改成共用同一张贴图（复原"撞图"）
  backup('relics');
  const p = R + '/data/relics.js';
  let s = readFileSync(p, 'utf8');
  const a = "name: '守护符', sprite: 'r_ward'";
  if (!s.includes(a)) throw new Error('没找到守护符');
  s = s.replace(a, "name: '守护符', sprite: 'r_amulet'");
  writeFileSync(p, s, 'utf8');
  console.log('已让「守护符」蹭「生命护符」的图（复原撞图）');
} else if (what === 'fintip') {
  /* 复原"手抄提示表说谎"：把真理牌的条件文案改回旧的 3 层。
     AH 段要求 condText 的数字 == cond 的真实边界，所以这条应该红。 */
  backup('cards');
  const p = R + '/data/cards.js';
  let s = readFileSync(p, 'utf8');
  const a = "    condText: '需真理 ≥7',";
  if (!s.includes(a)) throw new Error('没找到真理牌的 condText');
  s = s.replace(a, "    condText: '需真理 ≥3',   // TEMP 复原旧文案（条件仍是 7 层）");
  writeFileSync(p, s, 'utf8');
  console.log('已把「终极定理」的提示改回 3 层（条件仍是 7 层 → 文案撒谎）');
} else if (what === 'snapmods') {
  /* 复原"读档丢难度攻击缩放"：applySnapshot 里不带 this.mods。
     AI1 段会红（读档后 atkMult 掉回裸曲线）。 */
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '      const sc = enemyScale(this.act, this.mods);';
  if (!s.includes(a)) throw new Error('没找到 applySnapshot 的 enemyScale');
  s = s.replace(a, '      const sc = enemyScale(this.act);   // TEMP 漏掉难度修正');
  writeFileSync(p, s, 'utf8');
  console.log('已让读档丢掉难度攻击缩放（复原那个 bug）');
} else if (what === 'snapcounters') {
  /* 复原"战斗计数器不进快照"：把它们从 serialize 里删掉。
     AI2 段会红（快照里缺字段 / 读回来是 0）。 */
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = `      potionUsed: !!this.potionUsed,
      potionUsedCount: this.potionUsedCount || 0,
      killCount: this.killCount || 0,
      cardsThisBattle: this.cardsThisBattle || 0,
      cardsThisTurn: this.cardsThisTurn || 0,`;
  if (!s.includes(a)) throw new Error('没找到 serialize 里的计数器');
  s = s.replace(a, '      // TEMP 不存战斗计数器');
  writeFileSync(p, s, 'utf8');
  console.log('已让战斗计数器不进快照（复原那个 bug）');
} else if (what === 'readmedoc') {
  /* 复原"文档数字漂移"：把 README 的职业门槛改回旧的 18。
     AJ4 段会红（README 与 classes.js 不一致）。 */
  if (!existsSync(README_BAK)) copyFileSync(README, README_BAK);
  let s = readFileSync(README, 'utf8');
  if (!s.includes('| 炼金师 | 9 |')) throw new Error('没找到 README 的门槛行');
  s = s.replace('| 炼金师 | 9 |', '| 炼金师 | 18 |');
  writeFileSync(README, s, 'utf8');
  console.log('已把 README 里炼金师的门槛改回 18（数据是 9 → 文档漂移）');
} else if (what === 'cardblock') {
  /* 让「燃烧之血」的护盾加成也作用到**非卡牌**来源（遗物/药水）。
     X6e2 段有两条断言专门盯着这个边界，应该红。 */
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = '    if (opts.fromCard && this.mods.cardBlockMult) {';
  if (!s.includes(a)) throw new Error('没找到 cardBlockMult 判断');
  s = s.replace(a, '    if (this.mods.cardBlockMult) {   // TEMP 不区分来源');
  writeFileSync(p, s, 'utf8');
  console.log('已让护盾加成不再区分来源（复原"药水/遗物也吃加成"）');
} else if (what === 'vulncost') {
  /* 「影刃」不再检查费用（0 费牌也能刷易伤）。
     T 段的"0 费攻击不挂易伤"断言应该红。 */
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = "    if (!this.over && this.mods.vulnOnAttack && card.type === 'attack' && paidCost >= 1) {";
  if (!s.includes(a)) throw new Error('没找到 vulnOnAttack 判断');
  s = s.replace(a, "    if (!this.over && this.mods.vulnOnAttack && card.type === 'attack') {   // TEMP 去掉费用门槛");
  writeFileSync(p, s, 'utf8');
  console.log('已去掉「影刃」的费用 ≥1 门槛（复原 0 费连招牌白刷易伤）');
} else if (what === 'vulntype') {
  /* 「影刃」不再检查牌类型（技能牌命中也能挂）。应该红。 */
  backup('battle');
  const p = R + '/core/battle.js';
  let s = readFileSync(p, 'utf8');
  const a = "    if (!this.over && this.mods.vulnOnAttack && card.type === 'attack' && paidCost >= 1) {";
  if (!s.includes(a)) throw new Error('没找到 vulnOnAttack 判断');
  s = s.replace(a, "    if (!this.over && this.mods.vulnOnAttack && paidCost >= 1) {   // TEMP 不区分攻击/技能");
  writeFileSync(p, s, 'utf8');
  console.log('已让「影刃」对技能牌也生效（复原"只认攻击牌"这条约束的缺失）');
} else if (what === 'palhp') {
  /* 把圣骑士血量改回 73（W4c 段断言应该红）。 */
  backup('classes');
  const p = R + '/data/classes.js';
  let s = readFileSync(p, 'utf8');
  const a = "unlockScore: 9, hp: 70, gold: 99, relic: 'holy_oath',";
  if (!s.includes(a)) throw new Error('没找到圣骑士血量');
  s = s.replace(a, "unlockScore: 9, hp: 73, gold: 99, relic: 'holy_oath',");
  writeFileSync(p, s, 'utf8');
  console.log('已把圣骑士血量改回 73（削弱前的值）');
} else console.log('用法: stats | guard | lowhp | paldmg | evdeath | split | mawfx | drain | bossbrood | ondamaged | exhausted | pierce | powercap | dexenemy | enemydmg | relicsprite | fintip | snapmods | snapcounters | readmedoc | cardblock | vulncost | vulntype | palhp | restore | clean');

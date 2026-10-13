/* 可证伪验证：按参数复原某一处 bug，看测试能否抓到。
   node tools/falsify.mjs stats   → 去掉 loadSave 的 stats 兜底
   node tools/falsify.mjs guard   → 去掉 go() 的场景兜底
   node tools/falsify.mjs restore → 从备份还原 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';

const R = 'D:/网盘文件/OneDrive/文档/deepseek-harness/default-workspace/abyss-deck/js';
const [what] = process.argv.slice(2);

const FILES = { state: R + '/core/state.js', main: R + '/main.js', battle: R + '/core/battle.js', cards: R + '/data/cards.js', rooms: R + '/ui/scene-rooms.js' };
const BAK = {};
for (const k of Object.keys(FILES)) BAK[k] = `C:/Users/Aaron-PC/AppData/Local/Temp/falsify-${k}.bak`;

function backup(k) {
  if (!existsSync(BAK[k])) copyFileSync(FILES[k], BAK[k]);
}
function restore() {
  for (const k of Object.keys(FILES)) if (existsSync(BAK[k])) copyFileSync(BAK[k], FILES[k]);
  console.log('已还原');
}

if (what === 'restore') { restore(); }
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
} else console.log('用法: stats | guard | lowhp | paldmg | evdeath | restore');

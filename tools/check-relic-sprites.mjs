/* 校验 relic-sprites.mjs：每张必须是 16 行 × 每行 16 字符，且只用调色板里有的字符 */
import { PALETTE } from './make-sprites.mjs';
import { RELIC_SPRITES } from './relic-sprites.mjs';

let bad = 0;
for (const [name, rows] of Object.entries(RELIC_SPRITES)) {
  if (rows.length !== 16) {
    console.log(`✗ ${name}: ${rows.length} 行（要 16）`);
    bad++; continue;
  }
  rows.forEach((r, i) => {
    if (r.length !== 16) {
      console.log(`✗ ${name} 第 ${i + 1} 行 ${r.length} 字符（要 16）："${r}"`);
      bad++;
    }
    for (const ch of r) {
      if (ch !== '.' && !PALETTE[ch]) {
        console.log(`✗ ${name} 第 ${i + 1} 行有未知颜色 '${ch}'`);
        bad++;
      }
    }
  });
}
console.log(bad ? `\n共 ${bad} 处问题 / ${Object.keys(RELIC_SPRITES).length} 张` : `✅ 全部 ${Object.keys(RELIC_SPRITES).length} 张都是 16×16，颜色都在调色板里`);
process.exit(bad ? 1 : 0);

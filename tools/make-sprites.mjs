/**
 * 贴图生成器 —— 把「字符地图」渲染成 16×16 PNG
 * =====================================================================
 * 为什么要这么做（而不是直接用画图软件）：
 *   1. **可复现**：贴图是代码产物，改一个像素就是改一个字符，diff 里看得见
 *   2. **可校验**：`tools/test.mjs` 的 S 段会断言「磁盘上的 PNG ≡ 源码渲染结果」，
 *      贴图再也不可能悄悄和源文件不一致
 *   3. **不用额外依赖**：PNG 编码器用 node:zlib 手写（下面 ~30 行），保持仓库纯 Node
 *
 * 用法：
 *   node tools/make-sprites.mjs          # 重新生成所有贴图
 *   import { render, SPRITES } from './make-sprites.mjs'
 *
 * 画法：每个贴图是 16 行、每行 16 个字符；字符 → 颜色见 PALETTE；
 *   `.` = 透明。行数/列数/字符不允许出错（错了会直接抛异常，不会静默画歪）。
 * =====================================================================
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SPRITE_DIR = join(HERE, '..', 'assets', 'sprites');

/**
 * 调色板 —— **全部取自项目原有贴图**（63 张里实际出现的 34 色之一）。
 * 新画的贴图只用这些颜色，保证和现有素材风格完全一致，不会突然冒出"另一个游戏"的颜色。
 */
export const PALETTE = {
  '1': '#3f2631',   // 主描边（项目里用得最多的深色）
  'N': '#262b44',   // 深蓝描边
  'h': '#763b36',   // 暗棕（内部阴影）
  'R': '#e84537',   // 红
  'r': '#ff706d',   // 亮红
  'Y': '#feae34',   // 金
  'y': '#fee761',   // 亮金（瞳孔/高光）
  'G': '#8b9bb4',   // 石灰蓝
  'g': '#c0cbdc',   // 浅灰（受光面）
  's': '#52607c',   // 中灰（背光面）
  'S': '#5a6988',
  'p': '#9b4ca3',   // 紫
  'P': '#64358a',   // 暗紫
  'Q': '#d176d0',   // 亮紫
  'D': '#391f55',   // 最暗紫
  'B': '#0099db',   // 蓝
  'b': '#75e3ff',   // 亮蓝
  'C': '#43e1b3',   // 青绿
  'w': '#ffffff',
  'W': '#e4edf9',
  'o': '#bd6c4a',   // 棕
  'O': '#eaa56c',   // 亮棕
  't': '#f7c282',   // 肤色
  'u': '#e19a65',
};

/* =====================================================================
   贴图定义
   =====================================================================
   只放「重画过」的贴图。没列在这里的贴图保持原样，由生成器原封不动跳过。
   ===================================================================== */
export const SPRITES = {
  /**
   * 深渊魔眼（第 1 层 Boss）—— 一颗带尖刺的巨大红色魔眼。
   * 旧版是一张灰色石面具，和另外两个 Boss 几乎分不出来。
   * 现在用「红」作为它的颜色身份：远远看一眼就知道是它。
   */
  boss_demon: [
    '................',
    '.....111111.....',
    '..11RRRRRRRR11..',
    '.1RRRRRRRRRRRR1.',
    '1RRRRhhhhhhRRRR1',
    '1RRRhhhyyhhhRRR1',
    '1RRRhhhyyhhhRRR1',
    '1RRRhhhyyhhhRRR1',
    '1RRRhhhyyhhhRRR1',
    '1RRRhhhyyhhhRRR1',
    '1RRRRhhhhhhRRRR1',
    '.1RRRRRRRRRRRR1.',
    '..11RRRRRRRR11..',
    '.....111111.....',
    '................',
    '................',
  ],

  /**
   * 石像暴君（第 2 层 Boss）—— 戴金冠的石头暴君头。
   * 「石像」本来就该是灰的，所以保留灰色，改用**金冠**把它和别的 Boss 区分开，
   * 并加受光面/背光面（g/s 两档灰）让它不再是一块平板的灰。
   */
  boss_stone: [
    '................',
    '..y..y..y..y....',
    '.1y1.y1.y1.y1...',
    '.1YyYYyYYyYYy1..',
    '.1YYYggggggYY1..',
    '.1GgggggggggG1..',
    '.1GgggggggggG1..',
    '.1Gg111ggg111g1.',
    '.1Gg1RR1g1RR1g1.',
    '.1Gg111ggg111g1.',
    '.1GgggggggggG1..',
    '.1Gg1111111ggG1.',
    '.1Gg1g1g1g1ggG1.',
    '.1GssssssssgG1..',
    '.1GsssssssssG1..',
    '..11111111111...',
  ],

  /**
   * 深渊之主（第 3 层 Boss）—— 紫色带角的恶魔头领。
   * 用「紫」作为颜色身份。旧版和它的精英怪石像鬼是**同一张图**，玩家根本分不开。
   */
  boss_gargoyle: [
    '................',
    '..1..........1..',
    '.1p1........1p1.',
    '.1pp1......1pp1.',
    '.1ppp111111ppp1.',
    '1pppppppppppppp1',
    '1pppQQQQQQQQppp1',
    '1ppQQ111111QQpp1',
    '1ppQ1RR11RR1Qpp1',
    '1ppQQ111111QQpp1',
    '1pppQQQQQQQQppp1',
    '1pppppppppppppp1',
    '.1ppp111111ppp1.',
    '..1pp111111pp1..',
    '.11ppp1111ppp11.',
    '..111pppppp11...',
  ],

  /**
   * 深渊之眼（第 4 层最终 Boss）—— 专属贴图（以前是借用「深渊之主」那张 + 色相旋转）。
   * 用「青蓝」作为颜色身份，造型是占满画幅的异形巨眼，和第 3 层的紫魔头完全不同，
   * 最终决战该有自己的脸。
   */
  boss_abyss: [
    '................',
    '....NNNNNNNN....',
    '...NBBBBBBBBN...',
    '..NBBBbbbbBBBN..',
    '.NNBbbbbbbbbBNN.',
    '.NBBbbbRRbbbBBN.',
    '.NBbbRRNNRRbbBN.',
    'NNBbbRNNNNRbbBNN',
    'NNBbbRNNNNRbbBNN',
    '.NBbbRRNNRRbbBN.',
    '.NBBbbbRRbbbBBN.',
    '.NNBbbbbbbbbBNN.',
    '..NBBBbbbbBBBN..',
    '...NBBBBBBBBN...',
    '....NNNNNNNN....',
    '................',
  ],

  /**
   * 暗影刺客（第 4 个职业）—— 暗色兜帽 + 可见面部 + 红眼 + 双刃。
   *
   * 旧版是手机端把 `hero_rogue` **整张图重新着色成紫色**，后果有三：
   *   1. 连皮肤都被刷紫 → 没有五官，远看是一团紫色，认不出是人
   *   2. 它用了 6 种紫色，和**法师（亮紫长袍）撞色**，选职业时两个紫块分不清
   *   3. 和游侠**轮廓完全同形**（逐像素同形、只有颜色不同）
   * 现在改成完全独立的造型与配色：
   *   兜帽/斗篷用**暗蓝黑** `N`（#262b44）+ 最暗紫 `D` 做深度，
   *   面部露出肤色 `t`、眼睛是**红光** `R`（呼应"斩杀"主题），
   *   两侧各一把浅钢色短刃 `g`。
   * 这样四个职业的颜色身份互不重叠：骑士=钢灰 / 法师=亮紫 / 游侠=绿棕 / 刺客=暗蓝红眼。
   */
  hero_assassin: [
    '................',
    '.....111111.....',
    '...11NNNNNN11...',
    '..1NNsNNNNNNN1..',
    '.1NNsNNNNNNNNN1.',
    '.1NNNtttttttNN1.',
    '.1NNtRRtttRRtN1.',
    '.1NNtttttttttN1.',
    '.1NNN1111111NN1.',
    '.1NNNNNNNNNNNN1.',
    '1o1NNNNNNNNNN1o1',
    '1g1NNNDDDDNNN1g1',
    '1g1NNDDDDDDNN1g1',
    '111NNNNDDNNNN111',
    '.111NNN11NNN111.',
    '..111SS11SS111..',
  ],

  /**
   * 状态图标：灼烧 —— 一团火。
   * 以前这里用的是汉字「火」，和旁边那排符号图标（☠ ✸ ⛨ …）风格不搭。
   * 按项目调色板手绘：尖端与外缘用红 R（温度低），中段橙金 Y，底部中心亮黄 y（最热）。
   */
  icon_burn: [
    '................',
    '.......11.......',
    '......1RR1......',
    '.....1RRR1......',
    '.....1RRR1......',
    '....1RRRRR1.....',
    '....1RRRRR1.....',
    '...1RRRRRRR1....',
    '...1RRYYYYR1....',
    '..1RYYYYYYYY1...',
    '..1RYYYYYYYY1...',
    '.1RYYYYyyYYYY1..',
    '.1RYYYyyyyYYY1..',
    '.1RYYYyyyyYYY1..',
    '..1YYYyyyyYY1...',
    '...111111111....',
  ],

  /** 状态图标：冰霜 —— 浅蓝色靴子（靴口高光 + 提亮鞋底，小尺寸下才认得出是鞋） */
  icon_frost: [
    '................',
    '................',
    '...11111........',
    '..1bbbbb1.......',
    '..1bbbbb1.......',
    '..1bbbbb1.......',
    '..1bbbbb1.......',
    '..1bbbbb1.......',
    '..1bbbbb1.......',
    '..1bbbbb111.....',
    '..1bbbbbbbb1....',
    '..1bbbbbbbbb1...',
    '..1bbbbbbbbbb1..',
    '..1BBBBBBBBBB1..',
    '..111111111111..',
    '................',
  ],

  /** 状态图标：冰冻 —— 浅蓝色六角雪花 */
  icon_freeze: [
    '................',
    '.......bb.......',
    '.......bb.......',
    '..b....bb....b..',
    '...b...bb...b...',
    '....b..bb..b....',
    '.....b.bb.b.....',
    '......bbbb......',
    '......bbbb......',
    '.....b.bb.b.....',
    '....b..bb..b....',
    '...b...bb...b...',
    '..b....bb....b..',
    '.......bb.......',
    '.......bb.......',
    '................',
  ],

  /** 卡牌：扔雪球 —— 寒冰法师的基础牌，出场率最高，单独画一个 */
  snowball: [
    '................',
    '................',
    '.....1111.......',
    '...11wwww11.....',
    '..1wwbbbbww1....',
    '..1wbbbbbbb1....',
    '.1wbbbbbbbbb1...',
    '.1bbbbbbbbbb1...',
    '.1bbbbbbbbbb1...',
    '.1bbbbbbbbbb1...',
    '.1bbbbbbbbbb1...',
    '..1bbbbbbbb1....',
    '..1bbbbbbbb1....',
    '...11bbbb11.....',
    '.....1111.......',
    '................',
  ],


  /** 第三层 Boss：凛冬女王 —— 冰冠 + 白领 + 冰袍。
   *  机制特色是"攻击与增益都往玩家身上叠冰霜"，所以立绘要一眼看出是冰系。 */
  boss_frostqueen: [
    '................',
    '.....1.1.1......',
    '....1W1W1W1.....',
    '....1WWWWW1.....',
    '.....1ttt1......',
    '.....1t1t1......',
    '.....1ttt1......',
    '....1WWWWW1.....',
    '...1WbbbbbW1....',
    '..1tbbbbbbbt1...',
    '..1tbbbbbbbt1...',
    '..1tbbbBBbbb1...',
    '..1tbbBBBBbb1...',
    '...1bbbBBbb1....',
    '...111111111....',
    '................',
  ],

  /**
   * 地图节点图标：普通战斗 —— 两把交叉的剑。
   * 旧版用的是 `bars`（监狱铁栏），和"战斗"完全无关，看着像牢房。
   * 交叉剑是"有敌人要打"最通用的图形语言，小尺寸下也能认出来。
   */
  node_battle: [
    '................',
    '..1..........1..',
    '..11........11..',
    '..1g1......1g1..',
    '...1g1....1g1...',
    '....1g1..1g1....',
    '.....1g11g1.....',
    '......1gg1......',
    '......1gg1......',
    '.....1g11g1.....',
    '....1g1..1g1....',
    '...1o1....1o1...',
    '..1o1......1o1..',
    '..1o1......1o1..',
    '..111......111..',
    '................',
  ],

  /**
   * 地图节点图标：精英 —— 带角的骷髅头。
   * 旧版借用了 `boss_demon`（那是第 1 层 Boss 的立绘），
   * 地图上精英和 Boss 长得一样，分不清哪个是"打完进下一层"的那个。
   * 现在精英用骷髅（红眼），Boss 用戴冠骷髅，层级一眼分明。
   */
  node_elite: [
    '................',
    '..1..........1..',
    '..11........11..',
    '..1g1......1g1..',
    '..1g11....11g1..',
    '..1ggg1111ggg1..',
    '.1ggggggggggggg1',
    '.1gg11111111gg1.',
    '.1g11RR11RR11g1.',
    '.1g11RR11RR11g1.',
    '.1gg1111111ggg1.',
    '.1ggg11111gggg1.',
    '.1gggg1g1ggggg1.',
    '..1ggg1g1gggg1..',
    '...1gg111ggg1...',
    '....11111111....',
  ],

  /**
   * 地图节点图标：Boss —— 戴金冠的骷髅。
   * 和精英共用骷髅轮廓（同一族），但头顶**金冠** + 红眼更亮，
   * 这样"精英 < Boss"的关系在视觉上是连续的，而不是两个不相干的图案。
   */
  node_boss: [
    '................',
    '..y..y..y..y....',
    '.1y1.y1.y1.y1...',
    '.1YyYYyYYyYYy1..',
    '..1ggggggggg1...',
    '.1ggg111111gg1..',
    '.1gg11RR11RRg1..',
    '.1gg11RR11RRg1..',
    '.1ggg1111111g1..',
    '.1gggg11111gg1..',
    '.1ggggg1g1ggg1..',
    '.1ggggg1g1ggg1..',
    '..1gggg11gggg1..',
    '...1ggg11ggg1...',
    '....11111111....',
    '................',
  ],

  /**
   * 石像鬼（第 3 层精英）—— 灰色带角石像鬼。
   * 以前和「深渊之主」是同一张图（sprites.json 里两者坐标都是 [7,0]），
   * 现在它是**灰色**、主人是**紫色**，一眼就能分开。
   */
  gargoyle: [
    '................',
    '...1........1...',
    '..1G1......1G1..',
    '..1GG1....1GG1..',
    '..1GGG1111GGG1..',
    '.1GggggggggggG1.',
    '.1GggggggggggG1.',
    '.1G1111gg1111G1.',
    '.1G1RR1gg1RR1G1.',
    '.1G1111gg1111G1.',
    '.1Gggggggggggg1.',
    '.1GGG111111GGG1.',
    '.1GGG1G11G1GGG1.',
    '..1GG111111GG1..',
    '..11GGGGGGGG11..',
    '....11111111....',
  ],
};

/* =====================================================================
   渲染
   ===================================================================== */
const hexToRgb = hex => [
  parseInt(hex.slice(1, 3), 16),
  parseInt(hex.slice(3, 5), 16),
  parseInt(hex.slice(5, 7), 16),
];

/**
 * 把字符地图渲染成 RGBA 像素缓冲。
 * 这里做**严格校验**：行数、每行长度、每个字符都必须是合法的 ——
 * 画歪一个字符就当场抛错，而不是画出半张错的贴图还不知道。
 */
export function rasterize(name, rows = SPRITES[name]) {
  if (!rows) throw new Error(`没有名为 ${name} 的贴图定义`);
  if (rows.length !== 16) throw new Error(`${name}: 需要 16 行，实际 ${rows.length} 行`);
  const buf = Buffer.alloc(16 * 16 * 4);           // 默认全 0 = 透明
  const bad = [];
  rows.forEach((line, y) => {
    if (line.length !== 16) throw new Error(`${name} 第 ${y + 1} 行需要 16 个字符，实际 ${line.length}：${line}`);
    for (let x = 0; x < 16; x++) {
      const ch = line[x];
      if (ch === '.') continue;
      const hex = PALETTE[ch];
      if (!hex) { bad.push(`第 ${y + 1} 行第 ${x + 1} 列用了未定义的颜色字符 '${ch}'`); continue; }
      const [r, g, b] = hexToRgb(hex);
      const i = (y * 16 + x) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  });
  if (bad.length) throw new Error(`${name}: ${bad.join('；')}`);
  return buf;
}

/* ---- 最小 PNG 编码器（只用到 node:zlib，无第三方依赖）---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** RGBA 缓冲 → PNG 文件字节 */
export function encodePNG(rgba, w = 16, h = 16) {
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;                     // filter type 0 (None)
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 6;    // color type: RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 一个贴图的完整 PNG 字节（测试用它与磁盘上的文件比对） */
export function render(name) {
  return encodePNG(rasterize(name));
}

/** 把 SPRITES 里的贴图全部写到 assets/sprites/ */
export function writeAll(dir = SPRITE_DIR) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const name of Object.keys(SPRITES)) {
    const png = render(name);
    writeFileSync(join(dir, `${name}.png`), png);
    out.push({ name, bytes: png.length });
  }
  return out;
}

/* ---- 直接运行：重新生成 ---- */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = writeAll();
  for (const { name, bytes } of out) console.log(`  ✅ ${name}.png  (${bytes} bytes)`);
  console.log(`共生成 ${out.length} 张贴图`);
}

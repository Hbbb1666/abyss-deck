/**
 * 随机事件
 * 每个选项的 run(G, api) 里可以用：
 *   api.heal(n) / api.damage(n) / api.maxHp(n) / api.gold(n)
 *   api.addRelic(id?) / api.addPotion(id?) / api.addCard(id) / api.addCurse(id?)
 *   api.removeCard()  → 返回 Promise，弹出选牌界面
 *   api.upgradeCard() → 返回 Promise，弹出选牌界面
 *   api.randomRelic() → 随机遗物 id
 */
const R = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const COMMON_RELICS = ['iron_belt', 'lucky_coin', 'whetstone', 'feather', 'snake_ring', 'blood_vial', 'spiked_bracer', 'venom_sac', 'amulet', 'potion_belt', 'merchant_badge', 'lucky_dice', 'hourglass', 'thorn_heart'];
const RARE_RELICS = ['energy_core', 'scholar_notes', 'turtle_shell', 'war_horn', 'obsidian_heart', 'philosopher_stone'];

export const EVENTS = [
  {
    id: 'altar', name: '血色祭坛', art: 'boss_demon',
    text: '一座还在搏动的肉色祭坛。低语声承诺给你力量——只要付出一点「代价」。',
    options: [
      { label: '献祭生命', desc: '失去 12 点生命，获得一件遗物', run: (G, api) => { api.damage(12); api.addRelic(api.randomRelic(COMMON_RELICS)); } },
      { label: '献祭金币', desc: '失去 60 金币，获得一件遗物', req: G => G.gold >= 60, run: (G, api) => { api.gold(-60); api.addRelic(api.randomRelic(COMMON_RELICS)); } },
      { label: '转身离开', desc: '什么也不发生', run: () => {} },
    ],
  },
  {
    id: 'fountain', name: '静谧之泉', art: 'portal',
    text: '一汪泛着微光的泉水。水面平静得像一面镜子。',
    options: [
      { label: '畅饮', desc: '回复 30% 最大生命', run: (G, api) => api.heal(Math.floor(G.maxHp * 0.3)) },
      { label: '净化', desc: '移除一张卡牌', run: (G, api) => api.removeCard() },
      { label: '浸泡', desc: '最大生命 +6', run: (G, api) => api.maxHp(6) },
    ],
  },
  {
    id: 'gambler', name: '独眼赌徒', art: 'noble',
    text: '「来一把吗？三个金币，赌一手运气。我这个人最讲信用了。」他咧开嘴，露出三颗金牙。',
    options: [
      { label: '押 30 金币', desc: '50% 获得 80 金币 / 50% 什么也没有', req: G => G.gold >= 30, run: (G, api) => { api.gold(-30); if (api.rng() < 0.5) api.gold(80); } },
      { label: '押 60 金币', desc: '40% 获得稀有卡 / 60% 什么也没有', req: G => G.gold >= 60, run: (G, api) => { api.gold(-60); if (api.rng() < 0.4) api.addCard(api.randomCard(['rare'])); } },
      { label: '不赌', desc: '什么也不发生', run: () => {} },
    ],
  },
  {
    id: 'obelisk', name: '古老石碑', art: 'stone_platform',
    text: '石碑上刻满了看不懂的符文。当你靠近时，其中一个符文亮了起来。',
    options: [
      { label: '触摸符文', desc: '升级一张卡牌', run: (G, api) => api.upgradeCard() },
      { label: '拓印铭文', desc: '获得一件稀有遗物，但受到 15 点伤害', run: (G, api) => { api.damage(15); api.addRelic(api.randomRelic(RARE_RELICS)); } },
      { label: '离开', desc: '什么也不发生', run: () => {} },
    ],
  },
  {
    id: 'trap', name: '尖刺陷阱', art: 'portcullis',
    text: '走廊地面上有一排几乎看不见的细线。你能听见远处的机械齿轮在轻轻转动。',
    options: [
      { label: '拆解陷阱', desc: '50% 获得 50 金币 / 50% 受伤 10 点', run: (G, api) => { if (api.rng() < 0.5) api.gold(50); else api.damage(10); } },
      { label: '硬闯', desc: '受到 8 点伤害', run: (G, api) => api.damage(8) },
      { label: '绕路', desc: '最大生命 -3', run: (G, api) => api.maxHp(-3) },
    ],
  },
  {
    id: 'witch_cauldron', name: '女巫的坩埚', art: 'witch',
    text: '一口冒着绿泡的坩埚，旁边放着一把长柄勺。「随便搅搅，」一个声音说，「反正你也不知道会搅出什么。」',
    options: [
      { label: '搅一搅', desc: '随机变化一张卡牌为同稀有度的另一张', run: (G, api) => api.transformCard() },
      { label: '喝一口', desc: '回复 20 点生命，但获得 1 张「剧痛」', run: (G, api) => { api.heal(20); api.addCurse('curse_pain'); } },
      { label: '端走坩埚', desc: '获得一瓶随机药水', run: (G, api) => api.addPotion() },
    ],
  },
  {
    id: 'chest_mimic', name: '可疑的宝箱', art: 'chest_gold',
    text: '一只镶金边的宝箱孤零零地摆在路中间。太干净了，干净得不像话。',
    options: [
      { label: '打开它', desc: '获得 90 金币，但会触发一场战斗', run: (G, api) => { api.gold(90); api.fightElite(); } },
      { label: '远远地砸开', desc: '获得 30 金币', run: (G, api) => api.gold(30) },
      { label: '绕过去', desc: '什么也不发生', run: () => {} },
    ],
  },
  {
    id: 'blood_pact', name: '血之契约', art: 'grave_cross',
    text: '一份用血写成的契约。签名处已经有很多名字，大部分都被划掉了。',
    options: [
      { label: '签下名字', desc: '最大生命 -10，获得一张稀有卡牌', run: (G, api) => { api.maxHp(-10); api.addCard(api.randomCard(['rare'])); } },
      { label: '撕掉契约', desc: '获得 40 金币', run: (G, api) => api.gold(40) },
    ],
  },
  {
    id: 'forgotten_well', name: '遗忘之井', art: 'coil',
    text: '一口深不见底的古井。往里看时，你看见了自己的一些记忆在井底漂浮。',
    options: [
      { label: '投入一张牌', desc: '移除一张卡牌', run: (G, api) => api.removeCard() },
      { label: '打捞', desc: '获得 25 金币和一瓶药水', run: (G, api) => { api.gold(25); api.addPotion(); } },
    ],
  },
  {
    id: 'wandering_merchant', name: '流浪商人', art: 'anvil',
    text: '「东西不多，但都是好货。」他把箱子打开一条缝，又立刻合上。',
    options: [
      { label: '买遗物（80 金币）', desc: '获得一件随机遗物', req: G => G.gold >= 80, run: (G, api) => { api.gold(-80); api.addRelic(api.randomRelic(COMMON_RELICS)); } },
      { label: '买药水（35 金币）', desc: '获得一瓶随机药水', req: G => G.gold >= 35, run: (G, api) => { api.gold(-35); api.addPotion(); } },
      { label: '买情报（20 金币）', desc: '最大生命 +8', req: G => G.gold >= 20, run: (G, api) => { api.gold(-20); api.maxHp(8); } },
      { label: '离开', desc: '什么也不发生', run: () => {} },
    ],
  },
  {
    id: 'dragon_hoard', name: '龙之宝藏', art: 'chest_gem',
    text: '山一样的金币，中间还插着一把剑。你注意到金币堆的边缘有一圈焦黑的痕迹。',
    options: [
      { label: '狠狠抓一把', desc: '获得 150 金币，获得 2 张诅咒牌', run: (G, api) => { api.gold(150); api.addCurse('curse_pain'); api.addCurse('curse_regret'); } },
      { label: '只拿一点', desc: '获得 50 金币', run: (G, api) => api.gold(50) },
      { label: '拔剑', desc: '最大生命 -12，升级所有「打击」和「防御」', run: (G, api) => { api.maxHp(-12); api.upgradeBasics(); } },
    ],
  },
  {
    id: 'fallen_hero', name: '倒下的英雄', art: 'undead',
    text: '一具穿着精良盔甲的尸体，手里的剑还握得很紧。看起来死了没多久。',
    options: [
      { label: '取下装备', desc: '获得一件遗物和 30 金币', run: (G, api) => { api.addRelic(api.randomRelic(COMMON_RELICS)); api.gold(30); } },
      { label: '安葬他', desc: '最大生命 +8，回复 10 点生命', run: (G, api) => { api.maxHp(8); api.heal(10); } },
      { label: '搜刮药水', desc: '获得 2 瓶随机药水', run: (G, api) => { api.addPotion(); api.addPotion(); } },
    ],
  },
];
for (const e of EVENTS) e.art = e.art || 'gargoyle';

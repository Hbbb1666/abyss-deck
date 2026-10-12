/**
 * 音频：预加载 ogg 音效，用 WebAudio 播放（低延迟、可同时叠放）
 * 首次用户交互时才创建 AudioContext（移动端自动播放限制）
 */
import { asset } from './util.js';

const SFX = {
  click: 'click.ogg', confirm: 'confirm.ogg', error: 'error.ogg', back: 'back.ogg',
  open: 'open.ogg', close: 'close.ogg', drop: 'drop.ogg',
  hit: 'hit.ogg', hit_heavy: 'hit_heavy.ogg', hit_metal: 'hit_metal.ogg', block: 'block.ogg',
  slash: 'slash.ogg', slash2: 'slash2.ogg', draw: 'draw.ogg',
  card_draw: 'card_draw.ogg', card_play: 'card_play.ogg', card_place: 'card_place.ogg',
  coin: 'coin.ogg', metal_click: 'metal_click.ogg', door: 'door.ogg', step: 'step.ogg',
  bell: 'bell.ogg', mining: 'mining.ogg', creak: 'creak.ogg',
};

let ctx = null;
const buffers = {};
let muted = false;
let ready = false;

export function setMuted(m) { muted = m; }
export function isMuted() { return muted; }

export async function initAudio() {
  if (ready) return;
  ready = true;
  try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
  await Promise.all(Object.entries(SFX).map(async ([k, f]) => {
    try {
      const r = await fetch(asset('assets/sfx/' + f));
      const ab = await r.arrayBuffer();
      buffers[k] = await ctx.decodeAudioData(ab);
    } catch { /* 单个音效失败不影响整体 */ }
  }));
}

export function play(name, { vol = 0.5, rate = 1, delay = 0 } = {}) {
  if (muted || !ctx || !buffers[name]) return;
  if (ctx.state === 'suspended') ctx.resume();
  const src = ctx.createBufferSource();
  src.buffer = buffers[name];
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(g).connect(ctx.destination);
  src.start(ctx.currentTime + delay);
}

/** 随机音高，避免连续同一音效听起来发闷 */
export function playVar(name, opts = {}) {
  play(name, { rate: 0.92 + Math.random() * 0.18, ...opts });
}

export const sfx = {
  click: () => play('click', { vol: .35 }),
  confirm: () => play('confirm', { vol: .45 }),
  error: () => play('error', { vol: .4 }),
  back: () => play('back', { vol: .35 }),
  open: () => play('open', { vol: .4 }),
  close: () => play('close', { vol: .35 }),
  draw: () => playVar('card_draw', { vol: .35 }),
  playCard: () => playVar('card_play', { vol: .45 }),
  place: () => playVar('card_place', { vol: .4 }),
  hit: () => playVar('hit', { vol: .5 }),
  hitHeavy: () => playVar('hit_heavy', { vol: .6 }),
  slash: () => playVar('slash', { vol: .45 }),
  slash2: () => playVar('slash2', { vol: .45 }),
  block: () => playVar('block', { vol: .5 }),
  coin: () => playVar('coin', { vol: .5 }),
  metal: () => playVar('metal_click', { vol: .45 }),
  door: () => play('door', { vol: .5 }),
  step: () => playVar('step', { vol: .3 }),
  bell: () => play('bell', { vol: .5 }),
  mining: () => playVar('mining', { vol: .5 }),
  creak: () => playVar('creak', { vol: .4 }),
  drop: () => playVar('drop', { vol: .4 }),
};

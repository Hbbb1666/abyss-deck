/**
 * 战斗引擎
 * 与 UI 解耦：所有展示通过 this.view 回调，引擎只负责规则与状态。
 */
import { G, relicMods, relicHooks, hydrate } from './state.js';
import { ENEMIES } from '../data/enemies.js';
import { CARDS, makeCard } from '../data/cards.js';
import { RELICS } from '../data/relics.js';
import { sleep, clamp } from './util.js';

/* ================= 状态效果定义 ================= */
/** 把 desc 里的 N 换成实际层数，得到一句话说明 */
export function stText(k, n) {
  const d = ST[k];
  if (!d) return '';
  return d.desc.replace(/N/g, String(n ?? 0));
}

export const ST = {
  strength: { name: '力量', icon: '⬆', desc: '攻击伤害 +N', buff: true, color: '#ff8a5c' },
  dexterity: { name: '敏捷', icon: '✦', desc: '获得的护甲 +N', buff: true, color: '#6ee7a8' },
  vulnerable: { name: '易伤', icon: '✸', desc: '受到的伤害 +50%，回合结束 -1', color: '#ff5c8a' },
  weak: { name: '虚弱', icon: '↓', desc: '造成的伤害 -25%，回合结束 -1', color: '#c07bff' },
  poison: { name: '中毒', icon: '☠', desc: '回合开始失去 N 点生命，然后 -1', color: '#7ee787' },
  regen: { name: '再生', icon: '✚', desc: '回合结束回复 N 点生命，然后 -1', buff: true, color: '#7ee787' },
  thorns: { name: '荆棘', icon: '✹', desc: '被攻击时反弹 N 点伤害', buff: true, color: '#ffb04a' },
  ritual: { name: '仪式', icon: '☯', desc: '每回合开始获得 N 层力量', buff: true, color: '#ff8a5c' },
  undying: { name: '不屈', icon: '⛨', desc: '每回合开始获得 N 点护甲', buff: true, color: '#8fa8c0' },
  barricade: { name: '壁垒', icon: '▣', desc: '护甲不再于回合结束时消失', buff: true, color: '#ffcc52' },
  berserk: { name: '狂战', icon: '⚡', desc: '每回合开始获得 N 点能量', buff: true, color: '#ff5c5c' },
  berserk_dmg: { name: '狂战代价', icon: '✚', desc: '每回合开始失去 N 点生命', color: '#ff5c5c' },
  extra_draw: { name: '洞察', icon: '❖', desc: '每回合额外抽 N 张牌', buff: true, color: '#8fd4ff' },
  poison_plus: { name: '淬毒', icon: '☠', desc: '施加中毒时额外 +N 层', buff: true, color: '#7ee787' },
  block_next: { name: '备战', icon: '⛨', desc: '下回合获得 N 点护甲', buff: true, color: '#8fa8c0' },
  frail: { name: '脆弱', icon: '▽', desc: '获得的护甲 -25%', color: '#c07bff' },
  artifact: { name: '神器', icon: '◈', desc: '免疫下 N 次减益', buff: true, color: '#ffcc52' },
};

export class Battle {
  constructor(encounter, opts = {}) {
    this.kind = opts.kind || 'battle';            // battle / elite / boss
    this.act = G.act;
    this.rng = G.rng;
    this.view = opts.view || {};
    this.turn = 0;
    this.over = false;
    this.result = null;
    this.log = [];
    this.uid = 0;

    const m = relicMods();
    this.mods = m;

    const p = { hp: G.hp, maxHp: G.maxHp, block: 0, st: {}, isPlayer: true, name: '你' };
    this.player = p;

    this.enemies = [];
    for (const id of encounter) this.spawn(id);

    // 牌堆
    this.draw = this.rng.shuffle(G.deck.map(e => hydrate({ ...e })));
    this.hand = []; this.discard = []; this.exhaustPile = [];
    this.energy = 0; this.energyMax = 3;
    this.cardsPlayedThisTurn = 0;

    // 从存档恢复：直接套用快照，不要重新随机
    if (opts.restore) this.applySnapshot(opts.restore);
  }

  /* ---------------- 存档 / 读档 ----------------
     战斗中途关掉页面再回来，敌人、血量、手牌必须和之前一模一样，
     所以整场战斗的状态都要能序列化（全是纯数据，没有函数）。 */
  serialize() {
    const c = card => ({ id: card.id, up: !!card.upgraded });
    return {
      v: 1,
      kind: this.kind,
      turn: this.turn,
      energy: this.energy,
      energyMax: this.energyMax,
      player: { hp: this.player.hp, maxHp: this.player.maxHp, block: this.player.block, st: { ...this.player.st } },
      enemies: this.enemies.map(e => ({
        defId: e.defId, hp: e.hp, maxHp: e.maxHp, block: e.block, st: { ...e.st },
        turn: e.turn, moveId: e.moveId, dead: !!e.dead,
        // 存下标而不是 uid：uid 每次读档都会重新分配，存 uid 对不上
        summonedBy: e.summonedBy ? this.enemies.findIndex(x => x.uid === e.summonedBy) : -1,
      })),
      draw: this.draw.map(c), hand: this.hand.map(c),
      discard: this.discard.map(c), exhaust: this.exhaustPile.map(c),
    };
  }

  applySnapshot(s) {
    if (!s || s.v !== 1) return;
    this.turn = s.turn || 0;
    this.energy = s.energy || 0;
    this.energyMax = s.energyMax || 3;
    Object.assign(this.player, {
      hp: s.player.hp, maxHp: s.player.maxHp, block: s.player.block || 0, st: { ...(s.player.st || {}) },
    });
    if (Array.isArray(s.enemies) && s.enemies.length) {
      // 先按快照顺序把敌人重建出来（uid 会重新分配）
      this.enemies = s.enemies.map(e => {
        const d = ENEMIES[e.defId];
        if (!d) return null;
        return {
          uid: 'e' + (++this.uid), defId: e.defId, def: d, name: d.name, sprite: d.sprite,
          hp: e.hp, maxHp: e.maxHp, block: e.block || 0, st: { ...(e.st || {}) },
          turn: e.turn || 0, moveId: e.moveId || null, body: d.body || 1,
          elite: !!d.elite, boss: !!d.boss, dead: !!e.dead,
          summonedBy: null,
        };
      }).filter(Boolean);
      // 再按下标把「谁召唤了谁」接回去
      s.enemies.forEach((e, i) => {
        const child = this.enemies[i];
        if (!child) return;
        const pi = typeof e.summonedBy === 'number' ? e.summonedBy : -1;
        child.summonedBy = (pi >= 0 && this.enemies[pi]) ? this.enemies[pi].uid : null;
      });
    }
    const re = arr => (arr || []).map(c => makeCard(c.id, c.up));
    this.draw = re(s.draw); this.hand = re(s.hand);
    this.discard = re(s.discard); this.exhaustPile = re(s.exhaust);
  }

  /** 读档后继续这场战斗（不重新开局） */
  async resume() {
    this.pushLog('战斗继续');
    if (this.player.hp <= 0) { await this.endBattle(false); return; }
    if (!this.aliveEnemies().length) { await this.endBattle(true); return; }
    this.rollIntents();
    // 存档时若正好在敌人回合，手牌是空的 —— 补一个完整回合
    if (!this.hand.length) await this.playerTurn();
    this.view.sync?.();
  }

  /* ---------------- 基础 ---------------- */
  spawn(id, summoner) {
    const d = ENEMIES[id];
    const hp = this.rng.int(d.hp[0], d.hp[1]);
    const e = {
      uid: 'e' + (++this.uid), defId: id, def: d, name: d.name, sprite: d.sprite,
      hp, maxHp: hp, block: 0, st: {}, turn: 0, moveId: null, body: d.body || 1,
      elite: !!d.elite, boss: !!d.boss, dead: false,
      summonedBy: summoner ? summoner.uid : null,   // 谁召出来的
    };
    this.enemies.push(e);
    return e;
  }

  st(e) { return e.st || (e.st = {}); }
  get(e, k) { return e.st[k] || 0; }
  add(e, k, n, silent) {
    if (!n) return 0;
    if (n > 0 && this.get(e, 'artifact') > 0 && !ST[k]?.buff) {
      e.st.artifact--; if (!e.st.artifact) delete e.st.artifact;
      this.pushLog(`${e.name} 的「神器」抵消了 ${ST[k]?.name || k}`);
      return 0;
    }
    e.st[k] = (e.st[k] || 0) + n;
    if (e.st[k] <= 0) delete e.st[k];
    return n;
  }
  applyDebuff(e, k, n) {
    if (n > 0 && this.get(e, 'artifact') > 0) {
      e.st.artifact--; if (!e.st.artifact) delete e.st.artifact;
      this.pushLog(`${e.name} 的「神器」抵消了 ${ST[k]?.name || k}`);
      return;
    }
    this.add(e, k, n);
  }
  pushLog(t) { this.log.push(t); this.view.log?.(t); }

  /* ---------------- 数值计算 ---------------- */
  calcDamage(base, atk, def) {
    let d = base + this.get(atk, 'strength');
    if (this.get(atk, 'weak') > 0) d = Math.floor(d * 0.75);
    if (this.get(def, 'vulnerable') > 0) d = Math.floor(d * 1.5);
    return Math.max(0, d);
  }
  calcBlock(base, e) {
    let b = base + this.get(e, 'dexterity');
    if (this.get(e, 'frail') > 0) b = Math.floor(b * 0.75);
    return Math.max(0, b);
  }

  /* ---------------- 伤害 / 治疗 ---------------- */
  async damage(target, base, source = '?', opts = {}) {
    if (target.dead || this.over) return 0;
    const atk = opts.attacker || this.player;
    const dmg = opts.raw ? base : this.calcDamage(base, atk, target);
    const blocked = Math.min(target.block, dmg);
    const real = dmg - blocked;
    target.block -= blocked;
    if (real > 0) {
      target.hp -= real;
      if (target.isPlayer) { G.stats.dmgTaken += real; } else { G.stats.dmgDealt += real; }
    }
    this.view.onDamage?.(target, real, blocked, dmg);
    await this.view.step?.();
    // 荆棘反弹
    if (!opts.noThorns && opts.attacker && opts.melee) {
      const th = this.get(target, 'thorns');
      if (th > 0 && !target.dead) {
        this.pushLog(`${target.name} 的荆棘反弹 ${th} 点伤害`);
        await this.damage(opts.attacker, th, '荆棘', { raw: true, noThorns: true });
      }
    }
    if (target.hp <= 0) await this.kill(target);
    return real;
  }

  async damageAll(base, source, opts = {}) {
    for (const e of [...this.enemies]) if (!e.dead) await this.damage(e, base, source, opts);
  }
  /** 遗物钩子用的别名（hooks 里写 B.damageAllEnemies(...) 更直观） */
  damageAllEnemies(base, source, opts) { return this.damageAll(base, source, opts); }

  async heal(e, n) {
    if (e.dead || n <= 0) return;
    const before = e.hp;
    e.hp = Math.min(e.maxHp, e.hp + n);
    const real = e.hp - before;
    if (real > 0) { this.view.onHeal?.(e, real); await this.view.step?.(); }
  }

  async gainBlock(e, n) {
    if (e.dead || n <= 0) return;
    const b = this.calcBlock(n, e);
    e.block += b;
    this.view.onBlock?.(e, b);
    await this.view.step?.();
  }

  async kill(e) {
    if (e.dead) return;
    e.dead = true; e.hp = 0;
    this.pushLog(`${e.name} 被击败了`);
    if (e.isPlayer) { await this.endBattle(false); return; }
    G.stats.kills++;
    for (const [id, hook] of relicHooks('kill')) hook(this, e, RELICS[id]);
    this.view.onDeath?.(e);
    await this.view.step?.();

    // 召唤者死了，它召出来的小弟一并溃散（否则 Boss 打完还要清小弟，很别扭）
    const brood = this.enemies.filter(x => !x.dead && x.summonedBy === e.uid);
    for (const m of brood) {
      this.pushLog(`${m.name} 随着召唤者一起溃散了`);
      this.view.onVanish?.(m);
      m.dead = true; m.hp = 0;
      G.stats.kills++;
      this.view.onDeath?.(m);
      await this.view.step?.(60);
    }
    // 连带清场之后必须重新判定胜负，否则 Boss 和小弟一起死时会卡在"敌人全死了但战斗没结束"
    if (brood.length) this.checkOver();
  }

  /* ---------------- 效果结算 ---------------- */
  num(v, card) { return typeof v === 'string' ? (card?.[v] ?? 0) : (v || 0); }

  /** 玩家卡牌/药水的效果 */
  async resolve(fxList, ctx) {
    const { card } = ctx;
    // 目标可能已死光/未指定 —— 立刻取一个活着的，仍未定义就跳过需要目标的条目
    const pick = () => (ctx.target && !ctx.target.dead ? ctx.target : this.aliveEnemies()[0]);
    const NEEDS_TARGET = new Set(['dmg', 'dmgBlock', 'dmgPoison', 'debuff']);
    for (const f of fxList) {
      if (this.over) return;
      if (NEEDS_TARGET.has(f.t) && !pick()) continue;
      const target = pick();
      const v = this.num(f.v, card);
      switch (f.t) {
        case 'dmg': {
          const hits = this.num(f.hits, card) || 1;
          for (let i = 0; i < hits; i++) {
            const t = target && !target.dead ? target : this.aliveEnemies()[0];
            if (!t) break;
            await this.damage(t, v, card?.name || '效果', { attacker: this.player, melee: !!ctx.melee });
          }
          break;
        }
        case 'dmgAll':
          await this.damageAll(v, card?.name || '效果', { attacker: this.player });
          break;
        case 'dmgBlock':
          await this.damage(target, this.player.block + this.num(f.bonus, card), card?.name, { attacker: this.player });
          break;
          break;
        case 'dmgPoison':
          await this.damage(target, this.get(target, 'poison') * (this.num(f.mult, card) || 1), card?.name, { attacker: this.player });
          break;
        case 'dmgPerHand': {
          const n = this.hand.length;
          for (let i = 0; i < n; i++) {
            const t = target && !target.dead ? target : this.aliveEnemies()[0];
            if (!t) break;
            await this.damage(t, v, card?.name, { attacker: this.player });
          }
          break;
        }
        case 'block':
          await this.gainBlock(this.player, v);
          break;
        case 'blockFromBlock':
          await this.gainBlock(this.player, this.player.block * (this.num(f.mult, card) || 1));
          break;
        case 'draw': await this.drawCards(v); break;
        case 'energy': this.energy += v; this.view.onEnergy?.(); await this.view.step?.(); break;
        case 'heal': await this.heal(this.player, v); break;
        case 'loseHp':
          this.player.hp -= v;
          this.view.onDamage?.(this.player, v, 0, v);
          await this.view.step?.();
          if (this.player.hp <= 0) await this.kill(this.player);
          break;
        case 'buff': this.add(this.player, f.k, v); this.view.onStatus?.(this.player); await this.view.step?.(); break;
        case 'debuff': {
          let dv = v;
          if (f.k === 'poison') dv += this.get(this.player, 'poison_plus');
          this.applyDebuff(target, f.k, dv); this.view.onStatus?.(target); await this.view.step?.(); break;
        }
        case 'debuffAll':
          for (const e of this.aliveEnemies()) { this.applyDebuff(e, f.k, v + (f.k === 'poison' ? this.get(this.player, 'poison_plus') : 0)); this.view.onStatus?.(e); }
          await this.view.step?.(); break;
        case 'gold': G.gold += v; this.view.onGold?.(v); await this.view.step?.(); break;
        case 'discard': this.view.requestDiscard?.(v); break;
      }
    }
  }

  /** 敌人招式的效果（self=敌人自己，对玩家的减益直接作用在玩家身上） */
  async resolveEnemyFx(fxList, enemy) {
    for (const f of fxList) {
      if (this.over) return;
      const v = f.v || 0;
      switch (f.t) {
        case 'buff': this.add(enemy, f.k, v); this.view.onStatus?.(enemy); break;
        case 'buffAll': for (const e of this.aliveEnemies()) { this.add(e, f.k, v); this.view.onStatus?.(e); } break;
        case 'debuff': this.applyDebuff(this.player, f.k, v); this.view.onStatus?.(this.player); break;
        case 'healSelf': await this.heal(enemy, v); break;
        case 'block': await this.gainBlock(enemy, v); break;
        case 'summon':
          for (let i = 0; i < (f.n || 1); i++) {
            if (this.enemies.filter(e => !e.dead).length >= 4) break;
            const ne = this.spawn(f.id, enemy);
            this.pushLog(`${enemy.name} 召唤了 ${ne.name}`);
            this.view.onSummon?.(ne);
          }
          if (this.enemies.length > 4) { /* 超出上限的不再补 */ }
          break;
        case 'addCard':
          for (let i = 0; i < (f.n || 1); i++) {
            const c = makeCard(f.id);
            this.discard.push(c);
          }
          this.pushLog(`${f.n || 1} 张「${CARDS[f.id].name}」被塞进了你的弃牌堆`);
          break;
      }
      await this.view.step?.();
    }
  }

  /* ---------------- 牌堆 ---------------- */
  aliveEnemies() { return this.enemies.filter(e => !e.dead); }

  async drawCards(n) {
    for (let i = 0; i < n; i++) {
      if (!this.draw.length) {
        if (!this.discard.length) break;
        this.draw = this.rng.shuffle(this.discard);
        this.discard = [];
        this.pushLog('弃牌堆已洗回抽牌堆');
      }
      const c = this.draw.pop();
      if (this.hand.length >= 10) { this.discard.push(c); continue; }
      this.hand.push(c);
      this.view.onDraw?.(c);
      await this.view.step?.(18);
    }
  }

  /* ---------------- 出牌 ---------------- */
  canPlay(c) {
    if (this.over || c.unplayable) return false;
    const cost = this.cardCost(c);
    return this.energy >= cost;
  }
  cardCost(c) { return Math.max(0, c.cost ?? 0); }

  async playCard(card, target) {
    if (!this.canPlay(card)) return false;
    const i = this.hand.indexOf(card);
    if (i < 0) return false;
    this.energy -= this.cardCost(card);
    this.hand.splice(i, 1);
    this.cardsPlayedThisTurn++;
    G.stats.cardsPlayed++;
    this.view.onPlay?.(card, target);
    await this.view.step?.(120);

    await this.resolve(card.fx || [], { card, target: target || this.aliveEnemies()[0], melee: card.type === 'attack' });
    for (const [id, hook] of relicHooks('cardPlayed')) hook(this, card, RELICS[id]);

    if (card.exhaust) { this.exhaustPile.push(card); this.view.onExhaust?.(card); }
    else this.discard.push(card);
    this.view.onEnergy?.();
    this.view.sync?.();
    this.view.afterAction?.();     // 让界面立刻存一次档（别被节流吃掉）
    if (this.checkOver()) return true;
    return true;
  }

  async usePotion(potion, target) {
    this.view.onPotion?.(potion);
    await this.resolve(potion.fx || [], { card: null, target: target || this.aliveEnemies()[0] });
    this.view.sync?.();
    this.checkOver();
  }

  /* ---------------- 回合流程 ---------------- */
  async start() {
    this.pushLog('战斗开始！');
    const m = this.mods;
    // 遗物：战斗开始
    if (m.startHeal) await this.heal(this.player, m.startHeal);
    if (m.startLoseHp) { this.player.hp -= m.startLoseHp; this.view.onDamage?.(this.player, m.startLoseHp, 0, m.startLoseHp); }
    if (m.startBlock) await this.gainBlock(this.player, m.startBlock);
    if (m.startStrength) this.add(this.player, 'strength', m.startStrength);
    if (m.startDexterity) this.add(this.player, 'dexterity', m.startDexterity);
    if (m.startThorns) this.add(this.player, 'thorns', m.startThorns);
    if (m.startPoisonAll) for (const e of this.aliveEnemies()) this.applyDebuff(e, 'poison', m.startPoisonAll);
    if (m.startDebuffAll) for (const e of this.aliveEnemies()) for (const [k, v] of Object.entries(m.startDebuffAll)) this.applyDebuff(e, k, v);
    for (const [id, hook] of relicHooks('battleStart')) hook(this, RELICS[id]);
    this.view.sync?.();
    await this.view.step?.(250);
    if (this.player.hp <= 0) { await this.kill(this.player); return; }
    await this.playerTurn();
  }

  async playerTurn() {
    if (this.over) return;
    this.turn++;
    G.stats.turns++;
    const m = this.mods;

    // 回合开始的负面结算
    if (!this.get(this.player, 'barricade')) this.player.block = 0;
    this.pushLog(`—— 第 ${this.turn} 回合 ——`);

    // 中毒
    const poi = this.get(this.player, 'poison');
    if (poi > 0) {
      this.player.hp -= poi;
      this.view.onDamage?.(this.player, poi, 0, poi, true);
      this.add(this.player, 'poison', -1);
      await this.view.step?.(180);
      if (this.player.hp <= 0) { await this.kill(this.player); return; }
    }
    // 狂战代价
    const bd = this.get(this.player, 'berserk_dmg');
    if (bd > 0) { this.player.hp -= bd; this.view.onDamage?.(this.player, bd, 0, bd); if (this.player.hp <= 0) { await this.kill(this.player); return; } }
    // 不屈 / 仪式 / 备战
    if (this.get(this.player, 'undying') > 0) await this.gainBlock(this.player, this.get(this.player, 'undying'));
    if (this.get(this.player, 'block_next') > 0) { await this.gainBlock(this.player, this.get(this.player, 'block_next')); delete this.player.st.block_next; }
    if (this.get(this.player, 'ritual') > 0) this.add(this.player, 'strength', this.get(this.player, 'ritual'));

    // 能量
    this.energyMax = 3 + (m.energyPerTurn || 0);
    if (this.turn === 1) this.energyMax += (m.firstTurnEnergy || 0);
    this.energy = this.energyMax + this.get(this.player, 'berserk');

    // 抽牌
    let n = 5 + (m.drawPerTurn || 0) + this.get(this.player, 'extra_draw');
    if (this.turn === 1) n += (m.firstTurnDraw || 0);
    n = Math.max(0, n);
    const keep = this.hand.slice();
    this.hand = [];
    this.discard.push(...keep);
    await this.drawCards(n);

    for (const [id, hook] of relicHooks('turnStart')) hook(this, RELICS[id]);
    this.rollIntents();
    this.view.onTurnStart?.(this.turn);
    this.view.sync?.();
    this.view.afterAction?.();
  }

  async endTurn() {
    if (this.over) return;
    this.view.beforeEndTurn?.();
    // 手牌回合结束效果（诅咒）
    for (const c of [...this.hand]) {
      const d = c.endDmg;
      if (d) {
        this.pushLog(`「${c.name}」造成 ${d} 点伤害`);
        await this.damage(this.player, d, c.name, { raw: true });
      }
      if (c.id === 'curse_regret') await this.damage(this.player, this.hand.length, c.name, { raw: true });
    }
    if (this.over) return;

    // 弃掉手牌
    this.discard.push(...this.hand);
    this.hand = [];

    // 玩家减益/增益结算
    this.tickEnd(this.player);
    // 再生
    if (this.get(this.player, 'regen') > 0) { await this.heal(this.player, this.get(this.player, 'regen')); this.add(this.player, 'regen', -1); }
    for (const [id, hook] of relicHooks('turnEnd')) hook(this, RELICS[id]);
    this.view.sync?.();
    this.view.afterAction?.();
    if (this.checkOver()) return;

    await this.enemyTurn();
  }

  tickEnd(e) {
    for (const k of ['vulnerable', 'weak', 'frail']) {
      const v = this.get(e, k);
      if (v > 0) this.add(e, k, -1);
    }
  }

  async enemyTurn() {
    for (const e of this.aliveEnemies()) {
      if (this.over) return;
      e.turn++;
      if (!this.get(e, 'barricade')) e.block = 0;
      else e.block = e.block;

      // 敌人中毒
      const poi = this.get(e, 'poison');
      if (poi > 0) {
        e.hp -= poi;
        this.view.onDamage?.(e, poi, 0, poi, true);
        this.add(e, 'poison', -1);
        await this.view.step?.(200);
        if (e.hp <= 0) { await this.kill(e); continue; }
      }
      if (this.over) return;

      const mv = e.moveId && e.def.moves[e.moveId] ? e.moveId : this.pickMove(e);
      const def = e.def.moves[mv];
      e._lastActed = mv;      // 供自动化测试对照「预告 vs 实际」
      e.moveId = mv;
      this.view.onEnemyAct?.(e, def);
      await this.view.step?.(280);

      if (def.blk) await this.gainBlock(e, def.blk);
      if (def.dmg) {
        const hits = def.hits || 1;
        for (let i = 0; i < hits; i++) {
          if (this.player.hp <= 0) break;
          await this.damage(this.player, def.dmg, e.name, { attacker: e, melee: true });
        }
      }
      if (def.selfDamage) { e.hp -= def.selfDamage; this.view.onDamage?.(e, def.selfDamage, 0, def.selfDamage); if (e.hp <= 0) await this.kill(e); }
      if (def.fx) await this.resolveEnemyFx(def.fx, e);
      this.tickEnd(e);
      this.view.sync?.();
      await this.view.step?.(160);

      if (this.player.hp <= 0) { await this.kill(this.player); return; }
      if (this.checkOver()) return;
    }
    // 敌人行动完毕：重算「下一轮」的意图，再交回玩家
    if (!this.over) {
      this.rollIntents();
      this.view.sync?.();
      await this.playerTurn();
    }
    this.view.sync?.();
  }

  /**
   * 决定敌人「下一次」要出的招。
   * 注意用 e.turn + 1：意图面板显示的必须是它接下来真会做的事，
   * 否则玩家看到的永远是它刚做完的那一下，等于意图系统失效。
   */
  pickMove(e) {
    const keys = Object.keys(e.def.moves);
    const t = e.turn + 1;
    const mv = e.def.ai ? e.def.ai(e, t, this.rng, this) : e.def.pattern?.[(t - 1) % e.def.pattern.length] || keys[0];
    return e.def.moves[mv] ? mv : keys[0];
  }

  /** 敌人头顶意图（含预测伤害） */
  intentOf(e) {
    const mv = e.moveId || this.pickMove(e);
    const def = e.def.moves[mv];
    const out = { intent: def.intent, name: def.name, dmg: 0, hits: def.hits || 1, blk: def.blk || 0 };
    if (def.dmg) {
      let d = def.dmg + this.get(e, 'strength');
      if (this.get(e, 'weak') > 0) d = Math.floor(d * 0.75);
      if (this.get(this.player, 'vulnerable') > 0) d = Math.floor(d * 1.5);
      out.dmg = Math.max(0, d);
    }
    return out;
  }

  /** 开局预先决定所有敌人的意图 */
  rollIntents() {
    for (const e of this.aliveEnemies()) e.moveId = this.pickMove(e);
  }

  checkOver() {
    if (this.over) return true;
    if (this.player.hp <= 0) { this.endBattle(false); return true; }
    if (!this.aliveEnemies().length) { this.endBattle(true); return true; }
    return false;
  }

  async endBattle(win) {
    if (this.over) return;
    this.over = true;
    this.result = win ? 'win' : 'lose';
    if (win) {
      G.hp = this.player.hp;
      G.stats.floors++;
      const m = relicMods();
      if (m.healAfterBattle) G.hp = Math.min(G.maxHp, G.hp + m.healAfterBattle);
      for (const [id, hook] of relicHooks('battleWin')) hook(this, RELICS[id]);
    } else {
      G.hp = 0;
    }
    this.view.onEnd?.(this.result);
  }
}

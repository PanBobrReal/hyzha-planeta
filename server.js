'use strict';
// «Хижа Планета» — онлайн. Без залежностей: лише Node.js 18+.
// Сервер — єдине джерело правди: усі правила перевіряються тут.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// ===== НАЛАШТУВАННЯ — звірте з вашою фізичною коробкою =====
const CFG = {
  GOAL: 15,                     // поділка «Перемога» і для Порятунку, і для Асиміляції
  ARTEMIA_SPACES: [3, 6, 9, 12],// поділки треку Порятунку із символом Артемії
  HUNT_LIMIT: 1,                // карт Полювання за хід (правила: «лише одну, якщо не зазначено протилежне»)
  COPIES: 3                     // копій кожної карти Полювання / Виживання в колодах
};

const LOC = {
  1: ['Лігво', 'Поверніть в руку всі карти Локацій з відбою АБО скопіюйте ефект локації з жетоном Істоти. Схоплені Істотою в Лігві — втрачаєте ще 1 Волю.'],
  2: ['Джунглі', 'Поверніть в руку цю карту Локації та ще 1 з відбою.'],
  3: ['Річка', 'У наступний хід зіграйте 2 карти Локацій. Перед розкриттям виберіть одну, іншу поверніть в руку.'],
  4: ['Узбережжя', 'Покладіть Передавач на Узбережжя АБО зніміть його, щоб Порятунок +1. Раз за хід.'],
  5: ['Планетохід', 'Візьміть з резерву 1 карту Локації, якої у вас ще немає.'],
  6: ['Болото', 'Поверніть в руку цю карту та ще 2 карти з відбою.'],
  7: ['Укриття', 'Візьміть 2 карти Виживання, одну залиште в руці, другу скиньте.'],
  8: ['Уламки', 'Порятунок +1. Раз за хід.'],
  9: ['Джерело', 'Астронавт (ви або інший) повертає 1 Волю АБО отримує 1 карту Виживання.'],
  10: ['Артефакт', 'У наступний хід зіграйте 2 карти Локацій. Активуйте ефекти обох. Не копіюється.']
};
const HUNT = {
  fobia: { name: 'Фобія', phase: 2, sym: 'A', text: 'Оберіть Астронавта. Він показує вам усі карти Локацій в руці, окрім двох.' },
  marevo: { name: 'Марево', phase: 2, sym: 'T', text: 'Ефекти двох суміжних локацій неактивні.' },
  toksyn: { name: 'Токсин', phase: 2, sym: 'T', text: 'Астронавти в локації з жетоном Цілі скидають по 1 карті Виживання. Ефект локації неактивний.' },
  vidchaj: { name: 'Відчай', phase: 1, sym: null, text: 'До кінця ходу не можна грати і отримувати карти Виживання.' }
};
const SURV = {
  hytrist: { name: 'Хитрість', phase: 3, text: 'На вас не діють ефекти жетона Істоти.' },
  hybnyi: { name: 'Хибний слід', phase: 3, text: 'Перемістіть жетон Істоти в сусідню локацію.' },
  shoste: { name: 'Шосте відчуття', phase: 1, text: 'Поверніть в руку 2 карти Локацій з відбою.' },
  udar: { name: 'Удар у відповідь', phase: 1, text: 'Візьміть 2 випадкові карти Полювання з руки Істоти й покладіть їх під низ колоди.' }
};

const rooms = new Map();
const rnd = n => Math.floor(Math.random() * n);
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const rid = n => crypto.randomBytes(n).toString('hex');
const newCode = () => { let s; do { s = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[rnd(24)]).join(''); } while (rooms.has(s)); return s; };
const adj = (a, b) => Math.abs(((a - 1) / 5 | 0) - ((b - 1) / 5 | 0)) + Math.abs((a - 1) % 5 - (b - 1) % 5) === 1;
const okLoc = x => Number.isInteger(x) && x >= 1 && x <= 10;
const nm = (room, id) => (room.players.find(p => p.id === id) || {}).name || '?';
const L = (g, t) => { g.log.push(t); if (g.log.length > 120) g.log.shift(); };

// ===== Ініціалізація =====
function startGame(room) {
  const ps = room.players;
  const cid = (room.creaturePick && ps.some(p => p.id === room.creaturePick)) ? room.creaturePick : ps[rnd(ps.length)].id;
  const ci = ps.findIndex(p => p.id === cid), order = [];
  for (let i = 1; i < ps.length; i++) order.push(ps[(ci + i) % ps.length].id); // починаючи з гравця ліворуч від Істоти
  const n = ps.length, na = n - 1, c = na <= 1 ? 1 : na <= 3 ? 2 : 3;
  const g = {
    turn: 1, phase: 'recon', rescue: n, assim: n, over: null, cid, order, expert: room.expert,
    hunt: { hand: [], deck: [], disc: [], played: [], need: {} }, surv: { deck: [], disc: [] },
    reserve: { 6: c, 7: c, 8: c, 9: c, 10: c }, transmitter: false, tokens: { creature: null, target: null, artemia: [] },
    flags: {}, P: {}, log: [], clog: [], await: null, revealed: false, nid: 1
  };
  const mk = D => shuffle(Object.keys(D).flatMap(k => Array.from({ length: CFG.COPIES }, () => ({ id: g.nid++, k }))));
  g.hunt.deck = mk(HUNT); g.surv.deck = mk(SURV);
  g.hunt.hand = g.hunt.deck.splice(0, 3);
  for (const pid of order) g.P[pid] = { will: 3, hand: [1, 2, 3, 4, 5], disc: [], surv: [g.surv.deck.shift()], nextTwo: null };
  room.g = g; room.gen = null;
  resetTurn(g);
  L(g, `Гра почалась. Істота — ${nm(room, cid)}. Порятунок: ${g.rescue}/${CFG.GOAL}, Асиміляція: ${g.assim}/${CFG.GOAL}.`);
}
function resetTurn(g) {
  g.phase = 'recon'; g.revealed = false;
  g.flags = { despair: false, coast: false, rubble: false, huntPlayed: 0 };
  g.tokens = { creature: null, target: null, artemia: [] };
  g.hunt.played = []; g.hunt.need = { artemia: 0, target: false, mirage: false, toxin: false };
  for (const pid of g.order) {
    const p = g.P[pid];
    Object.assign(p, { mode: p.nextTwo || null, nextTwo: null, locked: false, played: [], action: null, survPlayed: false, cunning: false, twoSet: false, ready: false, ret: [], lost3: false });
  }
}
const drawSurv = g => { const s = g.surv; if (!s.deck.length && s.disc.length) { s.deck = shuffle(s.disc); s.disc = []; } return s.deck.shift() || null; };
const drawHunt = g => { const h = g.hunt; if (!h.deck.length && h.disc.length) { h.deck = shuffle(h.disc); h.disc = []; } return h.deck.shift() || null; };
function moveRescue(g, n) { if (g.over) return; g.rescue = Math.min(CFG.GOAL, g.rescue + n); if (g.rescue >= CFG.GOAL) { g.over = 'astro'; g.phase = 'over'; } }
function moveAssim(g, n) { if (g.over) return; g.assim = Math.min(CFG.GOAL, g.assim + n); if (g.assim >= CFG.GOAL) { g.over = 'creature'; g.phase = 'over'; } }
const owns = (p, x) => p.hand.includes(x) || p.disc.includes(x) || (p.played || []).includes(x);

// ===== Фаза 1: Розвідка =====
function submit(room, pid, m) {
  const g = room.g, p = g.P[pid];
  if (!p || g.phase !== 'recon' || p.locked) return 'Зараз не можна';
  let hand = p.hand.slice(), disc = p.disc.slice(), will = p.will, surrender = false;
  const act = m.action || 'none';
  if (act === 'resist2' || act === 'resist4') {
    const k = act === 'resist2' ? 2 : 4, cs = m.resist || [];
    if (!Array.isArray(cs) || cs.length !== k || new Set(cs).size !== k || !cs.every(c => disc.includes(c))) return `Оберіть ${k} карти з відбою`;
    hand.push(...cs); disc = disc.filter(c => !cs.includes(c)); will -= k / 2;
    if (will <= 0) surrender = true; // втратив третю фішку Волі — повинен поступитися
  } else if (act === 'surrender') surrender = true;
  else if (act !== 'none') return 'Невідома дія';
  if (surrender) { hand = hand.concat(disc); disc = []; will = 3; }
  const cnt = Math.min(p.mode ? 2 : 1, hand.length), play = m.play || [];
  if (cnt === 0) return 'У руці немає карт — оберіть Опір або Поступитися';
  if (!Array.isArray(play) || play.length !== cnt || new Set(play).size !== cnt || !play.every(c => hand.includes(c))) return `Оберіть карт Локацій: ${cnt}`;
  p.hand = hand.filter(c => !play.includes(c)); p.disc = disc; p.will = will; p.played = play; p.locked = true;
  p.action = surrender ? 'surrender' : act;
  if (surrender) { moveAssim(g, 1); L(g, `${nm(room, pid)} поступається — Асиміляція +1.`); }
  else if (act !== 'none') L(g, `${nm(room, pid)} чинить опір (−${act === 'resist2' ? 1 : 2} Волі).`);
  return null;
}

// ===== Карти Полювання / Виживання =====
function playHunt(room, m) {
  const g = room.g, h = g.hunt, c = h.hand.find(x => x.id === m.id);
  if (!c) return 'Немає такої карти';
  const d = HUNT[c.k];
  if (d.phase === 1 && g.phase !== 'recon') return 'Ця карта грається у Фазі 1';
  if (d.phase === 2 && g.phase !== 'hunt') return 'Ця карта грається у Фазі 2 (Полювання)';
  if (g.flags.huntPlayed >= CFG.HUNT_LIMIT) return 'Можна зіграти лише одну карту Полювання за хід';
  if (c.k === 'fobia' && !g.P[m.target]) return 'Оберіть Астронавта';
  h.hand = h.hand.filter(x => x !== c); h.disc.push(c); h.played.push(c.k); g.flags.huntPlayed++;
  if (d.sym === 'A') h.need.artemia++;
  if (d.sym === 'T') h.need.target = true;
  if (c.k === 'marevo') h.need.mirage = true;
  if (c.k === 'toksyn') h.need.toxin = true;
  if (c.k === 'vidchaj') g.flags.despair = true;
  L(g, `Істота грає карту Полювання «${d.name}».`);
  if (c.k === 'fobia') {
    const th = g.P[m.target].hand;
    if (th.length <= 2) g.clog.push(`Фобія → ${nm(room, m.target)}: карт ≤ 2, нічого не видно.`);
    else g.await = { kind: 'phobia', pid: m.target };
  }
  return null;
}
function playSurv(room, pid, m) {
  const g = room.g, p = g.P[pid], c = p && p.surv.find(x => x.id === m.id);
  if (!c) return 'Немає такої карти';
  const d = SURV[c.k], win = g.phase === 'payoff' && g.await && g.await.kind === 'window';
  if (g.await && !win) return 'Зачекайте';
  if (g.flags.despair) return 'Відчай: карти Виживання зараз не можна грати';
  if (p.survPlayed) return 'Лише одна карта Виживання за хід';
  if (d.phase === 1 && g.phase !== 'recon') return 'Ця карта грається у Фазі 1';
  if (d.phase === 3 && !win) return 'Ця карта грається у Фазі 3 перед розрахунком';
  if (c.k === 'shoste') {
    const k = Math.min(2, p.disc.length), cs = m.cards || [];
    if (!Array.isArray(cs) || cs.length !== k || new Set(cs).size !== k || !cs.every(x => p.disc.includes(x))) return `Оберіть карт з відбою: ${k}`;
    p.disc = p.disc.filter(x => !cs.includes(x)); p.hand.push(...cs);
  } else if (c.k === 'udar') {
    const h = g.hunt; for (let i = 0; i < 2 && h.hand.length; i++) h.deck.push(h.hand.splice(rnd(h.hand.length), 1)[0]);
  } else if (c.k === 'hytrist') p.cunning = true;
  else if (c.k === 'hybnyi') {
    if (!okLoc(m.loc) || g.tokens.creature == null || !adj(g.tokens.creature, m.loc)) return 'Оберіть сусідню локацію';
    g.tokens.creature = m.loc;
  }
  p.surv = p.surv.filter(x => x !== c); g.surv.disc.push(c); p.survPlayed = true;
  L(g, `${nm(room, pid)} грає карту Виживання «${d.name}».`);
  return null;
}

// ===== Фаза 2: жетони Полювання =====
function placeTokens(room, m) {
  const g = room.g, n = g.hunt.need, bonus = CFG.ARTEMIA_SPACES.includes(g.rescue) ? 1 : 0;
  if (!okLoc(m.creature)) return 'Розмістіть жетон Істоти';
  const t = Array.isArray(m.target) ? m.target : [], a = Array.isArray(m.artemia) ? m.artemia : [];
  if (!t.every(okLoc) || !a.every(okLoc)) return 'Некоректна локація';
  if (n.target) {
    if (n.mirage ? !(t.length === 2 && adj(t[0], t[1])) : t.length !== 1) return n.mirage ? 'Жетон Цілі: оберіть дві суміжні локації' : 'Розмістіть жетон Цілі';
  } else if (t.length) return 'Жетон Цілі не потрібен';
  if (a.length < n.artemia || a.length > n.artemia + bonus) return `Жетонів Артемії: від ${n.artemia} до ${n.artemia + bonus}`;
  g.tokens = { creature: m.creature, target: n.target ? t : null, artemia: a };
  g.phase = 'payoff';
  L(g, 'Істота розставила жетони. Починається Розплата.');
  return null;
}

// ===== Фаза 3: Розплата (генератор — зупиняється, коли потрібен вибір гравця) =====
function effAvail(g, p, loc) {
  switch (loc) {
    case 3: case 10: return !p.twoSet;
    case 4: return !g.flags.coast;
    case 8: return !g.flags.rubble;
    case 5: return [6, 7, 8, 9, 10].some(x => g.reserve[x] > 0 && !owns(p, x));
    case 7: return !g.flags.despair && (g.surv.deck.length + g.surv.disc.length) > 0;
    default: return true;
  }
}
function* pickRet(g, pid, n) {
  const p = g.P[pid], k = Math.min(n, p.disc.length);
  if (!k) return;
  if (k === p.disc.length) { p.hand = p.hand.concat(p.disc); p.disc = []; return; }
  for (;;) {
    const a = yield { kind: 'pickret', pid, n: k }, cs = a && a.cards;
    if (Array.isArray(cs) && cs.length === k && new Set(cs).size === k && cs.every(c => p.disc.includes(c))) {
      p.disc = p.disc.filter(c => !cs.includes(c)); p.hand.push(...cs); return;
    }
  }
}
function* doEffect(g, room, e, loc) {
  const p = g.P[e.pid], who = nm(room, e.pid);
  switch (loc) {
    case 1: {
      const cl = g.tokens.creature, canAll = p.disc.length > 0, canCopy = cl != null && cl !== 1 && cl !== 10 && effAvail(g, p, cl);
      if (!canAll && !canCopy) return;
      for (;;) {
        const a = yield { kind: 'lair', pid: e.pid, canAll, canCopy, copyLoc: cl };
        if (a && a.m === 'all' && canAll) { p.hand = p.hand.concat(p.disc); p.disc = []; L(g, `${who} (Лігво): повертає всі карти з відбою.`); return; }
        if (a && a.m === 'copy' && canCopy) { L(g, `${who} (Лігво): копіює «${LOC[cl][0]}».`); yield* doEffect(g, room, e, cl); return; }
      }
    }
    case 2: e.ret = true; p.ret.push(e.loc); yield* pickRet(g, e.pid, 1); return;
    case 6: p.ret.push(e.loc); yield* pickRet(g, e.pid, 2); return;
    case 3: case 10: if (!p.twoSet) { p.twoSet = true; p.nextTwo = loc === 3 ? 'river' : 'artefact'; L(g, `${who}: наступного ходу зіграє 2 карти.`); } return;
    case 4:
      if (!g.flags.coast) {
        g.flags.coast = true;
        if (g.transmitter) { g.transmitter = false; moveRescue(g, 1); L(g, `${who}: Передавач знято — Порятунок +1.`); }
        else { g.transmitter = true; L(g, `${who}: Передавач покладено на Узбережжя.`); }
      } return;
    case 8: if (!g.flags.rubble) { g.flags.rubble = true; moveRescue(g, 1); L(g, `${who} (Уламки): Порятунок +1.`); } return;
    case 5: {
      const opts = [6, 7, 8, 9, 10].filter(x => g.reserve[x] > 0 && !owns(p, x));
      if (!opts.length) return;
      for (;;) { const a = yield { kind: 'rover', pid: e.pid, opts }; if (a && opts.includes(a.c)) { g.reserve[a.c]--; p.hand.push(a.c); L(g, `${who} бере з резерву «${LOC[a.c][0]}».`); return; } }
    }
    case 7: {
      if (g.flags.despair) return;
      const cs = [drawSurv(g), drawSurv(g)].filter(Boolean);
      if (!cs.length) return;
      let keep = cs[0];
      if (cs.length === 2) for (;;) { const a = yield { kind: 'shelter', pid: e.pid, cards: cs }; if (a && cs.some(c => c.id === a.keep)) { keep = cs.find(c => c.id === a.keep); break; } }
      p.surv.push(keep); for (const c of cs) if (c !== keep) g.surv.disc.push(c);
      L(g, `${who} (Укриття): отримує карту Виживання.`); return;
    }
    case 9: for (;;) {
      const a = yield { kind: 'spring', pid: e.pid };
      if (!a) continue; if (a.skip) return;
      const t = g.P[a.target]; if (!t) continue;
      if (a.mode === 'will' && t.will < 3) { t.will++; L(g, `${who} (Джерело): ${nm(room, a.target)} повертає 1 Волю.`); return; }
      if (a.mode === 'card' && !g.flags.despair) { const c = drawSurv(g); if (c) { t.surv.push(c); L(g, `${who} (Джерело): ${nm(room, a.target)} отримує карту Виживання.`); return; } }
    }
  }
}
function* choose(g, room, e) {
  const p = g.P[e.pid];
  for (;;) {
    const av = effAvail(g, p, e.loc), cr = p.disc.length > 0;
    if (!av && !cr) return;
    const a = yield { kind: 'choose', pid: e.pid, loc: e.loc, canEffect: av, canReturn: cr };
    if (!a) continue;
    if (a.t === 'skip') return;
    if (a.t === 'return' && cr && p.disc.includes(a.c)) { p.disc = p.disc.filter(x => x !== a.c); p.hand.push(a.c); return; }
    if (a.t === 'effect' && av) { yield* doEffect(g, room, e, e.loc); return; }
  }
}
function* resolve(g, room) {
  const P = g.P;
  for (const pid of g.order) { // Річка: вибір до розкриття
    const p = P[pid];
    if (p.mode === 'river' && p.played.length === 2) for (;;) {
      const a = yield { kind: 'river', pid, cards: p.played.slice() };
      if (a && p.played.includes(a.keep)) { p.hand.push(p.played.find(c => c !== a.keep)); p.played = [a.keep]; break; }
    }
  }
  g.revealed = true;
  L(g, 'Астронавти відкривають карти: ' + g.order.map(id => `${nm(room, id)} — ${P[id].played.map(c => LOC[c][0]).join(' + ')}`).join('; '));
  for (const id of g.order) P[id].ready = g.flags.despair || P[id].surv.length === 0;
  if (!g.order.every(id => P[id].ready)) yield { kind: 'window' };

  const E = [], T = g.tokens, tgt = T.target || [];
  for (const pid of g.order) for (const loc of P[pid].played) E.push({ pid, loc });
  for (const e of E) {
    e.c = e.loc === T.creature && !P[e.pid].cunning;
    e.t = tgt.includes(e.loc);
    e.a = T.artemia.filter(x => x === e.loc).length;
  }
  for (const e of E) if (!e.c && !e.t && !e.a) yield* choose(g, room, e);       // 1. локації без жетонів
  for (const e of E) if (e.t && g.hunt.need.toxin) {                              // 2. жетон Цілі (Токсин / Марево: локація неактивна)
    const p = P[e.pid];
    if (p.surv.length === 1) { g.surv.disc.push(p.surv.pop()); L(g, `${nm(room, e.pid)} скидає карту Виживання (Токсин).`); }
    else if (p.surv.length > 1) for (;;) {
      const a = yield { kind: 'dsurv', pid: e.pid, cards: p.surv };
      const c = a && p.surv.find(x => x.id === a.id);
      if (c) { p.surv = p.surv.filter(x => x !== c); g.surv.disc.push(c); L(g, `${nm(room, e.pid)} скидає карту Виживання (Токсин).`); break; }
    }
  }
  for (const e of E) for (let i = 0; i < e.a; i++) {                              // 3. жетон Артемії
    const p = P[e.pid];
    if (p.hand.length === 1) { p.disc.push(p.hand.pop()); }
    else if (p.hand.length > 1) for (;;) { const a = yield { kind: 'dloc', pid: e.pid }; if (a && p.hand.includes(a.c)) { p.hand = p.hand.filter(x => x !== a.c); p.disc.push(a.c); break; } }
    L(g, `${nm(room, e.pid)} скидає карту Локації (Артемія).`);
  }
  let cap = false;                                                                // 4. жетон Істоти
  for (const e of E) if (e.c) {
    const p = P[e.pid]; cap = true;
    p.will = Math.max(0, p.will - (e.loc === 1 ? 2 : 1));
    if (p.will === 0) p.lost3 = true;
    L(g, `Істота схопила ${nm(room, e.pid)} у локації «${LOC[e.loc][0]}»${e.loc === 1 ? ' (−2 Волі)' : ''}.`);
  }
  if (cap) moveAssim(g, 1);
  if (E.some(e => e.c && P[e.pid].lost3)) { moveAssim(g, 1); L(g, 'Хтось втратив останню Волю — Асиміляція +1.'); }
  for (const id of g.order) if (P[id].lost3) { const p = P[id]; p.hand = p.hand.concat(p.disc); p.disc = []; p.will = g.expert ? 2 : 3; }
}
function run(room, ans) {
  const g = room.g, r = room.gen.next(ans);
  if (g.over) { room.gen = null; g.await = null; g.phase = 'over'; L(g, g.over === 'astro' ? 'Астронавти врятовані! Перемога Астронавтів.' : 'Планета асимілювала Астронавтів. Перемога Істоти.'); return; }
  if (r.done) { room.gen = null; g.await = null; endTurn(room); return; }
  g.await = r.value;
}
// ===== Фаза 4: Кінець ходу =====
function endTurn(room) {
  const g = room.g;
  for (const pid of g.order) { const p = g.P[pid]; for (const c of p.played) (p.ret.includes(c) ? p.hand : p.disc).push(c); p.played = []; }
  while (g.hunt.hand.length < 3) { const c = drawHunt(g); if (!c) break; g.hunt.hand.push(c); }
  moveRescue(g, 1);
  if (g.over) { g.phase = 'over'; L(g, 'Астронавти врятовані! Перемога Астронавтів.'); return; }
  g.turn++; resetTurn(g); L(g, `— Хід ${g.turn} —`);
}

// ===== Представлення стану для гравця (приховує чужі секрети) =====
function view(room, pid) {
  const v = { room: room.code, me: pid, host: room.hostId, expert: room.expert, creaturePick: room.creaturePick, started: !!room.g, players: room.players.map(p => ({ id: p.id, name: p.name, on: p.conn > 0 })), defs: { LOC, HUNT, SURV } };
  const g = room.g; if (!g) return v;
  const isC = pid === g.cid, show = g.revealed || g.phase === 'over';
  v.g = {
    turn: g.turn, phase: g.phase, rescue: g.rescue, assim: g.assim, goal: CFG.GOAL, art: CFG.ARTEMIA_SPACES, over: g.over, cid: g.cid, order: g.order,
    reserve: g.reserve, transmitter: g.transmitter, revealed: g.revealed, despair: g.flags.despair, bonus: CFG.ARTEMIA_SPACES.includes(g.rescue),
    tokens: (g.phase === 'payoff' || g.phase === 'over') ? g.tokens : null, log: g.log.slice(-60),
    hunt: { count: g.hunt.hand.length, deck: g.hunt.deck.length, played: g.hunt.played, need: g.hunt.need },
    P: Object.fromEntries(g.order.map(id => { const p = g.P[id]; return [id, { will: p.will, disc: p.disc, hand: p.hand.length, surv: p.surv.length, locked: p.locked, n: p.played.length, played: show ? p.played : null, ready: p.ready, action: p.action, two: !!p.mode }]; }))
  };
  if (isC) v.my = { hand: g.hunt.hand, clog: g.clog };
  else if (g.P[pid]) { const p = g.P[pid]; v.my = { hand: p.hand, surv: p.surv, played: p.played, mode: p.mode, survPlayed: p.survPlayed, will: p.will }; }
  if (g.await) v.g.await = g.await.pid === pid ? g.await : { kind: g.await.kind, pid: g.await.pid };
  return v;
}

// ===== API =====
const clean = s => String(s || '').replace(/[<>]/g, '').trim().slice(0, 16);
function api(m) {
  if (m.a === 'create') {
    const name = clean(m.name); if (!name) return { err: 'Введіть ім\'я' };
    const room = { code: newCode(), players: [], hostId: null, g: null, gen: null, clients: new Set(), last: Date.now(), expert: false, creaturePick: null };
    const pl = { id: rid(4), tk: rid(8), name, conn: 0 }; room.players.push(pl); room.hostId = pl.id; rooms.set(room.code, room);
    return { ok: 1, room: room.code, pid: pl.id, tk: pl.tk };
  }
  const room = rooms.get(String(m.room || '').toUpperCase());
  if (!room) return { err: 'Кімнату не знайдено' };
  if (m.a === 'join') {
    const name = clean(m.name); if (!name) return { err: 'Введіть ім\'я' };
    if (room.g) return { err: 'Гра вже почалась' };
    if (room.players.length >= 7) return { err: 'Кімната заповнена (максимум 7)' };
    const pl = { id: rid(4), tk: rid(8), name, conn: 0 }; room.players.push(pl); broadcast(room);
    return { ok: 1, room: room.code, pid: pl.id, tk: pl.tk };
  }
  const pl = room.players.find(p => p.id === m.pid && p.tk === m.tk);
  if (!pl) return { err: 'Недійсний гравець' };
  room.last = Date.now();
  const g = room.g; let err = null; const isHost = pl.id === room.hostId;
  const ast = g && g.P[pl.id], isC = g && pl.id === g.cid;
  switch (m.a) {
    case 'setCreature': if (!isHost || g) err = 'Недоступно'; else room.creaturePick = m.pick || null; break;
    case 'expert': if (!isHost || g) err = 'Недоступно'; else room.expert = !!m.v; break;
    case 'start': if (!isHost || g) err = 'Недоступно'; else if (room.players.length < 2) err = 'Потрібно щонайменше 2 гравці'; else startGame(room); break;
    case 'again': if (!isHost || !g || !g.over) err = 'Недоступно'; else { room.g = null; room.gen = null; } break;
    case 'submit': err = !g || !ast ? 'Лише для Астронавтів' : g.await ? 'Зачекайте' : submit(room, pl.id, m); break;
    case 'toHunt':
      if (!isC || g.phase !== 'recon' || g.await) err = 'Недоступно';
      else if (!g.order.every(id => g.P[id].locked)) err = 'Не всі Астронавти обрали локацію';
      else { g.phase = 'hunt'; L(g, 'Фаза 2: Полювання.'); } break;
    case 'playHunt': err = !isC || g.await ? 'Недоступно' : playHunt(room, m); break;
    case 'tokens': err = !isC || g.phase !== 'hunt' || g.await ? 'Недоступно' : placeTokens(room, m); if (!err) { room.gen = resolve(g, room); run(room); } break;
    case 'surv': err = !ast ? 'Лише для Астронавтів' : playSurv(room, pl.id, m); break;
    case 'ready':
      if (!ast || !g.await || g.await.kind !== 'window') err = 'Недоступно';
      else { ast.ready = true; if (g.order.every(id => g.P[id].ready)) run(room); } break;
    case 'answer': {
      const aw = g && g.await;
      if (!aw || aw.pid !== pl.id) { err = 'Зараз не ваша черга'; break; }
      if (aw.kind === 'phobia') {
        const hand = g.P[pl.id].hand, keep = (m.v && m.v.keep) || [];
        if (!Array.isArray(keep) || keep.length !== 2 || new Set(keep).size !== 2 || !keep.every(c => hand.includes(c))) { err = 'Оберіть 2 карти, які залишаться прихованими'; break; }
        g.clog.push(`Фобія → ${nm(room, pl.id)} показує: ${hand.filter(c => !keep.includes(c)).map(c => LOC[c][0]).join(', ')}.`);
        g.await = null; L(g, `${nm(room, pl.id)} показує Істоті карти (крім двох).`);
      } else run(room, m.v);
      break;
    }
    default: err = 'Невідома дія';
  }
  if (!err) broadcast(room);
  return err ? { err } : { ok: 1 };
}
function broadcast(room) {
  for (const c of room.clients) { try { c.res.write(`data: ${JSON.stringify(view(room, c.pid))}\n\n`); } catch (e) { } }
}

// ===== HTTP =====
const INDEX = path.join(__dirname, 'public', 'index.html');
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/events' || u.pathname === '/state') {
    const room = rooms.get((u.searchParams.get('room') || '').toUpperCase()), pid = u.searchParams.get('pid');
    const pl = room && room.players.find(p => p.id === pid && p.tk === u.searchParams.get('tk'));
    if (u.pathname === '/state') { res.writeHead(pl ? 200 : 403, { 'Content-Type': 'application/json' }); return res.end(pl ? JSON.stringify(view(room, pid)) : '{}'); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (!pl) { res.write('event: bad\ndata: 1\n\n'); return res.end(); }
    const c = { res, pid }; room.clients.add(c); pl.conn++; res.write(`data: ${JSON.stringify(view(room, pid))}\n\n`); broadcast(room);
    const hb = setInterval(() => res.write(': hb\n\n'), 15000);
    req.on('close', () => { clearInterval(hb); room.clients.delete(c); pl.conn--; broadcast(room); });
    return;
  }
  if (req.method === 'POST' && u.pathname === '/api') {
    let b = ''; req.on('data', d => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => {
      let out; try { out = api(JSON.parse(b || '{}')); } catch (e) { console.error(e); out = { err: 'Помилка сервера' }; }
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
    }); return;
  }
  fs.readFile(INDEX, (e, d) => { res.writeHead(e ? 500 : 200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(d || 'error'); });
}).listen(PORT, () => console.log('Хижа Планета: http://localhost:' + PORT));
setInterval(() => { for (const [k, r] of rooms) if (Date.now() - r.last > 12 * 3600e3) rooms.delete(k); }, 600e3);

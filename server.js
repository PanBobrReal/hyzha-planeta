'use strict';
// «Хижа Планета» — онлайн. Без залежностей: лише Node.js 18+.
// Сервер — єдине джерело правди: усі правила перевіряються тут.
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 3000;

// ===== НАЛАШТУВАННЯ — звірте з вашою фізичною коробкою =====
const CFG = {
  HUNT_LIMIT: 1,                // карт Полювання за хід (правила: «лише одну, якщо не зазначено протилежне»)
  COPIES: 3,                    // копій кожної карти Полювання в колоді (точний склад колоди Полювання в PDF не вказаний)
  SURV_COPIES: 1                // колода Виживання: по 1 карті кожного з 19 видів (за фото карт)
};

// Трек за фото поля: одна смуга з 31 комірки. Ліворуч Порятунок (нумеровані 7…2, далі 6 порожніх, далі 6 зелених «Артемія»),
// посередині зірка «Перемога», праворуч Асиміляція (6 порожніх, далі нумеровані 2…7). Фішки рухаються назустріч до зірки.
const TRK = { LEN: 31, STAR: 18, A0: 12, A1: 17 };
const inA = g => g.rescue >= TRK.A0 && g.rescue <= TRK.A1;
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
  dymova: { name: 'Димова завіса', phase: 1, text: 'Усі Астронавти ховають свої відбої карт Локацій від Істоти до кінця раунду.' },
  adrenalin: { name: 'Адреналін', phase: 1, text: 'Поверніть собі 1 фішку Волі.' },
  udar: { name: 'Удар у відповідь', phase: 1, text: 'Візьміть 2 випадкові карти Полювання з руки Істоти й покладіть їх під низ колоди Полювання.' },
  manevr: { name: 'Маневр', phase: 4, text: 'Візьміть на руку карту Локації, яку ви зіграли в цьому раунді.' },
  shoste: { name: 'Шосте чуття', phase: 1, text: 'Поверніть на руку 2 карти Локацій зі свого відбою.' },
  mimikriya: { name: 'Мімікрія', phase: 1, text: 'У Фазі 3, якщо ви в одній локації з жетоном Істоти: Порятунок +1, а дію жетона Істоти ігноруйте.' },
  holohrama: { name: 'Голограма', phase: 3, text: 'Перемістіть жетон Артемії в суміжну локацію.' },
  detektor: { name: 'Детектор', phase: 3, text: 'Ігноруйте дію жетона Артемії.' },
  tryvoha: { name: 'Тривога', phase: 3, text: 'Оберіть локацію: жетони Полювання в ній не діють, ефект цієї локації неактивний.' },
  brama: { name: 'Брама', phase: 3, late: true, text: 'Замість ефекту своєї локації скопіюйте ефект суміжної локації. Грається під час розрахунку вашої локації.' },
  hytrist: { name: 'Хитрість', phase: 3, text: 'Ігноруйте дію жетона Істоти.' },
  zhertva: { name: 'Жертва', phase: 1, text: 'Скиньте 1 карту Локації з руки. До кінця раунду Істота не може грати карти Полювання.' },
  vaktsyna: { name: 'Вакцина', phase: 1, text: 'Перемістіть жетон Асиміляції на 1 поділку назад.' },
  dron: { name: 'Дрон', phase: 3, late: true, text: 'Замість ефекту своєї локації скопіюйте ефект «Планетохід». Грається під час розрахунку вашої локації.' },
  pidsyliuvach: { name: 'Підсилювач', phase: 4, text: 'Приберіть Передавач з Узбережжя, щоб негайно посунути Порятунок на 1 поділку вперед.' },
  kryivka: { name: 'Криївка', phase: 1, text: 'Покладіть жетон Цілі на 2 суміжні локації: там не можна ставити жетон Істоти, а Істота не може грати карти Полювання з символом Цілі.' },
  vykhor: { name: 'Вихор', phase: 2, text: 'Поміняйте карту Локації, яку ви зіграли, на одну з карт Локацій зі свого відбою.' },
  vynakhidlyvist: { name: 'Винахідливість', phase: 1, text: 'Розмістіть Передавач на локації «Узбережжя».' },
  hybnyi: { name: 'Хибний слід', phase: 3, text: 'Перемістіть жетон Істоти в суміжну локацію.' }
};
const WIN3 = ['hytrist', 'hybnyi', 'holohrama', 'detektor', 'tryvoha']; // карти Фази 3, які грають у вікні перед розрахунком
const shelterLocs = g => [].concat(...g.flags.shelter);

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
    turn: 1, phase: 'recon', rescue: 7 - n, assim: 23 + n, over: null, cid, order, expert: room.expert,
    hunt: { hand: [], deck: [], disc: [], played: [], need: {} }, surv: { deck: [], disc: [] },
    reserve: { 6: c, 7: c, 8: c, 9: c, 10: c }, copies: c, transmitter: false, tokens: { creature: null, target: null, artemia: [] },
    flags: {}, P: {}, log: [], clog: [], await: null, revealed: false, nid: 1
  };
  const mk = (D, n) => shuffle(Object.keys(D).flatMap(k => Array.from({ length: n }, () => ({ id: g.nid++, k }))));
  g.hunt.deck = mk(HUNT, CFG.COPIES); g.surv.deck = mk(SURV, CFG.SURV_COPIES);
  g.hunt.hand = g.hunt.deck.splice(0, 3);
  for (const pid of order) g.P[pid] = { will: 3, hand: [1, 2, 3, 4, 5], disc: [], surv: [g.surv.deck.shift()], nextTwo: null };
  room.g = g; room.gen = null;
  resetTurn(g);
  L(g, `Гра почалась. Істота — ${nm(room, cid)}. Фішки Порятунку й Асиміляції стоять на комірках «${n}».`);
}
function resetTurn(g) {
  for (const id of g.order.filter(id => g.P[id].left)) delete g.P[id];
  g.order = g.order.filter(id => g.P[id]); g.endReady = [];
  g.phase = 'recon'; g.revealed = false;
  g.flags = { despair: false, coast: false, rubble: false, huntPlayed: 0, noHunt: false, smoke: false, shelter: [], alarm: [] };
  g.tokensSet = false;
  g.tokens = { creature: null, target: null, artemia: [] };
  g.hunt.played = []; g.hunt.need = { artemia: 0, target: false, mirage: false, toxin: false };
  for (const pid of g.order) {
    const p = g.P[pid];
    Object.assign(p, { mode: p.nextTwo || null, nextTwo: null, locked: false, played: [], action: null, survPlayed: false, cunning: false, mimic: false, detector: false, twoSet: false, ready: false, ret: [], lost3: false });
  }
}
const drawSurv = g => { const s = g.surv; if (!s.deck.length && s.disc.length) { s.deck = shuffle(s.disc); s.disc = []; } return s.deck.shift() || null; };
const drawHunt = g => { const h = g.hunt; if (!h.deck.length && h.disc.length) { h.deck = shuffle(h.disc); h.disc = []; } return h.deck.shift() || null; };
function moveRescue(g, n) { if (g.over) return; g.rescue = Math.min(TRK.STAR, g.rescue + n); if (g.rescue >= TRK.STAR) { g.over = 'astro'; g.phase = 'over'; } }
function moveAssim(g, n) { if (g.over) return; g.assim = Math.max(TRK.STAR, g.assim - n); if (g.assim <= TRK.STAR) { g.over = 'creature'; g.phase = 'over'; } }
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
function startWindow2(room) { // Фаза 2: після жетонів Істоти Астронавти можуть зіграти карти Фази 2 (Вихор)
  const g = room.g;
  for (const id of g.order) { const p = g.P[id]; p.ready = p.left || g.flags.despair || !p.surv.some(c => SURV[c.k].phase === 2); }
  if (g.order.every(id => g.P[id].ready)) beginPayoff(room); else g.await = { kind: 'window2' };
}
function beginPayoff(room) {
  const g = room.g; g.await = null; g.phase = 'payoff'; L(g, 'Починається Розплата.');
  room.gen = resolve(g, room); run(room);
}
function swapPlay(g, p, play) { // вибір локації можна змінити, поки Істота не перейшла до Полювання (дія Опір/Поступитися не скасовується)
  const pool = p.hand.concat(p.played);
  if (!Array.isArray(play) || play.length !== p.played.length || new Set(play).size !== play.length || !play.every(c => pool.includes(c))) return 'Некоректний вибір';
  p.hand = pool.filter(c => !play.includes(c)); p.played = play; return null;
}
function playHunt(room, m) {
  const g = room.g, h = g.hunt, c = h.hand.find(x => x.id === m.id);
  if (!c) return 'Немає такої карти';
  const d = HUNT[c.k];
  if (d.phase === 1 && g.phase !== 'recon') return 'Ця карта грається у Фазі 1';
  if (d.phase === 2 && g.phase !== 'hunt') return 'Ця карта грається у Фазі 2 (Полювання)';
  if (g.flags.huntPlayed >= CFG.HUNT_LIMIT) return 'Можна зіграти лише одну карту Полювання за хід';
  if (g.flags.noHunt) return 'Жертва: до кінця раунду Істота не може грати карти Полювання';
  if (d.sym === 'T' && g.flags.shelter.length) return 'Криївка: карти Полювання з символом Цілі зараз не можна грати';
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
  const d = SURV[c.k], aw = g.await ? g.await.kind : null;
  if (g.flags.despair) return 'Відчай: карти Виживання зараз не можна грати';
  if (p.survPlayed) return 'Лише одна карта Виживання за хід';
  if (d.late) return 'Ця карта грається під час розрахунку вашої локації: кнопка з\'явиться у виборі дії';
  const ok = d.phase === 1 ? g.phase === 'recon' && !aw
    : d.phase === 2 ? g.phase === 'hunt' && (!aw || aw === 'window2')
    : d.phase === 3 ? g.phase === 'payoff' && aw === 'window'
    : g.phase === 'end';
  if (!ok) return aw && aw !== 'window' && aw !== 'window2' ? 'Зачекайте' : `Ця карта грається у Фазі ${d.phase}`;
  switch (c.k) {
    case 'dymova': g.flags.smoke = true; break;
    case 'adrenalin': if (p.will >= 3) return 'Воля вже максимальна'; p.will++; break;
    case 'udar': { const h = g.hunt; for (let i = 0; i < 2 && h.hand.length; i++) h.deck.push(h.hand.splice(rnd(h.hand.length), 1)[0]); break; }
    case 'manevr': {
      const loc = p.played.length === 1 ? p.played[0] : m.loc;
      if (!p.played.includes(loc)) return 'Оберіть карту, яку ви зіграли';
      if (p.ret.includes(loc)) return 'Ця карта й так повернеться в руку';
      p.ret.push(loc); break;
    }
    case 'shoste': {
      const k = Math.min(2, p.disc.length), cs = m.cards || [];
      if (!Array.isArray(cs) || cs.length !== k || new Set(cs).size !== k || !cs.every(x => p.disc.includes(x))) return `Оберіть карт з відбою: ${k}`;
      p.disc = p.disc.filter(x => !cs.includes(x)); p.hand.push(...cs); break;
    }
    case 'mimikriya': p.mimic = true; break;
    case 'holohrama': {
      const arr = g.tokens.artemia;
      if (!arr.includes(m.from) || !okLoc(m.to) || !adj(m.from, m.to)) return 'Оберіть жетон Артемії та сусідню локацію';
      arr[arr.indexOf(m.from)] = m.to; break;
    }
    case 'detektor': p.detector = true; break;
    case 'tryvoha': if (!okLoc(m.loc)) return 'Оберіть локацію'; g.flags.alarm.push(m.loc); break;
    case 'hytrist': p.cunning = true; break;
    case 'hybnyi':
      if (!okLoc(m.loc) || g.tokens.creature == null || !adj(g.tokens.creature, m.loc)) return 'Оберіть сусідню локацію';
      if (shelterLocs(g).includes(m.loc)) return 'Криївка: сюди не можна перемістити жетон Істоти';
      g.tokens.creature = m.loc; break;
    case 'zhertva':
      if (!p.hand.includes(m.c)) return 'Оберіть карту Локації з руки';
      p.hand = p.hand.filter(x => x !== m.c); p.disc.push(m.c); g.flags.noHunt = true; break;
    case 'vaktsyna': if (g.assim >= TRK.LEN - 1) return 'Асиміляція вже на самому початку треку'; g.assim++; break;
    case 'pidsyliuvach': if (!g.transmitter) return 'На Узбережжі немає Передавача'; g.transmitter = false; moveRescue(g, 1); break;
    case 'kryivka': {
      const ls = m.locs;
      if (!Array.isArray(ls) || ls.length !== 2 || !ls.every(okLoc) || !adj(ls[0], ls[1])) return 'Оберіть дві суміжні локації';
      if (new Set([...shelterLocs(g), ...ls]).size >= 10) return 'Криївка: Істота не зможе розмістити жетон — оберіть інші локації';
      g.flags.shelter.push(ls.slice()); break;
    }
    case 'vykhor': {
      const from = p.played.length === 1 ? p.played[0] : m.from;
      if (!p.played.includes(from) || !p.disc.includes(m.to)) return 'Оберіть карту, яку міняєте, і карту з відбою';
      p.played = p.played.map(x => x === from ? m.to : x); p.disc = p.disc.filter(x => x !== m.to); p.disc.push(from); break;
    }
    case 'vynakhidlyvist': if (g.transmitter) return 'Передавач уже лежить на Узбережжі'; g.transmitter = true; break;
  }
  p.surv = p.surv.filter(x => x !== c); g.surv.disc.push(c); p.survPlayed = true;
  L(g, `${nm(room, pid)} грає карту Виживання «${d.name}».`);
  if (g.over) { room.gen = null; g.await = null; g.phase = 'over'; L(g, 'Астронавти врятовані! Перемога Астронавтів.'); }
  return null;
}

// ===== Фаза 2: жетони Полювання =====
function placeTokens(room, m) {
  const g = room.g, n = g.hunt.need, bonus = inA(g) ? 1 : 0;
  if (!okLoc(m.creature)) return 'Розмістіть жетон Істоти';
  if (shelterLocs(g).includes(m.creature)) return 'Криївка: у цій локації не можна розміщувати жетон Істоти';
  const t = Array.isArray(m.target) ? m.target : [], a = Array.isArray(m.artemia) ? m.artemia : [];
  if (!t.every(okLoc) || !a.every(okLoc)) return 'Некоректна локація';
  if (n.target) {
    if (n.mirage ? !(t.length === 2 && adj(t[0], t[1])) : t.length !== 1) return n.mirage ? 'Жетон Цілі: оберіть дві суміжні локації' : 'Розмістіть жетон Цілі';
  } else if (t.length) return 'Жетон Цілі не потрібен';
  if (a.length < n.artemia || a.length > n.artemia + bonus) return `Жетонів Артемії: від ${n.artemia} до ${n.artemia + bonus}`;
  g.tokens = { creature: m.creature, target: n.target ? t : null, artemia: a }; g.tokensSet = true;
  L(g, 'Істота розставила жетони.');
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
function altSurv(g, p, e) { // карти Виживання, що замінюють ефект локації (Брама, Дрон)
  if (g.flags.despair || p.survPlayed) return [];
  const alts = [];
  for (const c of p.surv) {
    if (c.k === 'brama') { const opts = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(l => adj(e.loc, l) && effAvail(g, p, l)); if (opts.length) alts.push({ id: c.id, k: 'brama', opts }); }
    if (c.k === 'dron' && effAvail(g, p, 5)) alts.push({ id: c.id, k: 'dron' });
  }
  return alts;
}
function useSurv(g, room, pid, id) {
  const p = g.P[pid], c = p.surv.find(x => x.id === id);
  p.surv = p.surv.filter(x => x !== c); g.surv.disc.push(c); p.survPlayed = true;
  L(g, `${nm(room, pid)} грає карту Виживання «${SURV[c.k].name}».`);
}
function* choose(g, room, e) {
  const p = g.P[e.pid];
  for (;;) {
    const av = effAvail(g, p, e.loc), cr = p.disc.length > 0, alts = altSurv(g, p, e);
    if (!av && !cr && !alts.length) return;
    const a = yield { kind: 'choose', pid: e.pid, loc: e.loc, canEffect: av, canReturn: cr, alts };
    if (!a) continue;
    if (a.t === 'skip') return;
    if (a.t === 'return' && cr && p.disc.includes(a.c)) { p.disc = p.disc.filter(x => x !== a.c); p.hand.push(a.c); return; }
    if (a.t === 'effect' && av) { yield* doEffect(g, room, e, e.loc); return; }
    if (a.t === 'surv') {
      const alt = alts.find(x => x.id === a.id); if (!alt) continue;
      if (alt.k === 'brama' && alt.opts.includes(a.loc)) { useSurv(g, room, e.pid, alt.id); yield* doEffect(g, room, e, a.loc); return; }
      if (alt.k === 'dron') { useSurv(g, room, e.pid, alt.id); yield* doEffect(g, room, e, 5); return; }
    }
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
  for (const id of g.order) P[id].ready = P[id].left || g.flags.despair || !P[id].surv.some(c => WIN3.includes(c.k));
  if (!g.order.every(id => P[id].ready)) yield { kind: 'window' };

  const E = [], T = g.tokens, tgt = T.target || [], alarm = g.flags.alarm;
  for (const pid of g.order) for (const loc of P[pid].played) E.push({ pid, loc });
  for (const e of E) {
    const p = P[e.pid], ign = p.cunning || p.mimic;               // Хитрість / Мімікрія: жетон Істоти не діє
    e.dead = alarm.includes(e.loc);                                // Тривога: жетони не діють, ефект локації неактивний
    e.c = !e.dead && e.loc === T.creature && !ign;
    e.t = !e.dead && tgt.includes(e.loc);
    e.a = (e.dead || p.detector) ? 0 : T.artemia.filter(x => x === e.loc).length; // Детектор: Артемія не діє
  }
  for (const e of E) if (!e.c && !e.t && !e.a && !e.dead) yield* choose(g, room, e);       // 1. локації без жетонів
  const toxDone = new Set();
  for (const e of E) if (e.t && g.hunt.need.toxin && !toxDone.has(e.pid)) {      // 2. жетон Цілі (Токсин / Марево: локація неактивна); 1 карта на Астронавта
    toxDone.add(e.pid); const p = P[e.pid];
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
  for (const pid of g.order) { const p = P[pid]; if (p.mimic && p.played.includes(T.creature)) { moveRescue(g, 1); L(g, `${nm(room, pid)} (Мімікрія): Порятунок +1.`); } }
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
function autoAns(g, a) { // відповіді за гравця, який вийшов
  const p = g.P[a.pid];
  switch (a.kind) {
    case 'river': return { keep: a.cards[0] };
    case 'choose': return { t: 'skip' };
    case 'lair': return a.canAll ? { m: 'all' } : { m: 'copy' };
    case 'pickret': return { cards: p.disc.slice(0, a.n) };
    case 'rover': return { c: a.opts[0] };
    case 'shelter': return { keep: a.cards[0].id };
    case 'spring': return { skip: 1 };
    case 'dsurv': return { id: a.cards[0].id };
    case 'dloc': return { c: p.hand[0] };
  }
}
function run(room, ans) {
  const g = room.g; let r = room.gen.next(ans), guard = 0;
  while (!r.done && !g.over && guard++ < 300 && r.value.pid && g.P[r.value.pid] && g.P[r.value.pid].left) r = room.gen.next(autoAns(g, r.value));
  if (g.over) { room.gen = null; g.await = null; g.phase = 'over'; L(g, g.over === 'astro' ? 'Астронавти врятовані! Перемога Астронавтів.' : 'Планета асимілювала Астронавтів. Перемога Істоти.'); return; }
  if (r.done) { room.gen = null; g.await = null; g.phase = 'end'; g.endReady = []; L(g, 'Фаза 4: Кінець ходу. Перегляньте результат і натисніть «Готовий».'); return; }
  g.await = r.value;
}
function autoSubmit(room, pid) {
  const p = room.g.P[pid], k = p.mode ? 2 : 1;
  submit(room, pid, p.hand.length ? { action: 'none', play: p.hand.slice(0, k) } : { action: 'surrender', play: p.disc.slice(0, k) });
}
function settleOnce(room) { // автопілот для гравців, які вийшли
  const g = room.g; if (!g || g.over) return false;
  const left = id => g.P[id] && g.P[id].left;
  if (g.await && g.await.kind === 'phobia' && left(g.await.pid)) { g.clog.push(`Фобія → ${nm(room, g.await.pid)}: гравець вийшов, карти не показано.`); g.await = null; return true; }
  if (g.phase === 'recon' && !g.await) { let d = false; for (const id of g.order) if (left(id) && !g.P[id].locked) { autoSubmit(room, id); d = true; } if (d) return true; }
  if (g.await && (g.await.kind === 'window' || g.await.kind === 'window2')) {
    let ch = false; for (const id of g.order) if (left(id) && !g.P[id].ready) { g.P[id].ready = true; ch = true; }
    if (ch && g.order.every(id => g.P[id].ready)) { if (g.await.kind === 'window2') beginPayoff(room); else run(room); return true; }
  }
  if (g.phase === 'end') {
    const need = [g.cid, ...g.order].filter(id => !(room.players.find(p => p.id === id) || {}).left);
    if (need.every(id => g.endReady.includes(id))) { endTurn(room); return true; }
  }
  return false;
}
const settle = room => { for (let i = 0; i < 8 && settleOnce(room); i++); };
function leave(room, pl) {
  const g = room.g;
  for (const c of [...room.clients]) if (c.pid === pl.id) { room.clients.delete(c); try { c.res.end(); } catch (e) { } }
  if (!g) { room.players = room.players.filter(p => p !== pl); if (room.creaturePick === pl.id) room.creaturePick = null; }
  else {
    pl.left = true; if (g.P[pl.id]) g.P[pl.id].left = true; L(g, `${pl.name} вийшов з гри.`);
    if (pl.id === g.cid && !g.over) { g.over = 'abort'; g.phase = 'over'; room.gen = null; g.await = null; L(g, 'Істота вийшла — гру завершено.'); }
  }
  const alive = room.players.filter(p => !p.left);
  if (!alive.length) { rooms.delete(room.code); return; }
  if (room.hostId === pl.id) room.hostId = alive[0].id;
  if (g && !g.over && !g.order.some(id => !g.P[id].left)) { g.over = 'abort'; g.phase = 'over'; room.gen = null; g.await = null; L(g, 'Астронавтів не лишилось — гру завершено.'); }
  settle(room); broadcast(room);
}
// ===== Фаза 4: Кінець ходу =====
function endTurn(room) {
  const g = room.g;
  for (const pid of g.order) { const p = g.P[pid]; for (const c of p.played) (p.ret.includes(c) ? p.hand : p.disc).push(c); p.played = []; }
  while (g.hunt.hand.length < 3) { const c = drawHunt(g); if (!c) break; g.hunt.hand.push(c); }
  moveRescue(g, 1);
  if (g.over) { g.phase = 'over'; L(g, 'Астронавти врятовані! Перемога Астронавтів.'); return; }
  g.turn++; resetTurn(g); L(g, `— Хід ${g.turn} —`);
  if (!g.order.length) { g.over = 'abort'; g.phase = 'over'; L(g, 'Астронавтів не лишилось — гру завершено.'); }
}

// ===== Представлення стану для гравця (приховує чужі секрети) =====
function view(room, pid) {
  const v = { room: room.code, me: pid, host: room.hostId, expert: room.expert, creaturePick: room.creaturePick, started: !!room.g, players: room.players.map(p => ({ id: p.id, name: p.name, on: p.conn > 0, left: !!p.left })), defs: { LOC, HUNT, SURV } };
  const g = room.g; if (!g) return v;
  const isC = pid === g.cid, show = g.revealed || g.phase === 'over';
  v.g = {
    turn: g.turn, phase: g.phase, rescue: g.rescue, assim: g.assim, star: TRK.STAR, len: TRK.LEN, a0: TRK.A0, a1: TRK.A1, over: g.over, cid: g.cid, order: g.order,
    reserve: g.reserve, copies: g.copies, transmitter: g.transmitter, revealed: g.revealed, despair: g.flags.despair, bonus: inA(g), endWait: g.phase === 'end' ? [g.cid, ...g.order].filter(id => !(room.players.find(p => p.id === id) || {}).left && !g.endReady.includes(id)) : [],
    tokens: (g.tokensSet || g.phase === 'payoff' || g.phase === 'end' || g.phase === 'over') ? g.tokens : null,
    fx: { despair: g.flags.despair, noHunt: g.flags.noHunt, smoke: g.flags.smoke, shelter: g.flags.shelter, alarm: g.flags.alarm }, log: g.log.slice(-60),
    hunt: { count: g.hunt.hand.length, deck: g.hunt.deck.length, played: g.hunt.played, need: g.hunt.need },
    P: Object.fromEntries(g.order.map(id => { const p = g.P[id]; return [id, { left: !!p.left, will: p.will, disc: (isC && g.flags.smoke) ? null : p.disc, hand: p.hand.length, surv: p.surv.length, locked: p.locked, n: p.played.length, played: show ? p.played : null, ready: p.ready, action: p.action, two: !!p.mode }]; }))
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
    if (room.g) return { err: 'Гра вже почалась. Приєднатись можна між партіями' };
    if (room.players.length >= 7) return { err: 'Кімната заповнена (максимум 7)' };
    const pl = { id: rid(4), tk: rid(8), name, conn: 0 }; room.players.push(pl); broadcast(room);
    return { ok: 1, room: room.code, pid: pl.id, tk: pl.tk };
  }
  const pl = room.players.find(p => p.id === m.pid && p.tk === m.tk && !p.left);
  if (!pl) return { err: 'Недійсний гравець' };
  room.last = Date.now();
  const g = room.g; let err = null; const isHost = pl.id === room.hostId;
  const ast = g && g.P[pl.id], isC = g && pl.id === g.cid;
  switch (m.a) {
    case 'setCreature': if (!isHost || g) err = 'Недоступно'; else room.creaturePick = m.pick || null; break;
    case 'expert': if (!isHost || g) err = 'Недоступно'; else room.expert = !!m.v; break;
    case 'start': if (!isHost || g) err = 'Недоступно'; else if (room.players.length < 2) err = 'Потрібно щонайменше 2 гравці'; else startGame(room); break;
    case 'again': if (!isHost || !g || !g.over) err = 'Недоступно'; else { room.g = null; room.gen = null; room.players = room.players.filter(p => !p.left); } break;
    case 'leave': leave(room, pl); return { ok: 1 };
    case 'close':
      if (!isHost) { err = 'Лише господар кімнати може закрити її'; break; }
      for (const c of room.clients) { try { c.res.write('event: closed\ndata: 1\n\n'); c.res.end(); } catch (e) { } }
      rooms.delete(room.code); return { ok: 1 };
    case 'endready':
      if (!g || g.phase !== 'end' || (!ast && !isC)) err = 'Недоступно';
      else if (!g.endReady.includes(pl.id)) g.endReady.push(pl.id); break;
    case 'submit': err = !g || !ast ? 'Лише для Астронавтів' : g.await ? 'Зачекайте' : submit(room, pl.id, m); break;
    case 'swap': err = !ast || g.phase !== 'recon' || g.await || !ast.locked ? 'Зараз не можна змінити вибір' : swapPlay(g, ast, m.play); break;
    case 'kick': { const t = room.players.find(p => p.id === m.target); if (!isHost || !t || t === pl || t.left) err = 'Недоступно'; else { leave(room, t); return { ok: 1 }; } break; }
    case 'toHunt':
      if (!isC || g.phase !== 'recon' || g.await) err = 'Недоступно';
      else if (!g.order.every(id => g.P[id].locked)) err = 'Не всі Астронавти обрали локацію';
      else { g.phase = 'hunt'; L(g, 'Фаза 2: Полювання.'); } break;
    case 'playHunt': err = !isC || g.await ? 'Недоступно' : playHunt(room, m); break;
    case 'tokens': err = !isC || g.phase !== 'hunt' || g.await ? 'Недоступно' : placeTokens(room, m); if (!err) startWindow2(room); break;
    case 'surv': err = !ast ? 'Лише для Астронавтів' : playSurv(room, pl.id, m); break;
    case 'ready': {
      const k = g && g.await && g.await.kind;
      if (!ast || (k !== 'window' && k !== 'window2')) err = 'Недоступно';
      else { ast.ready = true; if (g.order.every(id => g.P[id].ready)) { if (k === 'window2') beginPayoff(room); else run(room); } } break;
    }
    case 'debug': { // лише для автотестів: HP_TEST=1 node server.js
      if (!process.env.HP_TEST || !g) { err = 'Недоступно'; break; }
      const q = m.q || {}, t = g.P[q.pid] || ast;
      if (q.surv) t.surv = q.surv.map(k => ({ id: g.nid++, k }));
      if (q.hunt) g.hunt.hand = q.hunt.map(k => ({ id: g.nid++, k }));
      for (const f of ['will', 'disc', 'hand']) if (q[f] != null) t[f] = q[f];
      for (const f of ['transmitter', 'rescue', 'assim']) if (q[f] != null) g[f] = q[f];
      break;
    }
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
  if (!err) { settle(room); broadcast(room); }
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
    const pl = room && room.players.find(p => p.id === pid && p.tk === u.searchParams.get('tk') && !p.left);
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

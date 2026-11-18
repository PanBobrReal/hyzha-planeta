// Імітація партій випадковими ботами: перевіряє, що сервер не падає і гра завжди завершується.
// Запуск: node server.js  (в одному терміналі), node tests/bots.js 3 20  (кількість гравців, партій)
const B = 'http://localhost:' + (process.env.PORT || 3000);
const post = async b => (await fetch(B + '/api', { method: 'POST', body: JSON.stringify(b) })).json();
const get = async (s) => (await fetch(`${B}/state?room=${s.room}&pid=${s.pid}&tk=${s.tk}`)).json();
const pick = a => a[Math.floor(Math.random() * a.length)];
const sub = (a, n) => a.slice().sort(() => Math.random() - .5).slice(0, n);
const adj = (a, b) => Math.abs(((a - 1) / 5 | 0) - ((b - 1) / 5 | 0)) + Math.abs((a - 1) % 5 - (b - 1) % 5) === 1;

async function act(s, S) {
  const g = S.g, my = S.my, aw = g.await, isC = s.pid === g.cid, send = (a, x = {}) => post({ a, room: s.room, pid: s.pid, tk: s.tk, ...x });
  if (g.phase === 'over') return false;
  if (aw && aw.pid === s.pid) {
    const p = g.P[s.pid];
    switch (aw.kind) {
      case 'phobia': return send('answer', { v: { keep: sub(my.hand, 2) } });
      case 'river': return send('answer', { v: { keep: pick(aw.cards) } });
      case 'choose': return send('answer', { v: pick([...(aw.canEffect ? [{ t: 'effect' }] : []), ...(aw.canReturn ? [{ t: 'return', c: pick(p.disc) }] : []), { t: 'skip' }]) });
      case 'lair': return send('answer', { v: aw.canCopy && (!aw.canAll || Math.random() < .5) ? { m: 'copy' } : { m: 'all' } });
      case 'pickret': return send('answer', { v: { cards: sub(p.disc, aw.n) } });
      case 'rover': return send('answer', { v: { c: pick(aw.opts) } });
      case 'shelter': return send('answer', { v: { keep: pick(aw.cards).id } });
      case 'spring': return send('answer', { v: { target: pick(g.order), mode: pick(['will', 'card']), skip: Math.random() < .3 } });
      case 'dsurv': return send('answer', { v: { id: pick(aw.cards).id } });
      case 'dloc': return send('answer', { v: { c: pick(my.hand) } });
      case 'window': {
        if (!p.ready && my.surv.length && !my.survPlayed && !g.despair && Math.random() < .6) {
          const c = pick(my.surv.filter(x => x.k === 'hytrist' || x.k === 'hybnyi'));
          if (c) { const r = await send('surv', { id: c.id, loc: g.tokens.creature && pick([...Array(10).keys()].map(i => i + 1).filter(l => adj(g.tokens.creature, l))) }); if (!r.err) return r; }
        }
        return send('ready');
      }
    }
  }
  if (aw) { if (aw.kind === 'window' && !isC && !g.P[s.pid].ready) return send('ready'); return false; }
  if (isC) {
    if (g.phase === 'recon') {
      if (Math.random() < .3) { const c = my.hand.find(x => x.k === 'vidchaj'); if (c && g.hunt.played.length === 0) await send('playHunt', { id: c.id }); }
      if (g.order.every(id => g.P[id].locked)) return send('toHunt');
    }
    if (g.phase === 'hunt') {
      const cs = my.hand.filter(x => x.k !== 'vidchaj');
      if (g.hunt.played.length === 0 && cs.length && Math.random() < .8) { const c = pick(cs); const r = await send('playHunt', { id: c.id, target: pick(g.order) }); if (r.err) console.log('hunt err', r.err); return r; }
      S = await get(s); const n = S.g.hunt.need, L = () => 1 + Math.floor(Math.random() * 10);
      const t = []; if (n.target) { const a = L(); t.push(a); if (n.mirage) { const b = pick([...Array(10).keys()].map(i => i + 1).filter(l => adj(a, l))); t.push(b); } }
      const a = Array.from({ length: n.artemia + (S.g.bonus && Math.random() < .5 ? 1 : 0) }, L);
      return send('tokens', { creature: L(), target: t, artemia: a });
    }
    return false;
  }
  const p = g.P[s.pid];
  if (g.phase === 'recon' && !p.locked) {
    for (let tries = 0; tries < 30; tries++) {
      const opts = ['none', 'none']; if (p.disc.length >= 2) opts.push('resist2'); if (p.disc.length >= 4) opts.push('resist4'); opts.push('surrender');
      const action = pick(opts); let res = [], hand = my.hand.slice();
      if (action === 'resist2') res = sub(p.disc, 2); if (action === 'resist4') res = sub(p.disc, 4);
      hand = hand.concat(res); if (action === 'surrender') hand = hand.concat(p.disc);
      const play = sub(hand, Math.min(my.mode ? 2 : 1, hand.length));
      const r = await send('submit', { action, resist: res, play });
      if (!r.err) return r;
    }
  }
  if (my.surv.length && !g.despair && !my.survPlayed && g.phase === 'recon' && Math.random() < .3) {
    const c = my.surv.find(x => x.k === 'udar' || x.k === 'shoste');
    if (c) return send('surv', { id: c.id, cards: sub(p.disc, Math.min(2, p.disc.length)) });
  }
  return false;
}

async function play(n) {
  const h = await post({ a: 'create', name: 'B0' }); const ses = [{ ...h }];
  for (let i = 1; i < n; i++) ses.push(await post({ a: 'join', room: h.room, name: 'B' + i }));
  await post({ a: 'expert', room: h.room, pid: h.pid, tk: h.tk, v: Math.random() < .3 });
  const st = await post({ a: 'start', room: h.room, pid: h.pid, tk: h.tk }); if (st.err) throw new Error(st.err);
  let idle = 0, steps = 0;
  for (;;) {
    let did = false, last;
    for (const s of ses) {
      const S = await get(s); last = S; if (!S.g) continue;
      if (S.g.phase === 'over') return { over: S.g.over, turns: S.g.turn, steps };
      const r = await act(s, S); if (r && !r.err) { did = true; steps++; } else if (r && r.err && !/Зачекайте|Недоступно|не ваша/.test(r.err)) console.log('  err:', r.err);
    }
    if (!did) { if (++idle > 5) { console.log(JSON.stringify(last.g.await), last.g.phase, last.g.log.slice(-4)); throw new Error('STALL'); } } else idle = 0;
    if (steps > 4000) throw new Error('too many steps');
  }
}
(async () => {
  const n = +process.argv[2] || 3, games = +process.argv[3] || 10, res = { astro: 0, creature: 0 }; let turns = 0;
  for (let i = 0; i < games; i++) { const r = await play(n); res[r.over]++; turns += r.turns; }
  console.log(`players=${n} games=${games}`, res, 'avg turns', (turns / games).toFixed(1));
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });

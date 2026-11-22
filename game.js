// Durak ("Durnius") game logic — pure, host-authoritative.
(function (exp) {
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = [6, 7, 8, 9, 10, 11, 12, 13, 14];
  const HAND = 6;

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const cid = c => c.r + c.s;
  const sameCard = (a, b) => a.r === b.r && a.s === b.s;

  function beats(def, att, trump) {
    if (def.s === att.s) return def.r > att.r;
    return def.s === trump && att.s !== trump;
  }

  function newGame(players) {
    const deck = [];
    for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
    shuffle(deck);
    const st = {
      players: players.map(p => ({ id: p.id, name: p.name, hand: [], out: false })),
      deck, trumpCard: deck[0], trumpSuit: deck[0].s,
      table: [], discard: 0, attacker: 0, defender: 1,
      passed: {}, taking: false, boutLimit: 6, over: false, loser: null,
      msg: '', round: 1,
    };
    for (let k = 0; k < HAND; k++) for (const p of st.players) p.hand.push(st.deck.pop());
    // first attacker: lowest trump
    let best = null;
    st.players.forEach((p, i) => p.hand.forEach(c => {
      if (c.s === st.trumpSuit && (!best || c.r < best.r)) best = { r: c.r, i };
    }));
    st.attacker = best ? best.i : 0;
    startBout(st);
    st.msg = st.players[st.attacker].name + ' pradeda' +
      (best ? ' (mažiausias koziris)' : '');
    return st;
  }

  function nextActive(st, i) {
    const n = st.players.length;
    for (let k = 1; k <= n; k++) {
      const j = (i + k) % n;
      if (!st.players[j].out) return j;
    }
    return -1;
  }

  function startBout(st) {
    st.defender = nextActive(st, st.attacker);
    st.table = [];
    st.passed = {};
    st.taking = false;
    st.boutLimit = Math.min(6, st.players[st.defender].hand.length);
  }

  const unbeaten = st => st.table.filter(t => !t.d).length;
  const tableRanks = st => {
    const s = new Set();
    st.table.forEach(t => { s.add(t.a.r); if (t.d) s.add(t.d.r); });
    return s;
  };

  function canAttack(st, pi, card) {
    if (st.over || pi === st.defender || st.players[pi].out) return false;
    if (st.table.length >= st.boutLimit) return false;
    if (unbeaten(st) + 1 > st.players[st.defender].hand.length) return false;
    if (st.table.length === 0) return pi === st.attacker;
    return tableRanks(st).has(card.r);
  }

  function canDefend(st, pi, idx, card) {
    if (st.over || pi !== st.defender || st.taking) return false;
    const t = st.table[idx];
    return !!t && !t.d && beats(card, t.a, st.trumpSuit);
  }

  function takeCard(p, card) {
    const i = p.hand.findIndex(c => sameCard(c, card));
    if (i < 0) return null;
    return p.hand.splice(i, 1)[0];
  }

  // Players who could still throw in (not defender, still holding cards, not passed)
  function pendingAttackers(st) {
    const res = [];
    st.players.forEach((p, i) => {
      if (i === st.defender || p.out || p.hand.length === 0) return;
      if (!st.passed[i]) res.push(i);
    });
    return res;
  }

  function checkBout(st) {
    if (st.table.length === 0) return;
    const allBeaten = unbeaten(st) === 0;
    const full = st.table.length >= st.boutLimit ||
      (st.taking ? unbeaten(st) >= st.players[st.defender].hand.length : false);
    const noOne = pendingAttackers(st).length === 0;
    if (st.taking) {
      if (full || noOne) endBout(st, false);
    } else if (allBeaten) {
      if (full || noOne || st.players[st.defender].hand.length === 0) endBout(st, true);
    }
  }

  function endBout(st, beaten) {
    const def = st.players[st.defender];
    st.lastEnd = { seq: (st.lastEnd ? st.lastEnd.seq : 0) + 1, beaten, def: st.defender };
    if (beaten) {
      st.discard += st.table.length * 2;
      st.msg = 'Mušta! ' + def.name + ' atsigynė.';
    } else {
      st.table.forEach(t => { def.hand.push(t.a); if (t.d) def.hand.push(t.d); });
      st.msg = def.name + ' paėmė kortas.';
    }
    st.table = [];
    // refill: attacker first, around the table, defender last
    const n = st.players.length;
    const order = [];
    for (let k = 0; k < n; k++) {
      const j = (st.attacker + k) % n;
      if (j !== st.defender) order.push(j);
    }
    order.push(st.defender);
    for (const j of order) {
      const p = st.players[j];
      if (p.out) continue;
      while (p.hand.length < HAND && st.deck.length) p.hand.push(st.deck.pop());
    }
    if (st.deck.length === 0) st.players.forEach(p => { if (p.hand.length === 0) p.out = true; });
    const active = st.players.map((p, i) => i).filter(i => !st.players[i].out);
    if (active.length <= 1) {
      st.over = true;
      st.loser = active.length ? active[0] : null;
      st.msg = active.length
        ? st.players[active[0]].name + ' — DURNIUS! 🃏'
        : 'Lygiosios — niekas neliko durniumi!';
      return;
    }
    let next;
    if (beaten) next = def.out ? nextActive(st, st.defender) : st.defender;
    else next = nextActive(st, st.defender);
    st.attacker = next;
    st.round++;
    startBout(st);
  }

  // action: {type:'attack', card} | {type:'defend', idx, card} | {type:'take'} | {type:'pass'}
  function apply(st, pi, a) {
    if (st.over) return 'Partija baigta';
    const p = st.players[pi];
    if (!p) return 'Nežinomas žaidėjas';
    switch (a.type) {
      case 'attack': {
        if (!canAttack(st, pi, a.card)) return 'Šios kortos mesti negalima';
        const c = takeCard(p, a.card); if (!c) return 'Neturi tokios kortos';
        st.table.push({ a: c, d: null, by: pi });
        st.passed = {};
        st.msg = p.name + ' meta ' + label(c);
        break;
      }
      case 'defend': {
        if (!canDefend(st, pi, a.idx, a.card)) return 'Šia korta nesumuši';
        const c = takeCard(p, a.card); if (!c) return 'Neturi tokios kortos';
        st.table[a.idx].d = c;
        st.passed = {};
        st.msg = p.name + ' muša ' + label(c);
        break;
      }
      case 'take': {
        if (pi !== st.defender || st.taking || unbeaten(st) === 0) return 'Dabar imti negalima';
        st.taking = true;
        st.passed = {};
        st.msg = p.name + ' ima. Galima primesti.';
        break;
      }
      case 'pass': {
        if (pi === st.defender || st.table.length === 0) return 'Dabar praleisti negalima';
        if (!st.taking && unbeaten(st) > 0) return 'Palauk, kol atsigins';
        st.passed[pi] = true;
        st.msg = p.name + (st.taking ? ': daugiau nemetu' : ': mušta');
        break;
      }
      default: return 'Nežinomas veiksmas';
    }
    checkBout(st);
    return null;
  }

  const RL = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SL = { S: '♠', H: '♥', D: '♦', C: '♣' };
  function label(c) { return (RL[c.r] || c.r) + SL[c.s]; }

  function viewFor(st, pi) {
    const me = st.players[pi];
    const ts = st.trumpSuit;
    const sortKey = c => (c.s === ts ? 100 : SUITS.indexOf(c.s) * 20) + c.r;
    return {
      me: pi,
      hand: me ? me.hand.slice().sort((a, b) => sortKey(a) - sortKey(b)) : [],
      players: st.players.map((p, i) => ({
        name: p.name, count: p.hand.length, out: p.out, passed: !!st.passed[i],
      })),
      table: st.table, trumpCard: st.trumpCard, trumpSuit: ts,
      deck: st.deck.length, discard: st.discard,
      attacker: st.attacker, defender: st.defender, taking: st.taking,
      boutLimit: st.boutLimit, over: st.over, loser: st.loser, msg: st.msg,
      lastEnd: st.lastEnd || null, round: st.round,
    };
  }

  Object.assign(exp, { newGame, apply, viewFor, beats, canAttack, canDefend, label, cid, SL, RL });
})(typeof module !== 'undefined' ? module.exports : (window.Durak = {}));

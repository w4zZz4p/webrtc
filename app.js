(() => {
  const $ = id => document.getElementById(id);
  const D = window.Durak;
  const PREFIX = 'durius-v1-';
  const store = {
    get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
  };
  let myPid = store.get('durius-pid', true);
  if (!myPid) { myPid = Math.random().toString(36).slice(2, 10); store.set('durius-pid', myPid, true); }

  const params = new URLSearchParams(location.search);
  const joinRoom = (params.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  let isHost = false, peer = null, room = '', hostConn = null;
  let view = null, selected = null;
  // host-only
  let lobby = []; // {pid,name,conn,online}
  let game = null;

  $('name').value = store.get('durius-name') || '';
  if (joinRoom) { $('menu-host').hidden = true; $('menu-join').hidden = false; $('join-code').textContent = joinRoom; }

  function toast(m) {
    const t = $('toast'); t.textContent = m; t.classList.add('show');
    clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
  }
  function net(m, keep) { $('net').textContent = m; clearTimeout(net.h); if (!keep) net.h = setTimeout(() => { $('net').textContent = ''; }, 3000); }
  function getName() {
    const n = $('name').value.trim().slice(0, 16);
    if (!n) { toast('Įvesk vardą'); $('name').focus(); return null; }
    store.set('durius-name', n); return n;
  }
  const shareUrl = () => location.origin + location.pathname + '?room=' + room +
    (params.get('peerhost') ? '&peerhost=' + params.get('peerhost') + '&peerport=' + (params.get('peerport') || 9000) : '');
  function qrSvg(text) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }
  const peerOpts = { debug: 1 };
  if (params.get('peerhost')) Object.assign(peerOpts, { host: params.get('peerhost'), port: +params.get('peerport') || 9000, path: '/', secure: false });

  // ---------------- HOST ----------------
  function startHost(name) {
    isHost = true;
    room = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    net('Jungiamasi…', true);
    peer = new Peer(PREFIX + room, peerOpts);
    peer.on('open', () => {
      net('Kambarys atidarytas');
      lobby = [{ pid: myPid, name, conn: null, online: true }];
      
      $('room-code').textContent = room;
      $('qr').innerHTML = qrSvg(shareUrl());
      $('share-url').value = shareUrl();
      $('host-share').hidden = false; $('btn-start').hidden = false;
      show('scr-lobby'); renderLobby();
    });
    peer.on('error', e => {
      if (e.type === 'unavailable-id') { peer.destroy(); startHost(name); return; }
      net('Klaida: ' + e.type); toast('Tinklo klaida: ' + e.type);
    });
    peer.on('disconnected', () => { net('Atsijungta nuo serverio, jungiamasi…'); setTimeout(() => !peer.destroyed && peer.reconnect(), 1500); });
    peer.on('connection', conn => {
      conn.on('data', msg => hostOnMsg(conn, msg));
      conn.on('close', () => {
        const p = lobby.find(p => p.conn === conn);
        if (p) { p.online = false; p.conn = null; toast(p.name + ' atsijungė'); broadcast(); }
      });
    });
  }

  function hostOnMsg(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      const name = String(msg.name || 'Žaidėjas').slice(0, 16);
      let p = lobby.find(p => p.pid === msg.pid);
      if (p) {
        if (p.conn && p.conn !== conn) try { p.conn.close(); } catch (e) {}
        p.conn = conn; p.online = true; if (!game) p.name = name;
      } else {
        if (game && !game.over) { conn.send({ t: 'err', m: 'Žaidimas jau vyksta' }); setTimeout(() => conn.close(), 500); return; }
        if (lobby.length >= 6) { conn.send({ t: 'err', m: 'Kambarys pilnas (6)' }); setTimeout(() => conn.close(), 500); return; }
        p = { pid: String(msg.pid), name, conn, online: true };
        lobby.push(p); toast(name + ' prisijungė');
      }
      broadcast();
    } else if (msg.t === 'act') {
      const p = lobby.find(p => p.conn === conn);
      if (p) hostAction(p.pid, msg.a, conn);
    }
  }

  function hostAction(pid, a, conn) {
    if (!game) return;
    const pi = game.players.findIndex(p => p.id === pid);
    if (pi < 0) return;
    const err = D.apply(game, pi, a || {});
    if (err) { if (conn) conn.send({ t: 'err', m: err }); else toast(err); return; }
    broadcast();
  }

  function startGame() {
    if (lobby.length < 2) { toast('Reikia bent 2 žaidėjų'); return; }
    // drop offline players before a new game
    lobby = lobby.filter(p => p.online);
    if (lobby.length < 2) { toast('Reikia bent 2 prisijungusių žaidėjų'); return; }
    game = D.newGame(lobby.map(p => ({ id: p.pid, name: p.name })));
    broadcast();
  }

  function viewForPid(pid) {
    const pi = game.players.findIndex(p => p.id === pid);
    const v = D.viewFor(game, pi);
    v.players.forEach((p, i) => { const l = lobby.find(x => x.pid === game.players[i].id); p.online = !!(l && l.online); });
    v.room = room; v.host = pid === myPid;
    return v;
  }

  function broadcast() {
    const lp = lobby.map(p => ({ name: p.name, online: p.online, host: p.pid === myPid }));
    for (const p of lobby) {
      if (p.pid === myPid) continue;
      if (!p.conn || !p.conn.open) continue;
      if (game && game.players.some(g => g.id === p.pid)) p.conn.send({ t: 'state', v: viewForPid(p.pid) });
      else p.conn.send({ t: 'lobby', players: lp, room });
    }
    if (game) onState(viewForPid(myPid)); else renderLobby();
  }

  // ---------------- CLIENT ----------------
  function startClient(name) {
    isHost = false; room = joinRoom;
    net('Jungiamasi…', true);
    $('btn-join').disabled = true;
    if (peer && !peer.destroyed) peer.destroy();
    peer = new Peer(peerOpts);
    let tries = 0;
    const connect = () => {
      hostConn = peer.connect(PREFIX + room, { reliable: true });
      const timer = setTimeout(() => {
        if (!hostConn.open) { tries++; if (tries < 3) { try { hostConn.close(); } catch (e) {} connect(); } else failJoin('Nepavyko prisijungti prie kambario'); }
      }, 8000);
      hostConn.on('open', () => {
        clearTimeout(timer);
        net('Prisijungta'); hostConn.send({ t: 'hello', pid: myPid, name });
      });
      hostConn.on('data', clientOnMsg);
      hostConn.on('close', () => { net('Ryšys nutrūko'); toast('Ryšys su šeimininku nutrūko'); failJoin('Ryšys nutrūko – bandyk prisijungti iš naujo'); });
    };
    peer.on('open', connect);
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') failJoin('Kambarys ' + room + ' nerastas');
      else { net('Klaida: ' + e.type); toast('Tinklo klaida: ' + e.type); }
    });
  }
  function failJoin(m) {
    toast(m); $('btn-join').disabled = false; $('btn-join').textContent = 'Prisijungti iš naujo';
    show('scr-menu'); $('menu-join').hidden = false;
  }
  function clientOnMsg(msg) {
    if (!msg) return;
    if (msg.t === 'lobby') {
      view = null; $('room-code').textContent = msg.room;
      lobby = msg.players; show('scr-lobby'); $('lobby-wait').hidden = false; renderLobby();
    } else if (msg.t === 'state') onState(msg.v);
    else if (msg.t === 'err') toast(msg.m);
  }
  function send(a) {
    if (isHost) hostAction(myPid, a, null);
    else if (hostConn && hostConn.open) hostConn.send({ t: 'act', a });
    else toast('Nėra ryšio');
  }

  // ---------------- RENDER ----------------
  function renderLobby() {
    $('lobby-players').innerHTML = lobby.map(p =>
      `<li class="${p.online ? '' : 'off'}"><span>${esc(p.name)}${(p.host || p.pid === myPid && isHost) ? ' 👑' : ''}</span><span>${p.online ? '🟢' : '⚪'}</span></li>`).join('');
    if (isHost) $('btn-start').disabled = lobby.filter(p => p.online).length < 2;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  function cardHtml(c, cls = '', attrs = '') {
    const red = c.s === 'H' || c.s === 'D';
    const tr = view && c.s === view.trumpSuit ? ' tr' : '';
    const r = D.RL[c.r] || c.r, s = D.SL[c.s];
    return `<div class="card${red ? ' red' : ''}${tr} ${cls}" ${attrs}><div class="tl">${r}<small>${s}</small></div><div class="ct">${s}</div></div>`;
  }
  const same = (a, b) => a && b && a.r === b.r && a.s === b.s;
  function shim(v) {
    return {
      over: v.over, attacker: v.attacker, defender: v.defender, taking: v.taking, table: v.table,
      boutLimit: v.boutLimit, trumpSuit: v.trumpSuit,
      players: v.players.map(p => ({ out: p.out, hand: { length: p.count } })),
    };
  }

  function onState(v) {
    view = v; show('scr-game');
    if (selected && !v.hand.some(c => same(c, selected))) selected = null;
    render();
  }

  function render() {
    const v = view, me = v.me, st = shim(v), n = v.players.length;
    // opponents in seat order after me
    let oh = '';
    for (let k = 1; k < n; k++) {
      const i = (me + k) % n, p = v.players[i];
      const cls = i === v.attacker ? 'att' : i === v.defender ? 'def' : '';
      let badges = '';
      if (v.over && v.loser === i) badges += '<span class="badge b-dur">DURIUS</span>';
      else if (p.out) badges += '<span class="badge b-out">išėjo</span>';
      else if (i === v.attacker) badges += '<span class="badge b-att">puola</span>';
      else if (i === v.defender) badges += `<span class="badge b-def">${v.taking ? 'ima' : 'ginasi'}</span>`;
      if (p.passed && !v.over) badges += '<span class="badge">pas</span>';
      if (!p.online) badges += '<span class="badge">📵</span>';
      const backs = '<i></i>'.repeat(Math.min(p.count, 8));
      oh += `<div class="opp ${cls} ${p.online ? '' : 'off'}"><div class="nm">${esc(p.name)}</div><div class="backs">${backs}</div><div>${p.count} 🂠 ${badges}</div></div>`;
    }
    $('opponents').innerHTML = oh;

    // deck
    let dh = '';
    if (v.deck > 0) dh += cardHtml(v.trumpCard, 'trump');
    if (v.deck > 1) dh += '<div class="card back"></div>';
    $('deck').innerHTML = dh;
    $('deck-info').innerHTML = `Koziris: <b style="font-size:18px;color:${v.trumpSuit === 'H' || v.trumpSuit === 'D' ? '#ff8a80' : '#fff'}">${D.SL[v.trumpSuit]}</b><br>Malka: ${v.deck}<br>Bita: ${v.discard}`;

    // table
    const iDefend = me === v.defender && !v.taking && !v.over;
    $('table').innerHTML = v.table.map((t, idx) => {
      const target = iDefend && selected && D.canDefend(st, me, idx, selected);
      return `<div class="pair${target ? ' target' : ''}" data-idx="${idx}">${cardHtml(t.a, 'a')}${t.d ? cardHtml(t.d, 'd') : ''}</div>`;
    }).join('') || (v.over ? '' : '<div class="sub" style="align-self:center;width:100%">Stalas tuščias</div>');

    // hand
    $('hand').innerHTML = v.hand.map((c, i) => {
      const ok = D.canAttack(st, me, c) || v.table.some((t, idx) => D.canDefend(st, me, idx, c));
      const cls = (same(c, selected) ? 'sel' : ok ? 'ok' : (v.over ? '' : 'dim'));
      return cardHtml(c, cls, `data-i="${i}"`);
    }).join('');

    // status
    const meP = v.players[me];
    const unbeaten = v.table.filter(t => !t.d).length;
    let s = v.msg || '';
    if (!v.over) {
      if (meP.out) s += ' · Tu išėjai! 🎉';
      else if (me === v.defender) s += v.taking ? ' · Tu imi' : (unbeaten ? ' · Ginkis!' : ' · Laukiam primetimų');
      else if (me === v.attacker && v.table.length === 0) s += ' · Tavo ėjimas – pulk!';
    }
    $('status').textContent = s;
    let role = 'Tu';
    if (v.over && v.loser === me) role += ' — DURIUS 🤡';
    else if (meP.out) role += ' — išėjai';
    else if (me === v.attacker) role += ' — puoli';
    else if (me === v.defender) role += ' — giniesi';
    $('me-bar').textContent = `${role} · ${meP.name} · ${v.hand.length} k.`;

    // buttons
    $('btn-take').hidden = !(me === v.defender && !v.taking && unbeaten > 0 && !v.over);
    const canPass = !v.over && me !== v.defender && !meP.out && v.hand.length > 0 && v.table.length > 0 &&
      (v.taking || unbeaten === 0) && !meP.passed;
    $('btn-pass').hidden = !canPass;
    $('btn-pass').textContent = v.taking ? 'Daugiau nemetu' : 'Bita';
    $('btn-again').hidden = !(v.over && isHost);
    $('btn-qr').hidden = !isHost;
  }

  // ---------------- EVENTS ----------------
  $('hand').addEventListener('click', e => {
    const el = e.target.closest('.card'); if (!el || !view || view.over) return;
    const c = view.hand[+el.dataset.i], st = shim(view), me = view.me;
    if (D.canAttack(st, me, c)) { selected = null; send({ type: 'attack', card: c }); return; }
    if (me === view.defender) {
      if (view.taking) { toast('Tu jau imi kortas'); return; }
      const opts = view.table.map((t, idx) => idx).filter(idx => D.canDefend(st, me, idx, c));
      if (opts.length === 1) { selected = null; send({ type: 'defend', idx: opts[0], card: c }); return; }
      if (opts.length > 1) { selected = same(selected, c) ? null : c; render(); if (selected) toast('Pasirink, kurią kortą mušti'); return; }
      toast('Šia korta nieko nesumuši'); return;
    }
    if (view.table.length === 0 && me !== view.attacker) toast('Dabar puola ' + view.players[view.attacker].name);
    else toast('Šios kortos primesti negalima');
  });
  $('table').addEventListener('click', e => {
    const el = e.target.closest('.pair'); if (!el || !selected) return;
    const idx = +el.dataset.idx;
    if (D.canDefend(shim(view), view.me, idx, selected)) { const c = selected; selected = null; send({ type: 'defend', idx, card: c }); }
  });
  $('btn-take').onclick = () => send({ type: 'take' });
  $('btn-pass').onclick = () => send({ type: 'pass' });
  $('btn-again').onclick = () => { game = null; startGame(); };
  $('btn-host').onclick = () => { const n = getName(); if (n) { $('btn-host').disabled = true; startHost(n); } };
  $('btn-join').onclick = () => { const n = getName(); if (n) startClient(n); };
  $('btn-start').onclick = startGame;
  $('btn-copy').onclick = () => {
    const u = shareUrl();
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Nuoroda nukopijuota'), () => { $('share-url').select(); toast('Nukopijuok rankiniu būdu'); });
  };
  $('btn-qr').onclick = () => { $('modal-qr').innerHTML = qrSvg(shareUrl()); $('modal-url').textContent = shareUrl(); $('modal').hidden = false; };
  $('modal-close').onclick = () => { $('modal').hidden = true; };
  window.addEventListener('beforeunload', e => { if (isHost && game && !game.over) { e.preventDefault(); e.returnValue = ''; } });
})();

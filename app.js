(() => {
  const $ = id => document.getElementById(id);
  const D = window.Durak;
  const PREFIX = 'durius-v1-';
  const AV = window.APP_VERSION || { version: '?', build: 'dev', date: '' };
  const VER = AV.version + (AV.build && AV.build !== 'dev' ? '+' + AV.build : '');
  document.getElementById('ver').textContent = 'v' + AV.version;
  document.getElementById('ver').title = 'Versija ' + VER + (AV.date ? ' · ' + AV.date : '');
  document.getElementById('ver-menu').textContent = 'Durnius v' + AV.version + (AV.build !== 'dev' ? ' · ' + AV.build : ' · dev') + (AV.date ? ' · ' + AV.date : '');
  const store = {
    get(k, s) { try { return (s ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
  };
  const diagLog = [];
  function dlog(m) { diagLog.push(new Date().toLocaleTimeString() + ' ' + m); if (diagLog.length > 60) diagLog.shift(); }
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
  const peerOpts = {
    debug: 1,
    config: {
      iceServers: [
        { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] },
        { urls: ['turn:eu-0.turn.peerjs.com:3478', 'turn:us-0.turn.peerjs.com:3478'], username: 'peerjs', credential: 'peerjsp' },
        { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' },
      ],
    },
  };
  if (params.get('peerhost')) Object.assign(peerOpts, { host: params.get('peerhost'), port: +params.get('peerport') || 9000, path: '/', secure: false });

  // ---------------- SAME-WIFI MODE ----------------
  // Browsers hide local IP addresses (mDNS) unless the page has microphone permission.
  // On many home routers phones on the same Wi-Fi can then only reach each other via a relay.
  // Granting mic permission once (stream stopped immediately) exposes local IPs so a direct LAN connection works.
  let wifiOn = store.get('durius-wifi') === '1';
  async function enableWifi(silent) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      s.getTracks().forEach(t => t.stop());
      wifiOn = true; store.set('durius-wifi', '1'); updWifi();
      if (!silent) toast('WiFi režimas įjungtas ✔');
      return true;
    } catch (e) {
      if (!silent) toast('Leidimas nesuteiktas – WiFi režimas neįjungtas');
      return false;
    }
  }
  function updWifi() {
    document.querySelectorAll('.btn-wifi').forEach(b => { b.textContent = wifiOn ? '📶 WiFi režimas įjungtas' : '📶 Tame pačiame WiFi? Įjunk WiFi režimą'; b.disabled = wifiOn; });
  }
  document.querySelectorAll('.btn-wifi').forEach(b => b.onclick = () => enableWifi(false));
  updWifi();
  let extraIce = null;
  async function loadTurn() {
    if (extraIce) return extraIce;
    const tc = window.TURN_CONFIG || {};
    let list = Array.isArray(tc.iceServers) ? tc.iceServers.slice() : [];
    if (tc.meteredApp && tc.meteredKey) {
      try {
        const r = await fetch(`https://${tc.meteredApp}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(tc.meteredKey)}`);
        if (r.ok) list = list.concat(await r.json());
        else dlog('Metered TURN: HTTP ' + r.status);
      } catch (e) { dlog('Metered TURN: ' + e.message); }
    }
    extraIce = list;
    if (list.length) peerOpts.config.iceServers = list.concat(peerOpts.config.iceServers);
    return list;
  }
  const wifiReady = () => Promise.all([wifiOn ? enableWifi(true) : null, loadTurn()]);

  // ---------------- DIAGNOSTICS ----------------
  function watchIce(conn, who) {
    let tries = 0;
    const iv = setInterval(() => {
      const pc = conn.peerConnection;
      if (!pc) { if (++tries > 100) clearInterval(iv); return; }
      clearInterval(iv);
      const types = {};
      pc.addEventListener('icecandidate', e => { if (e.candidate) { const t = e.candidate.type || '?'; types[t] = (types[t] || 0) + 1; } });
      pc.addEventListener('iceconnectionstatechange', async () => {
        const st = pc.iceConnectionState;
        dlog(`ICE (${who}): ${st}` + (st === 'checking' ? ' · mano kandidatai ' + JSON.stringify(types) : ''));
        if (st === 'connected' || st === 'completed') {
          try {
            const stats = await pc.getStats(); let pair = null; const byId = {};
            stats.forEach(r => { byId[r.id] = r; });
            stats.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = byId[r.selectedCandidatePairId]; });
            if (!pair) stats.forEach(r => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
            if (pair) { const l = byId[pair.localCandidateId], rm = byId[pair.remoteCandidateId]; dlog(`Ryšys per: ${l && l.candidateType} ↔ ${rm && rm.candidateType}`); }
          } catch (e) {}
        }
        if (st === 'failed') dlog(`ICE (${who}) nepavyko · mano kandidatai ${JSON.stringify(types)}`);
      });
    }, 50);
  }

  function gather(iceServers, ms = 7000) {
    return new Promise(res => {
      let pc; const out = [];
      try { pc = new RTCPeerConnection({ iceServers }); } catch (e) { res(out); return; }
      const done = () => { try { pc.close(); } catch (e) {} res(out); };
      pc.createDataChannel('d');
      pc.onicecandidate = e => {
        if (!e.candidate) return done();
        const c = e.candidate, parts = c.candidate.split(' ');
        out.push({ type: c.type || parts[7], addr: c.address || parts[4], proto: c.protocol || parts[2], url: e.url || '' });
      };
      pc.createOffer().then(o => pc.setLocalDescription(o)).catch(done);
      setTimeout(done, ms);
    });
  }

  let diagText = '';
  async function runDiag() {
    show('scr-diag');
    const out = $('diag-out'); out.innerHTML = '<li>⏳ Tikrinama… (iki 10 s)</li>';
    await wifiReady();
    const turnGroups = peerOpts.config.iceServers.filter(s => [].concat(s.urls).some(u => /^turns?:/.test(u)));
    const name = s => { const u = [].concat(s.urls)[0]; return u.replace(/^turns?:/, '').split(/[:?]/)[0]; };
    const [base, ...turns] = await Promise.all([
      gather([{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }]),
      ...turnGroups.map(g => gather([g], 9000)),
    ]);
    const host = base.filter(c => c.type === 'host'), srflx = base.filter(c => c.type === 'srflx');
    const hidden = host.length && host.every(c => /\.local$/.test(c.addr));
    const priv = host.filter(c => !/\.local$/.test(c.addr)).map(c => c.addr);
    const rows = [];
    const row = (ok, t, d) => rows.push({ ok, t, d });
    row(!!host.length && !hidden, 'Vietinis adresas', !host.length ? 'nerastas' : hidden ? 'paslėptas (.local) – įjunk WiFi režimą' : [...new Set(priv)].join(', '));
    row(!!srflx.length, 'Viešas adresas (STUN)', srflx.length ? [...new Set(srflx.map(c => c.addr))].join(', ') : 'nepavyko');
    let anyTurn = false;
    turnGroups.forEach((g, i) => {
      const rel = turns[i].filter(c => c.type === 'relay');
      anyTurn = anyTurn || !!rel.length;
      row(!!rel.length, 'TURN ' + name(g), rel.length ? 'veikia (' + [...new Set(rel.map(c => c.proto))].join('/') + ')' : 'neatsako');
    });
    row(wifiOn, 'WiFi režimas', wifiOn ? 'įjungtas' : 'išjungtas');
    let verdict;
    if (!anyTurn) verdict = 'Nė vienas TURN serveris neveikia. Jei WiFi neleidžia įrenginiams matyti vienas kito, prisijungti bus galima tik su veikiančiu TURN serveriu (žr. turn.js).';
    else verdict = 'Bent vienas TURN serveris veikia – ryšys turėtų pavykti net ir esant griežtam WiFi.';
    if (hidden) verdict = 'Vietinis adresas paslėptas – paspausk „WiFi režimas“ ir leisk mikrofoną. ' + verdict;
    out.innerHTML = rows.map(r => `<li><span>${r.ok ? '✅' : '❌'}</span><b>${esc(r.t)}</b><em>${esc(r.d)}</em></li>`).join('') +
      `<li class="verdict">${esc(verdict)}</li>` +
      (diagLog.length ? `<li class="log"><b>Paskutiniai ryšio įvykiai</b><pre>${esc(diagLog.slice(-15).join('\n'))}</pre></li>` : '');
    diagText = `Durnius ${VER} diagnostika\n${navigator.userAgent}\n` + rows.map(r => `${r.ok ? 'OK ' : 'NE '} ${r.t}: ${r.d}`).join('\n') + '\n' + diagLog.slice(-15).join('\n');
  }
  let diagBack = 'scr-menu';
  document.querySelectorAll('.btn-diag').forEach(b => b.onclick = () => {
    diagBack = [...document.querySelectorAll('.screen')].find(s => !s.hidden)?.id || 'scr-menu';
    runDiag();
  });
  $('diag-back').onclick = () => show(diagBack);
  $('diag-again').onclick = runDiag;
  $('diag-copy').onclick = () => (navigator.clipboard ? navigator.clipboard.writeText(diagText) : Promise.reject()).then(() => toast('Ataskaita nukopijuota'), () => toast('Nepavyko nukopijuoti'));

  // ---------------- HOST ----------------
  function startHost(name) {
    isHost = true;
    room = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    net('Jungiamasi…', true);
    wifiReady().then(() => {
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
      watchIce(conn, 'svečias');
      conn.on('data', msg => hostOnMsg(conn, msg));
      conn.on('close', () => {
        const p = lobby.find(p => p.conn === conn);
        if (p) { p.online = false; p.conn = null; toast(p.name + ' atsijungė'); broadcast(); }
      });
    });
    });
  }

  function hostOnMsg(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    if (msg.t === 'hello') {
      if (msg.ver !== VER) {
        conn.send({ t: 'err', fatal: true, m: `Skirtingos žaidimo versijos: kambario v${VER}, tavo v${msg.ver || 'sena'}. Perkrauk puslapį abiejuose įrenginiuose.` });
        setTimeout(() => conn.close(), 800); return;
      }
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
    wifiReady().then(() => clientPeer(name));
  }
  function clientPeer(name) {
    peer = new Peer(peerOpts);
    let tries = 0;
    const connect = () => {
      const c = hostConn = peer.connect(PREFIX + room, { reliable: true });
      dlog('Jungiamasi prie kambario ' + room + ' (bandymas ' + (tries + 1) + ')');
      watchIce(c, 'šeimininkas');
      const timer = setTimeout(() => {
        if (c.open || c.stale) return;
        c.stale = true; try { c.close(); } catch (e) {}
        tries++;
        if (tries < 3) connect();
        else failJoin('Nepavyko prisijungti. Jei esate tame pačiame WiFi – įjunk WiFi režimą abiejuose telefonuose arba junkis per mobilius duomenis', true);
      }, 12000);
      c.on('open', () => {
        clearTimeout(timer); c.opened = true;
        net('Prisijungta'); c.send({ t: 'hello', pid: myPid, name, ver: VER });
      });
      c.on('data', clientOnMsg);
      c.on('close', () => {
        if (c.stale) return;
        clearTimeout(timer); c.stale = true;
        if (c.opened) { net('Ryšys nutrūko'); failJoin('Ryšys su šeimininku nutrūko – bandyk prisijungti iš naujo'); }
        else failJoin('Nepavyko užmegzti ryšio', true);
      });
    };
    peer.on('open', connect);
    peer.on('error', e => {
      if (e.type === 'peer-unavailable') failJoin('Kambarys ' + room + ' nerastas');
      else { net('Klaida: ' + e.type); toast('Tinklo klaida: ' + e.type); }
    });
  }
  function failJoin(m, conn) {
    toast(m);
    $('join-help').hidden = !conn; $('btn-join').disabled = false; $('btn-join').textContent = 'Prisijungti iš naujo';
    show('scr-menu'); $('menu-join').hidden = false;
  }
  function clientOnMsg(msg) {
    if (!msg) return;
    if (msg.t === 'lobby') {
      view = null; $('room-code').textContent = msg.room;
      lobby = msg.players; show('scr-lobby'); $('lobby-wait').hidden = false; renderLobby();
    } else if (msg.t === 'state') onState(msg.v);
    else if (msg.t === 'err') { if (msg.fatal) { hostConn.stale = true; failJoin(msg.m); $('join-help').hidden = false; $('join-help').textContent = msg.m; } else toast(msg.m); }
  }
  function send(a) {
    if (isHost) hostAction(myPid, a, null);
    else if (hostConn && hostConn.open) hostConn.send({ t: 'act', a });
    else toast('Nėra ryšio');
  }

  // ---------------- SOUND ----------------
  let actx = null, soundOn = store.get('durius-sound') !== '0';
  function unlockAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (actx && actx.state === 'suspended') actx.resume();
  }
  document.addEventListener('pointerdown', unlockAudio, { passive: true });
  function tone(freq, t0, dur, type = 'sine', vol = 0.15, slide) {
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, actx.currentTime + t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, actx.currentTime + t0 + dur);
    g.gain.setValueAtTime(0, actx.currentTime + t0);
    g.gain.linearRampToValueAtTime(vol, actx.currentTime + t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + t0 + dur);
    o.connect(g).connect(actx.destination); o.start(actx.currentTime + t0); o.stop(actx.currentTime + t0 + dur + 0.05);
  }
  function noise(t0, dur, vol = 0.12, hp = 1500) {
    const len = Math.floor(actx.sampleRate * dur), buf = actx.createBuffer(1, len, actx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
    f.type = 'highpass'; f.frequency.value = hp; g.gain.value = vol; s.buffer = buf;
    s.connect(f).connect(g).connect(actx.destination); s.start(actx.currentTime + t0);
  }
  function sfx(kind) {
    if (!soundOn || !actx) return;
    try {
      switch (kind) {
        case 'card': noise(0, 0.08, 0.18, 2200); break;
        case 'turn': tone(660, 0, 0.14, 'triangle', 0.2); tone(880, 0.12, 0.14, 'triangle', 0.2); tone(1320, 0.24, 0.22, 'triangle', 0.18); break;
        case 'def': tone(520, 0, 0.12, 'square', 0.08); tone(390, 0.12, 0.12, 'square', 0.08); tone(520, 0.24, 0.2, 'square', 0.08); break;
        case 'soft': tone(990, 0, 0.12, 'sine', 0.12); break;
        case 'bita': noise(0, 0.35, 0.14, 600); tone(300, 0, 0.3, 'sine', 0.08, 120); break;
        case 'take': tone(400, 0, 0.35, 'sawtooth', 0.06, 180); break;
        case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.1, 0.3, 'triangle', 0.16)); break;
        case 'lose': [392, 370, 349, 330].forEach((f, i) => tone(f, i * 0.28, 0.32, 'sawtooth', 0.08, f * 0.97)); tone(262, 1.15, 0.8, 'sawtooth', 0.08, 180); break;
        case 'join': tone(700, 0, 0.1, 'sine', 0.12); tone(1050, 0.08, 0.15, 'sine', 0.12); break;
        case 'err': tone(180, 0, 0.18, 'square', 0.06); break;
      }
    } catch (e) {}
  }
  function updSoundBtn() { $('btn-sound').textContent = soundOn ? '🔊' : '🔇'; }
  updSoundBtn();
  $('btn-sound').onclick = () => { soundOn = !soundOn; store.set('durius-sound', soundOn ? '1' : '0'); updSoundBtn(); unlockAudio(); sfx('soft'); };

  // ---------------- RENDER ----------------
  const COLORS = ['#e53935', '#8e24aa', '#1e88e5', '#00897b', '#f4511e', '#6d4c41', '#3949ab', '#c0ca33'];
  function avatar(name, i) {
    const ini = String(name || '?').trim().slice(0, 1).toUpperCase();
    return `<span class="av" style="background:${COLORS[i % COLORS.length]}">${esc(ini)}</span>`;
  }
  let lobbySeen = new Set();
  function renderLobby() {
    $('lobby-players').innerHTML = lobby.map((p, i) => {
      const k = p.name + i, isNew = !lobbySeen.has(k);
      if (isNew && lobbySeen.size) sfx('join');
      lobbySeen.add(k);
      return `<li class="${p.online ? '' : 'off'} ${isNew ? 'new' : ''}">${avatar(p.name, i)}<span class="nm">${esc(p.name)}${(p.host || p.pid === myPid && isHost) ? ' 👑' : ''}</span><span>${p.online ? '🟢' : '⚪'}</span></li>`;
    }).join('');
    if (isHost) $('btn-start').disabled = lobby.filter(p => p.online).length < 2;
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  const key = c => c.r + c.s;
  function cardHtml(c, cls = '', attrs = '') {
    const red = c.s === 'H' || c.s === 'D';
    const tr = view && c.s === view.trumpSuit ? ' tr' : '';
    const r = D.RL[c.r] || c.r, s = D.SL[c.s];
    const mid = c.r === 14 ? `<div class="pip ace">${s}</div>` : c.r > 10 ? `<div class="face">${r}<span>${s}</span></div>` : `<div class="pip">${s}</div>`;
    return `<div class="card${red ? ' red' : ''}${tr} ${cls}" data-k="${key(c)}" ${attrs}><div class="cn">${r}<i>${s}</i></div>${mid}<div class="cn br">${r}<i>${s}</i></div></div>`;
  }
  const same = (a, b) => a && b && a.r === b.r && a.s === b.s;
  function shim(v) {
    return {
      over: v.over, attacker: v.attacker, defender: v.defender, taking: v.taking, table: v.table,
      boutLimit: v.boutLimit, trumpSuit: v.trumpSuit,
      players: v.players.map(p => ({ out: p.out, hand: { length: p.count } })),
    };
  }

  // what does the game expect from me right now?
  function needOf(v) {
    if (!v || v.over) return '';
    const me = v.me, p = v.players[me];
    if (p.out || v.hand.length === 0) return '';
    const unb = v.table.filter(t => !t.d).length;
    if (me === v.defender) return (!v.taking && unb > 0) ? 'def' : '';
    if (me === v.attacker && v.table.length === 0) return 'att';
    if (v.table.length && (v.taking || unb === 0) && !p.passed) return 'thr';
    return '';
  }

  let prev = null, prevNeed = '', overShown = false, titleTimer = null;
  const baseTitle = document.title;

  function onState(v) {
    const old = prev;
    const tableRects = [...document.querySelectorAll('#table .card')].map(el => ({ el: el.cloneNode(true), r: el.getBoundingClientRect() }));
    view = v; show('scr-game');
    if (selected && (!v.hand.some(c => same(c, selected)) || v.me !== v.defender || v.taking)) selected = null;
    render();
    animate(old, v, tableRects);
    alerts(old, v);
    prev = v;
  }

  function rectOf(el) { return el ? el.getBoundingClientRect() : null; }
  function srcRectFor(pi) {
    if (pi === view.me) return rectOf($('hand'));
    return rectOf(document.querySelector(`.opp[data-pi="${pi}"]`));
  }
  function flyFrom(el, src, opts = {}) {
    if (!src || !el.animate) return;
    const r = el.getBoundingClientRect();
    const dx = src.left + src.width / 2 - (r.left + r.width / 2), dy = src.top + src.height / 2 - (r.top + r.height / 2);
    el.animate([
      { transform: `translate(${dx}px,${dy}px) rotate(${opts.rot ?? -25}deg) scale(${opts.scale ?? .5})`, opacity: opts.op ?? 0.2 },
      { transform: getComputedStyle(el).transform === 'none' ? 'none' : getComputedStyle(el).transform, opacity: 1 },
    ], { duration: opts.dur || 420, delay: opts.delay || 0, easing: 'cubic-bezier(.2,.85,.25,1.1)', fill: 'backwards' });
  }

  function animate(old, v, tableRects) {
    const deckR = rectOf($('deck')) || rectOf($('felt'));
    let playedCard = false;
    // new table cards fly from their player
    if (old) {
      const oldKeys = new Set();
      old.table.forEach(t => { oldKeys.add(key(t.a)); if (t.d) oldKeys.add(key(t.d)); });
      v.table.forEach((t, idx) => {
        const pair = document.querySelector(`.pair[data-idx="${idx}"]`);
        if (!pair) return;
        if (!oldKeys.has(key(t.a))) { flyFrom(pair.querySelector('.card.a'), srcRectFor(t.by)); playedCard = true; }
        if (t.d && !oldKeys.has(key(t.d))) { flyFrom(pair.querySelector('.card.d'), srcRectFor(v.defender), { rot: 25 }); playedCard = true; }
      });
      if (playedCard) sfx('card');
      // bout ended: ghosts of old table cards fly away
      const ended = v.lastEnd && (!old.lastEnd || old.lastEnd.seq !== v.lastEnd.seq);
      if (ended && tableRects.length) {
        const beaten = v.lastEnd.beaten;
        const target = beaten ? rectOf($('discard')) : srcRectFor(v.lastEnd.def);
        tableRects.forEach((g, i) => ghostFly(g.el, g.r, target, beaten, i));
        sfx(beaten ? 'bita' : 'take');
      }
      // opponents bump when count changes
      v.players.forEach((p, i) => {
        if (old.players[i] && old.players[i].count !== p.count) {
          const el = document.querySelector(`.opp[data-pi="${i}"]`); if (el) { el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); }
        }
      });
    }
    // new hand cards fly from deck (or from table if I took)
    const oldHand = new Set(old ? old.hand.map(key) : []);
    const tookFromTable = old && v.lastEnd && (!old.lastEnd || old.lastEnd.seq !== v.lastEnd.seq) && !v.lastEnd.beaten && v.lastEnd.def === v.me;
    let n = 0;
    document.querySelectorAll('#hand .card').forEach(el => {
      if (oldHand.has(el.dataset.k)) return;
      const tableSrc = tookFromTable && old.table.some(t => key(t.a) === el.dataset.k || (t.d && key(t.d) === el.dataset.k));
      flyFrom(el, tableSrc ? rectOf($('table')) : deckR, { delay: 120 + n * 70, rot: 0, scale: .7, dur: 450, op: tableSrc ? .6 : 1 });
      n++;
    });
  }

  function ghostFly(el, r, target, beaten, i) {
    if (!el.animate) return;
    el.classList.add('ghost-card');
    el.style.left = r.left + 'px'; el.style.top = r.top + 'px';
    document.body.appendChild(el);
    let dx, dy;
    if (target) { dx = target.left + target.width / 2 - (r.left + r.width / 2); dy = target.top + target.height / 2 - (r.top + r.height / 2); }
    else { dx = innerWidth; dy = 0; }
    const rot = beaten ? 160 + Math.random() * 80 : -20 + Math.random() * 40;
    const a = el.animate([
      { transform: 'none', opacity: 1 },
      { transform: `translate(${dx * .15}px,${dy * .15 - 20}px) rotate(${rot * .2}deg) scale(1.05)`, opacity: 1, offset: .25 },
      { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(${beaten ? .4 : .35})`, opacity: beaten ? 0.3 : 0 },
    ], { duration: 650, delay: i * 45, easing: 'cubic-bezier(.5,0,.3,1)', fill: 'both' });
    a.onfinish = () => el.remove();
  }

  function banner(text, cls) {
    const b = $('banner'); b.textContent = text; b.className = cls || '';
    void b.offsetWidth; b.classList.add('show');
  }

  function alerts(old, v) {
    const need = needOf(v);
    document.body.classList.toggle('my-turn', !!need && need !== 'thr');
    document.body.style.setProperty('--gc', need === 'def' ? 'rgba(79,195,247,.85)' : 'rgba(247,201,72,.85)');
    if (need && need !== prevNeed) {
      if (need === 'att') { banner('⚔️ Tavo ėjimas!'); sfx('turn'); vibrate([120, 60, 120]); }
      else if (need === 'def') { banner('🛡️ Ginkis!', 'def'); sfx('def'); vibrate([200, 80, 200]); }
      else if (need === 'thr' && v.hand.some(c => D.canAttack(shim(v), v.me, c))) { banner('Gali primesti!', 'thr'); sfx('soft'); vibrate(60); }
    }
    prevNeed = need;
    // tab title flash
    clearInterval(titleTimer); document.title = baseTitle;
    if (need === 'att' || need === 'def') {
      let on = false;
      titleTimer = setInterval(() => { on = !on; document.title = on ? (need === 'def' ? '🛡️ Ginkis!' : '⚔️ Tavo ėjimas!') : baseTitle; }, 900);
    }
    // game over
    if (v.over && !overShown) {
      overShown = true;
      setTimeout(() => showOver(v), 700);
    }
    if (!v.over) { overShown = false; $('over').hidden = true; }
  }
  function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (e) {} }

  function showOver(v) {
    const lose = v.loser === v.me;
    const e = $('over-emoji');
    e.textContent = v.loser === null ? '🤝' : lose ? '🤡' : '🏆';
    e.className = lose ? 'lose' : 'win';
    $('over-title').textContent = v.loser === null ? 'Lygiosios!' : lose ? 'Tu – DURNIUS!' : 'Laimėjai!';
    $('over-sub').textContent = v.loser === null ? 'Niekas neliko durniumi' : lose ? 'Kitą kartą pasiseks…' : 'Durnius: ' + v.players[v.loser].name;
    $('btn-again').hidden = !isHost;
    $('over').hidden = false;
    if (lose) { sfx('lose'); vibrate([300, 100, 300, 100, 500]); } else { sfx('win'); confetti(); }
  }

  function confetti() {
    const cv = $('fx'), ctx = cv.getContext('2d');
    const W = cv.width = innerWidth * devicePixelRatio, H = cv.height = innerHeight * devicePixelRatio;
    const cols = ['#f7c948', '#e53935', '#4fc3f7', '#66bb6a', '#fff', '#ab47bc'], sym = ['♠', '♥', '♦', '♣'];
    const ps = Array.from({ length: 160 }, () => ({
      x: W / 2 + (Math.random() - .5) * W * .3, y: H * .45, vx: (Math.random() - .5) * 26 * devicePixelRatio, vy: (-Math.random() * 26 - 8) * devicePixelRatio,
      r: Math.random() * 6, vr: (Math.random() - .5) * .3, c: cols[Math.floor(Math.random() * cols.length)], s: Math.random() < .25 ? sym[Math.floor(Math.random() * 4)] : null,
      w: (6 + Math.random() * 8) * devicePixelRatio,
    }));
    let t = 0;
    (function step() {
      ctx.clearRect(0, 0, W, H); t++;
      ps.forEach(p => {
        p.vy += .6 * devicePixelRatio; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        if (p.s) { ctx.font = `${p.w * 2.4}px serif`; ctx.fillText(p.s, 0, 0); } else ctx.fillRect(-p.w / 2, -p.w / 4, p.w, p.w / 2);
        ctx.restore();
      });
      if (t < 200) requestAnimationFrame(step); else ctx.clearRect(0, 0, W, H);
    })();
  }

  function layoutHand() {
    const slots = [...document.querySelectorAll('#hand .slot')], n = slots.length;
    if (!n) return;
    const W = slots[0].firstElementChild.offsetWidth, avail = $('hand').clientWidth - W * 0.7 - 10;
    const step = n > 1 ? Math.min(W * 0.78, (avail - W) / (n - 1)) : 0;
    const ang = Math.min(5, 34 / n), half = Math.max(1, (n - 1) / 2);
    slots.forEach((s, i) => {
      const o = i - (n - 1) / 2;
      s.style.marginLeft = i ? (step - W) + 'px' : '0';
      s.style.transform = `translateY(${(o / half) * (o / half) * Math.min(14, n * 2)}px) rotate(${o * ang}deg)`;
      s.style.zIndex = i;
    });
  }
  window.addEventListener('resize', () => view && layoutHand());

  function render() {
    const v = view, me = v.me, st = shim(v), n = v.players.length;
    // opponents in seat order after me
    let oh = '';
    for (let k = 1; k < n; k++) {
      const i = (me + k) % n, p = v.players[i];
      const cls = v.over ? '' : i === v.attacker ? 'att' : i === v.defender ? 'def' : '';
      let badges = '', role = '';
      if (v.over && v.loser === i) { badges += '<span class="badge b-dur">DURNIUS</span>'; role = '🤡'; }
      else if (p.out) { badges += '<span class="badge b-out">išėjo</span>'; role = '🏆'; }
      else if (i === v.attacker) { badges += '<span class="badge b-att">puola</span>'; role = '⚔️'; }
      else if (i === v.defender) { badges += `<span class="badge b-def">${v.taking ? 'ima' : 'ginasi'}</span>`; role = v.taking ? '✋' : '🛡️'; }
      if (p.passed && !v.over) badges += '<span class="badge">pas</span>';
      if (!p.online) badges += '<span class="badge">📵</span>';
      const m = Math.min(p.count, 8);
      const backs = Array.from({ length: m }, (_, j) => `<i style="transform:rotate(${(j - (m - 1) / 2) * 6}deg)"></i>`).join('');
      oh += `<div class="opp ${cls} ${p.online ? '' : 'off'}" data-pi="${i}">${role ? `<span class="role">${role}</span>` : ''}<div class="top">${avatar(p.name, i)}<span class="nm">${esc(p.name)}</span></div><div class="backs">${backs}</div><div class="cnt">${p.count} k. ${badges}</div></div>`;
    }
    $('opponents').innerHTML = oh;

    // deck
    let dh = '';
    if (v.deck > 0) dh += cardHtml(v.trumpCard, 'trump');
    if (v.deck > 1) dh += '<div class="card back"></div>';
    if (v.deck > 6) dh += '<div class="card back"></div>';
    $('deck').innerHTML = dh;
    const red = v.trumpSuit === 'H' || v.trumpSuit === 'D';
    $('deck-info').innerHTML = `<span class="ts" style="color:${red ? 'var(--red)' : '#111'}">${D.SL[v.trumpSuit]}</span><br>Malka: <b>${v.deck}</b>`;
    const dn = Math.min(Math.ceil(v.discard / 4), 8);
    $('discard').innerHTML = Array.from({ length: dn }, (_, j) => `<div class="card back" style="--r:${(j * 37) % 50 - 25}deg;top:${j * 2}px"></div>`).join('') +
      (v.discard ? `<div class="sub" style="position:absolute;top:66px;width:44px;font-size:11px">mušta ${v.discard}</div>` : '');

    // table
    const iDefend = me === v.defender && !v.taking && !v.over;
    $('table').innerHTML = v.table.map((t, idx) => {
      const target = iDefend && selected && D.canDefend(st, me, idx, selected);
      return `<div class="pair${target ? ' target' : ''}${!t.d && !v.taking ? ' open' : ''}" data-idx="${idx}">${cardHtml(t.a, 'a')}${t.d ? cardHtml(t.d, 'd') : ''}</div>`;
    }).join('') || (v.over ? '' : `<div class="empty">${me === v.attacker ? 'Mesk kortą ant stalo' : 'Laukiam ' + esc(v.players[v.attacker].name) + ' ėjimo…'}</div>`);

    // hand
    $('hand').innerHTML = v.hand.map((c, i) => {
      const ok = D.canAttack(st, me, c) || v.table.some((t, idx) => D.canDefend(st, me, idx, c));
      const cls = (same(c, selected) ? 'sel' : ok ? 'ok' : (v.over ? '' : 'dim'));
      return `<div class="slot">${cardHtml(c, cls, `data-i="${i}"`)}</div>`;
    }).join('');
    layoutHand();

    // status
    const meP = v.players[me];
    const unbeaten = v.table.filter(t => !t.d).length;
    let s = v.msg || '';
    if (!v.over) {
      if (meP.out) s += ' · Tu išėjai! 🎉';
      else if (me === v.defender) s += v.taking ? ' · Tu imi' : unbeaten ? ' · Ginkis!' : v.table.length ? ' · Laukiam primetimų' : ' · Ruoškis gintis';
      else if (me === v.attacker && v.table.length === 0) s += ' · Tavo ėjimas – pulk!';
    }
    if ($('status').dataset.s !== s) { $('status').dataset.s = s; $('status').innerHTML = s ? `<span class="msg">${esc(s)}</span>` : ''; }
    let role = '', rc = '';
    if (v.over && v.loser === me) role = 'DURNIUS 🤡';
    else if (meP.out) role = 'išėjai 🏆';
    else if (me === v.attacker) { role = '⚔️ puoli'; rc = 'att'; }
    else if (me === v.defender) { role = v.taking ? '✋ imi' : '🛡️ giniesi'; rc = 'def'; }
    $('me-bar').innerHTML = `${avatar(meP.name, me)}<b>${esc(meP.name)}</b>${role ? `<span class="role ${rc}">${role}</span>` : ''}<span>${v.hand.length} k.</span>`;

    // buttons
    const showTake = me === v.defender && !v.taking && unbeaten > 0 && !v.over;
    const canPass = !v.over && me !== v.defender && !meP.out && v.hand.length > 0 && v.table.length > 0 &&
      (v.taking || unbeaten === 0) && !meP.passed;
    setBtn('btn-take', showTake, showTake && !v.hand.some(c => v.table.some((t, idx) => D.canDefend(st, me, idx, c))));
    setBtn('btn-pass', canPass, canPass && !v.hand.some(c => D.canAttack(st, me, c)));
    $('btn-pass').textContent = v.taking ? '👌 Daugiau nemetu' : '✅ Mušta';
    $('btn-qr').hidden = !isHost;
  }
  function setBtn(id, vis, attn) {
    const b = $(id), was = !b.hidden;
    b.hidden = !vis;
    b.classList.toggle('attn', !!attn);
    if (vis && !was) { b.style.animation = 'none'; void b.offsetWidth; b.style.animation = ''; }
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
      shakeEl(el); sfx('err'); toast('Šia korta nieko nesumuši'); return;
    }
    shakeEl(el); sfx('err');
    if (view.table.length === 0 && me !== view.attacker) toast('Dabar puola ' + view.players[view.attacker].name);
    else toast('Šios kortos primesti negalima');
  });
  function shakeEl(el) { el.animate && el.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(0)' }], { duration: 300 }); }
  $('table').addEventListener('click', e => {
    const el = e.target.closest('.pair'); if (!el || !selected) return;
    const idx = +el.dataset.idx;
    if (D.canDefend(shim(view), view.me, idx, selected)) { const c = selected; selected = null; send({ type: 'defend', idx, card: c }); }
  });
  $('btn-take').onclick = () => send({ type: 'take' });
  $('btn-pass').onclick = () => send({ type: 'pass' });
  $('btn-again').onclick = () => { game = null; $('over').hidden = true; startGame(); };
  $('over-close').onclick = () => { $('over').hidden = true; };
  $('btn-host').onclick = () => { const n = getName(); if (n) { unlockAudio(); $('btn-host').disabled = true; startHost(n); } };
  $('btn-join').onclick = () => { const n = getName(); if (n) { unlockAudio(); startClient(n); } };
  $('btn-start').onclick = startGame;
  $('btn-copy').onclick = () => {
    const u = shareUrl();
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast('Nuoroda nukopijuota'), () => { $('share-url').select(); toast('Nukopijuok rankiniu būdu'); });
  };
  $('btn-qr').onclick = () => { $('modal-qr').innerHTML = qrSvg(shareUrl()); $('modal-url').textContent = shareUrl(); $('modal').hidden = false; };
  $('modal-close').onclick = () => { $('modal').hidden = true; };
  window.addEventListener('beforeunload', e => { if (isHost && game && !game.over) { e.preventDefault(); e.returnValue = ''; } });
})();

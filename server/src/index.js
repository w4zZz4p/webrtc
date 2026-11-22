// Durnius WebSocket relay: one Durable Object per room.
// The host's browser runs the game logic; this server only forwards messages
// between the host and the guests of a room.
//
//   wss://<worker>/room/<CODE>?role=host|guest&pid=<player id>
//
// host  -> server: {t:'to', id, m}   deliver m to guest id
//                  {t:'kick', id}    disconnect guest id
// guest ?wait=1   : reconnecting guest, allowed in before the host returns
// server -> host : {t:'join', id} | {t:'from', id, m} | {t:'leave', id}
// guest -> server: any JSON message, forwarded to the host as {t:'from', id, m}
// server -> guest: {t:'msg', m} | {t:'host-left'} | {t:'host-back'} | {t:'err', code, m}
// Text frame "ping" is answered with "pong" without waking the object.

const MAX_GUESTS = 8;
const MAX_MSG = 64 * 1024;
const CODE_RE = /^[A-Z0-9]{4,8}$/;
const PID_RE = /^[a-z0-9]{4,24}$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'durnius' }), { headers: { 'content-type': 'application/json', ...cors } });
    }
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9]+)$/);
    if (!m) return new Response('Not found', { status: 404, headers: cors });
    if (!originAllowed(req, env)) return new Response('Origin not allowed', { status: 403 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426, headers: cors });
    const code = m[1].toUpperCase();
    if (!CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    return stub.fetch(req);
  },
};

function allowedList(env) {
  return (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function originAllowed(req, env) {
  const list = allowedList(env);
  if (!list.length) return true;
  const o = req.headers.get('Origin') || '';
  return list.includes(o) || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
}
function corsHeaders(req, env) {
  const o = req.headers.get('Origin');
  return o && originAllowed(req, env) ? { 'access-control-allow-origin': o, vary: 'Origin' } : {};
}

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(req) {
    const url = new URL(req.url);
    const role = url.searchParams.get('role');
    const pid = (url.searchParams.get('pid') || '').toLowerCase();
    if ((role !== 'host' && role !== 'guest') || !PID_RE.test(pid)) return new Response('Bad params', { status: 400 });

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const hosts = this.ctx.getWebSockets('host');

    if (role === 'host') {
      // A different host already owns this room code -> refuse so the creator picks another code.
      const owner = hosts.find(ws => this.att(ws).pid !== pid);
      if (owner) return this.reject(client, server, 'taken', 'Kambario kodas užimtas');
      hosts.forEach(ws => this.close(ws, 4000, 'replaced'));
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role, pid });
      // tell the new host who is waiting, and tell guests the host is back
      for (const g of this.ctx.getWebSockets('guest')) {
        this.send(server, { t: 'join', id: this.att(g).pid });
        this.send(g, { t: 'host-back' });
      }
    } else {
      // A returning guest (wait=1) may arrive before the host after a network blip: let it wait.
      if (!hosts.length && url.searchParams.get('wait') !== '1') return this.reject(client, server, 'no-room', 'Kambarys nerastas');
      const guests = this.ctx.getWebSockets('guest');
      guests.filter(ws => this.att(ws).pid === pid).forEach(ws => this.close(ws, 4000, 'replaced'));
      if (guests.filter(ws => this.att(ws).pid !== pid).length >= MAX_GUESTS) return this.reject(client, server, 'full', 'Kambarys pilnas');
      this.ctx.acceptWebSocket(server, ['guest', 'g:' + pid]);
      server.serializeAttachment({ role, pid });
      hosts.forEach(h => this.send(h, { t: 'join', id: pid }));
      if (!hosts.length) this.send(server, { t: 'host-left' });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  reject(client, server, code, m) {
    server.accept();
    server.send(JSON.stringify({ t: 'err', code, m }));
    server.close(4001, code);
    return new Response(null, { status: 101, webSocket: client });
  }

  att(ws) { return ws.deserializeAttachment() || {}; }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) {} }
  close(ws, code, reason) { try { ws.close(code, reason); } catch (e) {} }

  async webSocketMessage(ws, data) {
    if (typeof data !== 'string' || data.length > MAX_MSG) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    const a = this.att(ws);
    if (a.role === 'host') {
      if (msg.t === 'to' && typeof msg.id === 'string') {
        this.ctx.getWebSockets('g:' + msg.id).forEach(g => this.send(g, { t: 'msg', m: msg.m }));
      } else if (msg.t === 'kick' && typeof msg.id === 'string') {
        this.ctx.getWebSockets('g:' + msg.id).forEach(g => this.close(g, 4002, 'kicked'));
      }
    } else {
      this.ctx.getWebSockets('host').forEach(h => this.send(h, { t: 'from', id: a.pid, m: msg }));
    }
  }

  async webSocketClose(ws) { this.gone(ws); }
  async webSocketError(ws) { this.gone(ws); }

  gone(ws) {
    const a = this.att(ws);
    if (a.role === 'host') {
      if (this.ctx.getWebSockets('host').some(h => h !== ws)) return; // replaced by a reconnect
      this.ctx.getWebSockets('guest').forEach(g => this.send(g, { t: 'host-left' }));
    } else if (a.pid) {
      if (this.ctx.getWebSockets('g:' + a.pid).some(g => g !== ws)) return;
      this.ctx.getWebSockets('host').forEach(h => this.send(h, { t: 'leave', id: a.pid }));
    }
  }
}

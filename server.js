/* ============================================================
   Court Piece ONLINE — room relay server (bohot halka)
   ------------------------------------------------------------
   • Game ka POORA logic browsers me hi chalta hai (host browser).
   • Server sirf: room banata hai, log jodta hai, messages aage bhejta hai.
   Chalane ka tareeqa README-ONLINE.md dekhein.
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 8080;
const HTML = path.join(__dirname, 'court-piece.html');

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/' || url === '/index.html' || url === '/court-piece.html'){
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(HTML).pipe(res);
  } else if (url === '/health'){
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
  } else {
    res.writeHead(404); res.end('Not found');
  }
});

const wss = new WebSocketServer({ server });

// room code -> { players: [ws|null x4], names: [str|null x4] }
const rooms = new Map();

function makeCode(){
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c;
  do {
    c = '';
    for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(c));
  return c;
}
function send(ws, obj){
  if (ws && ws.readyState === 1){
    try { ws.send(JSON.stringify(obj)); } catch(e){}
  }
}
function lobbyState(room){
  const r = rooms.get(room);
  return { t: 'lobby', names: r ? r.names : [] };
}
function broadcastRoom(room, obj){
  const r = rooms.get(room);
  if (!r) return;
  r.players.forEach(p => send(p, obj));
}

wss.on('connection', (ws) => {
  ws.__room = null;
  ws.__seat = -1;

  ws.on('message', (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch(e){ return; }
    if (!msg || typeof msg !== 'object') return;

    // ---------- room banao ----------
    if (msg.t === 'create'){
      const room = makeCode();
      const name = String(msg.name || 'Khiladi').slice(0, 12);
      rooms.set(room, { players: [ws, null, null, null], names: [name, null, null, null] });
      ws.__room = room; ws.__seat = 0;
      send(ws, { t: 'welcome', room, seat: 0, names: rooms.get(room).names });
      return;
    }

    // ---------- room me shamil ho ----------
    if (msg.t === 'join'){
      const room = String(msg.room || '').toUpperCase().trim();
      const r = rooms.get(room);
      if (!r){ send(ws, { t: 'err', msg: 'Room code ghalat he' }); return; }
      let seat = -1;
      for (let i = 1; i < 4; i++){ if (!r.players[i]){ seat = i; break; } }
      if (seat < 0){ send(ws, { t: 'err', msg: 'Room bhara hua he (4/4)' }); return; }
      const name = String(msg.name || 'Khiladi').slice(0, 12);
      r.players[seat] = ws;
      r.names[seat] = name;
      ws.__room = room; ws.__seat = seat;
      send(ws, { t: 'welcome', room, seat, names: r.names });
      broadcastRoom(room, lobbyState(room));
      return;
    }

    const room = ws.__room;
    if (room == null) return;
    const r = rooms.get(room);
    if (!r) return;

    // ---------- game shuru (sirf host = seat 0) ----------
    if (msg.t === 'go'){
      if (ws.__seat !== 0) return;
      broadcastRoom(room, { t: 'go', names: r.names });
      return;
    }

    // ---------- game ke messages ----------
    if (msg.t === 'msg'){
      // host -> sab (ya ek khaas seat 'to' par)
      if (ws.__seat !== 0) return;
      const m = msg.m || {};
      if (m.t === 'st' && m.to != null){
        send(r.players[m.to], m);
      } else {
        for (let i = 1; i < 4; i++) send(r.players[i], m);
      }
      return;
    }
    if (msg.t === 'act'){
      // khiladi -> host (seat server khud lagata he)
      if (ws.__seat <= 0) return;
      send(r.players[0], { t: 'act', m: msg.m || {}, from: ws.__seat });
      return;
    }

    // ---------- chale gaye ----------
    if (msg.t === 'leave'){
      if (ws.__seat >= 0 && r.players[ws.__seat] === ws){
        r.players[ws.__seat] = null;
        broadcastRoom(room, { t: 'drop', seat: ws.__seat });
      }
      ws.__room = null; ws.__seat = -1;
      return;
    }
  });

  ws.on('close', () => {
    const room = ws.__room;
    if (room == null) return;
    const r = rooms.get(room);
    if (!r) return;
    if (ws.__seat >= 0 && r.players[ws.__seat] === ws){
      r.players[ws.__seat] = null;
      broadcastRoom(room, { t: 'drop', seat: ws.__seat });
    }
    if (ws.__seat === 0){
      // host gaya -> room band
      broadcastRoom(room, { t: 'roomgone' });
      rooms.delete(room);
    } else if (r.players.every(p => !p)){
      rooms.delete(room);
    }
  });
});

server.listen(PORT, () => {
  console.log('Court Piece ONLINE server chal raha he:');
  console.log('  http://localhost:' + PORT + '/');
  console.log('(Doston ko apna public link dein — README-ONLINE.md dekhein)');
});

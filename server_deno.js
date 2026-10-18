/* ============================================================
   Court Piece ONLINE — Deno Deploy wala relay server
   (node server.js jaisa hi — sirf Deno ka tareeqa)
   Deploy: deno.com/deploy -> GitHub -> is file ko entrypoint banayein
   ============================================================ */

const HTML_URL = new URL('./court-piece.html', import.meta.url);
let htmlCache = null;
async function getHtml(){
  if (!htmlCache) htmlCache = await Deno.readFile(HTML_URL);
  return htmlCache;
}

// room code -> { players: [ws|null x4], names: [str|null x4], hostGone: timer|null }
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
  try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch(e){}
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

function wireSocket(ws){
  ws.__room = null;
  ws.__seat = -1;

  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch(err){ return; }
    if (!msg || typeof msg !== 'object') return;

    // ---------- room banao ----------
    if (msg.t === 'create'){
      const room = makeCode();
      const name = String(msg.name || 'Khiladi').slice(0, 12);
      rooms.set(room, { players: [ws, null, null, null], names: [name, null, null, null], hostGone: null });
      ws.__room = room; ws.__seat = 0;
      send(ws, { t: 'welcome', room, seat: 0, names: rooms.get(room).names });
      return;
    }

    // ---------- room me shamil ho ----------
    if (msg.t === 'join' || msg.t === 'rejoin'){
      const room = String(msg.room || '').toUpperCase().trim();
      const r = rooms.get(room);
      if (!r){ send(ws, { t: 'err', msg: 'Room code ghalat he ya room band he' }); return; }
      let seat = (msg.t === 'rejoin' && msg.seat >= 0 && msg.seat < 4 && !r.players[msg.seat]) ? msg.seat : -1;
      if (seat < 0){
        for (let i = (msg.t === 'rejoin' ? 0 : 1); i < 4; i++){ if (!r.players[i]){ seat = i; break; } }
      }
      if (seat < 0){ send(ws, { t: 'err', msg: 'Room bhara hua he (4/4)' }); return; }
      const name = String(msg.name || 'Khiladi').slice(0, 12);
      r.players[seat] = ws;
      if (!r.names[seat]) r.names[seat] = name;
      if (seat === 0 && r.hostGone){ clearTimeout(r.hostGone); r.hostGone = null; }
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
      if (ws.__seat !== 0) return;                 // sirf host se aayein
      const m = msg.m || {};
      if (m.t === 'st' && m.to != null){
        send(r.players[m.to], m);
      } else {
        for (let i = 1; i < 4; i++) send(r.players[i], m);
      }
      return;
    }
    if (msg.t === 'act'){
      if (ws.__seat <= 0) return;                  // khiladi -> host
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
    // 'ping' etc. — sirf connection zinda rakhne ke liye, kuch nahi karna
  });

  ws.addEventListener('close', () => {
    const room = ws.__room;
    if (room == null) return;
    const r = rooms.get(room);
    if (!r) return;
    if (ws.__seat >= 0 && r.players[ws.__seat] === ws){
      r.players[ws.__seat] = null;
      broadcastRoom(room, { t: 'drop', seat: ws.__seat });
    }
    if (ws.__seat === 0){
      // host ka net toota — 90 second intezar (wo wapas aa sakta he), phir room band
      r.hostGone = setTimeout(() => {
        broadcastRoom(room, { t: 'roomgone' });
        rooms.delete(room);
      }, 90000);
    } else if (r.players.every(p => !p)){
      rooms.delete(room);
    }
  });
}

Deno.serve(async (req) => {
  const up = (req.headers.get('upgrade') || '').toLowerCase();
  if (up === 'websocket'){
    const { socket, response } = Deno.upgradeWebSocket(req);
    wireSocket(socket);
    return response;
  }
  // warna: game ki file
  try {
    return new Response(await getHtml(), {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' }
    });
  } catch(e){
    return new Response('court-piece.html nahi mili', { status: 500 });
  }
});

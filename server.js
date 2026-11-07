const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  let file = req.url === '/' ? '/index.html' : req.url;
  file = path.join(__dirname, file);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    const ext = path.extname(file);
    const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css' }[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();
const WORLD_W = 300, WORLD_H = 120;

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 16; i++) c += chars[Math.floor(Math.random()*chars.length)];
  return c;
}

function genWorld() {
  const world = [];
  const surface = [];
  for (let x = 0; x < WORLD_W; x++) {
    const h = Math.floor(WORLD_H*0.45 + Math.sin(x*0.08)*4 + Math.sin(x*0.03)*7);
    surface[x] = h;
  }
  for (let x = 0; x < WORLD_W; x++) {
    world[x] = [];
    for (let y = 0; y < WORLD_H; y++) {
      const s = surface[x];
      let b = 0;
      if (y > s) b = 1;
      if (y === s) b = 2;
      if (y > s + 4) b = 3;
      world[x][y] = b;
    }
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(Math.random()*WORLD_W);
    const s = surface[x];
    if (world[x][s] === 2) {
      const h = 3 + Math.floor(Math.random()*3);
      for (let k = 1; k <= h; k++) if (s-k >= 0) world[x][s-k] = 4;
    }
  }
  return { world, surface };
}

wss.on('connection', (ws) => {
  ws.room = null;
  ws.player = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      let code;
      do { code = genCode(); } while (rooms.has(code));
      const { world, surface } = genWorld();
      const room = { code, world, surface, players: new Map() };
      rooms.set(code, room);
      joinRoom(ws, room, msg.name);
      ws.send(JSON.stringify({ type: 'created', code }));
      return;
    }
    if (msg.type === 'join') {
      const room = rooms.get(msg.code);
      if (!room) { ws.send(JSON.stringify({ type: 'error', message: 'Комната не найдена' })); return; }
      joinRoom(ws, room, msg.name);
      ws.send(JSON.stringify({ type: 'joined', code: room.code }));
      return;
    }
    if (msg.type === 'move' && ws.room && ws.player) {
      ws.player.x = msg.x; ws.player.y = msg.y;
      broadcast(ws.room, { type: 'move', id: ws.player.id, x: msg.x, y: msg.y }, ws);
      return;
    }
    if (msg.type === 'block' && ws.room) {
      const { x, y, b } = msg;
      if (x < 0 || x >= WORLD_W || y < 0 || y >= WORLD_H) return;
      ws.room.world[x][y] = b;
      broadcast(ws.room, { type: 'block', x, y, b }, ws);
      return;
    }
  });

  ws.on('close', () => {
    if (!ws.room) return;
    const room = ws.room;
    room.players.delete(ws);
    broadcast(room, { type: 'leave', id: ws.player.id });
    if (room.players.size === 0) rooms.delete(room.code);
  });
});

function joinRoom(ws, room, name) {
  const id = Math.random().toString(36).slice(2, 10);
  const spawnX = WORLD_W/2;
  const spawnY = (room.surface[Math.floor(WORLD_W/2)] - 3);
  ws.player = { id, x: spawnX, y: spawnY, name: name || 'Игрок' };
  ws.room = room;
  room.players.set(ws, ws.player);

  ws.send(JSON.stringify({
    type: 'init',
    id,
    world: room.world,
    players: [...room.players.values()].map(p => ({ id:p.id, x:p.x, y:p.y, name:p.name })),
  }));
  broadcast(room, { type: 'join', id, x: ws.player.x, y: ws.player.y, name: ws.player.name }, ws);
}

function broadcast(room, msg, except) {
  const data = JSON.stringify(msg);
  for (const client of room.players.keys()) {
    if (client !== except && client.readyState === 1) client.send(data);
  }
}

server.listen(PORT, () => console.log('Сервер на http://localhost:' + PORT));
// Zombie Escape 3D — Multiplayer WebSocket server
// Deploy to Render.com (free tier): https://render.com
// Start command: node server.js
'use strict';
const express   = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
app.get('/',        (_, res) => res.send('Zombie Escape 3D server OK'));
app.get('/health',  (_, res) => res.json({ status:'ok', rooms: rooms.size, players: totalPlayers() }));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET','POST'] },
  transports: ['websocket','polling'],
  pingTimeout:  30000,
  pingInterval: 10000,
});

// rooms: Map<roomId, { host:socketId, players:Map<id,{id,name,x,z,angle,hp}> }>
const rooms = new Map();
function totalPlayers(){ let n=0; rooms.forEach(r=>n+=r.players.size); return n; }

io.on('connection', socket => {
  let myRoom = null;
  function room(){ return myRoom ? rooms.get(myRoom) : null; }

  // ── Join / create room ──
  socket.on('joinRoom', ({ roomId, name }) => {
    const rid = String(roomId||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
    if(!rid) return socket.emit('err','無効なルームIDです');
    myRoom = rid;
    socket.join(rid);
    if(!rooms.has(rid)) rooms.set(rid, { host: socket.id, players: new Map() });
    const r = rooms.get(rid);
    r.players.set(socket.id, { id:socket.id, name:String(name||'Player').slice(0,20), x:0,z:0,angle:0,hp:100 });
    socket.emit('roomJoined', {
      isHost: r.host === socket.id,
      myId:   socket.id,
      players: [...r.players.values()],
    });
    socket.to(rid).emit('playerJoined', { id:socket.id, name:r.players.get(socket.id).name });
    console.log(`[${rid}] ${name} joined (${r.players.size} players, host=${r.host===socket.id})`);
  });

  // ── Host starts game — broadcasts map data to all guests ──
  socket.on('startGame', mapData => {
    const r = room();
    if(!r || r.host !== socket.id) return;
    io.to(myRoom).emit('gameStarted', mapData);
    console.log(`[${myRoom}] game started by host`);
  });

  // ── Position update (high-frequency, ~20/s per player) ──
  socket.on('move', ({ x, z, angle, hp }) => {
    const r = room();
    if(!r) return;
    const p = r.players.get(socket.id);
    if(p) Object.assign(p, { x, z, angle, hp });
    socket.to(myRoom).emit('move', { id:socket.id, x, z, angle, hp });
  });

  // ── Zombie kill — relay kill event to other players ──
  socket.on('zombieKill', ({ zombieId }) => {
    if(myRoom) socket.to(myRoom).emit('zombieKill', { zombieId });
  });

  // ── Item pickup — relay to other players so they remove it ──
  socket.on('itemPickup', ({ itemId }) => {
    if(myRoom) socket.to(myRoom).emit('itemPickup', { itemId });
  });

  // ── Player reached exit ──
  socket.on('gameWon', () => {
    if(myRoom) socket.to(myRoom).emit('gameWon');
  });

  // ── Disconnect ──
  socket.on('disconnect', () => {
    if(!myRoom) return;
    const r = rooms.get(myRoom);
    if(!r) return;
    const pName = r.players.get(socket.id)?.name || '?';
    r.players.delete(socket.id);
    io.to(myRoom).emit('playerLeft', { id:socket.id });
    console.log(`[${myRoom}] ${pName} left (${r.players.size} remaining)`);
    // Host migration
    if(r.host === socket.id) {
      const next = r.players.keys().next().value;
      if(next) { r.host = next; io.to(myRoom).emit('hostChanged', { hostId:next }); }
    }
    if(r.players.size === 0) { rooms.delete(myRoom); console.log(`[${myRoom}] room deleted`); }
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => console.log(`Zombie Escape server on :${PORT}`));

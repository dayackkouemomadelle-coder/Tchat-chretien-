const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Dossier pour les fichiers envoyes (photos, notes vocales)
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// --- Upload securise (type + taille limites) ---
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    const safeName = crypto.randomBytes(12).toString('hex') + ext;
    cb(null, safeName);
  }
});

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'audio/webm', 'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/x-m4a'
];

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Type de fichier non autorise'));
  }
});

app.post('/upload', (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Aucun fichier recu' });
    res.json({ url: '/uploads/' + req.file.filename, type: req.file.mimetype });
  });
});

// --- Etat en memoire (redemarre a zero si le serveur redemarre) ---
const onlineUsers = new Map(); // socket.id -> { name, country, color }
const groups = new Map();
groups.set('general', { name: 'Salon General', members: new Set() });
const gameRooms = new Map();

function sanitize(str, max = 500) {
  if (!str) return '';
  return String(str).replace(/[<>]/g, '').slice(0, max);
}

io.on('connection', (socket) => {
  socket.on('register', ({ name, country }) => {
    name = sanitize(name, 30) || 'Anonyme';
    country = sanitize(country, 40) || 'Inconnu';
    const colors = ['#1d4ed8', '#0284c7', '#2563eb', '#0891b2', '#4338ca', '#0369a1'];
    const color = colors[Math.floor(Math.random() * colors.length)];
    onlineUsers.set(socket.id, { name, country, color });
    socket.join('general');
    groups.get('general').members.add(socket.id);

    socket.emit('registered', { id: socket.id, name, country, color });
    io.to('general').emit('system', `${name} (${country}) a rejoint le salon general.`);
    broadcastGroupList();
    broadcastOnlineCount();
  });

  socket.on('createGroup', (groupName) => {
    groupName = sanitize(groupName, 40);
    if (!groupName) return;
    const id = 'g_' + crypto.randomBytes(6).toString('hex');
    groups.set(id, { name: groupName, members: new Set() });
    broadcastGroupList();
  });

  socket.on('joinGroup', (groupId) => {
    const user = onlineUsers.get(socket.id);
    if (!user || !groups.has(groupId)) return;
    socket.join(groupId);
    groups.get(groupId).members.add(socket.id);
    socket.emit('joinedGroup', groupId);
    io.to(groupId).emit('system', `${user.name} a rejoint le groupe.`);
    broadcastGroupList();
  });

  socket.on('message', ({ room, text }) => {
    const user = onlineUsers.get(socket.id);
    text = sanitize(text, 1000);
    if (!user || !room || !text) return;
    io.to(room).emit('message', {
      name: user.name, country: user.country, color: user.color,
      text, type: 'text', time: Date.now()
    });
  });

  socket.on('media', ({ room, url, mediaType }) => {
    const user = onlineUsers.get(socket.id);
    if (!user || !room || !url) return;
    io.to(room).emit('message', {
      name: user.name, country: user.country, color: user.color,
      url, type: mediaType, time: Date.now()
    });
  });

  // --- Salle d'ecoute musicale partagee (par groupe) ---
  socket.on('playMusic', ({ room, url, title }) => {
    const user = onlineUsers.get(socket.id);
    if (!user || !room || !url) return;
    io.to(room).emit('nowPlaying', {
      url: sanitize(url, 300), title: sanitize(title, 100), by: user.name
    });
  });

  // --- Jeu du Morpion (Tic-Tac-Toe) ---
  socket.on('challengeGame', ({ room }) => {
    const user = onlineUsers.get(socket.id);
    socket.to(room).emit('gameInvite', { from: socket.id, name: user?.name, room });
  });

  socket.on('acceptGame', ({ opponentId, room }) => {
    const gameId = 'game_' + crypto.randomBytes(4).toString('hex');
    gameRooms.set(gameId, { board: Array(9).fill(null), players: [opponentId, socket.id], turn: opponentId });
    [opponentId, socket.id].forEach((id, idx) => {
      io.to(id).emit('gameStart', { gameId, symbol: idx === 0 ? 'X' : 'O', yourTurn: id === opponentId });
    });
  });

  socket.on('gameMove', ({ gameId, index }) => {
    const game = gameRooms.get(gameId);
    if (!game || game.board[index] || game.turn !== socket.id) return;
    const symbol = game.players[0] === socket.id ? 'X' : 'O';
    game.board[index] = symbol;
    const winner = checkWinner(game.board);
    game.turn = game.players.find(id => id !== socket.id);
    game.players.forEach(id => io.to(id).emit('gameUpdate', { board: game.board, turn: game.turn, winner }));
    if (winner) gameRooms.delete(gameId);
  });

  socket.on('disconnect', () => {
    const user = onlineUsers.get(socket.id);
    onlineUsers.delete(socket.id);
    groups.forEach(g => g.members.delete(socket.id));
    if (user) io.emit('system', `${user.name} a quitte le chat.`);
    broadcastGroupList();
    broadcastOnlineCount();
  });

  function broadcastGroupList() {
    const list = Array.from(groups.entries()).map(([id, g]) => ({
      id, name: g.name, count: g.members.size
    }));
    io.emit('groupList', list);
  }

  function broadcastOnlineCount() {
    io.emit('onlineCount', onlineUsers.size);
  }
});

function checkWinner(b) {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (const [a, c, d] of lines) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  if (b.every(x => x)) return 'draw';
  return null;
}

server.listen(PORT, () => console.log('Serveur demarre sur le port ' + PORT));

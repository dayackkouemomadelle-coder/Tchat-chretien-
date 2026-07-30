const socket = io();

let me = null;
let currentRoom = 'general';
let mediaRecorder = null;
let audioChunks = [];
let currentGameId = null;
let mySymbol = null;

// --- ELEMENTS ---
const authScreen = document.getElementById('authScreen');
const app = document.getElementById('app');
const authForm = document.getElementById('authForm');
const messagesBox = document.getElementById('messages');
const messageForm = document.getElementById('messageForm');
const textInput = document.getElementById('textInput');
const photoInput = document.getElementById('photoInput');
const recordBtn = document.getElementById('recordBtn');
const groupListEl = document.getElementById('groupList');
const createGroupForm = document.getElementById('createGroupForm');
const currentRoomName = document.getElementById('currentRoomName');
const onlineCountEl = document.getElementById('onlineCount');
const musicForm = document.getElementById('musicForm');
const nowPlayingBox = document.getElementById('nowPlayingBox');
const nowPlayingText = document.getElementById('nowPlayingText');
const musicPlayer = document.getElementById('musicPlayer');
const challengeBtn = document.getElementById('challengeBtn');
const gameInviteBox = document.getElementById('gameInviteBox');
const gameModal = document.getElementById('gameModal');
const boardEl = document.getElementById('board');
const gameStatus = document.getElementById('gameStatus');
const closeGame = document.getElementById('closeGame');

// --- INSCRIPTION ---
authForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = document.getElementById('nameInput').value.trim();
  const country = document.getElementById('countryInput').value;
  if (!name || !country) return;
  socket.emit('register', { name, country });
});

socket.on('registered', (user) => {
  me = user;
  authScreen.classList.add('hidden');
  app.classList.remove('hidden');
});

socket.on('onlineCount', (count) => {
  onlineCountEl.textContent = count;
});

// --- GROUPES ---
socket.on('groupList', (groups) => {
  groupListEl.innerHTML = '';
  groups.forEach(g => {
    const li = document.createElement('li');
    li.className = g.id === currentRoom ? 'active' : '';
    li.innerHTML = `<span>${escapeHtml(g.name)}</span><span class="count">${g.count}</span>`;
    li.addEventListener('click', () => switchRoom(g.id, g.name));
    groupListEl.appendChild(li);
  });
});

createGroupForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('newGroupName');
  if (!input.value.trim()) return;
  socket.emit('createGroup', input.value.trim());
  input.value = '';
});

function switchRoom(id, name) {
  if (id !== 'general') socket.emit('joinGroup', id);
  currentRoom = id;
  currentRoomName.textContent = name;
  messagesBox.innerHTML = '';
  nowPlayingBox.classList.add('hidden');
  document.querySelectorAll('.group-list li').forEach(li => li.classList.remove('active'));
}

socket.on('joinedGroup', (id) => { currentRoom = id; });

// --- MESSAGES ---
messageForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = textInput.value.trim();
  if (!text) return;
  socket.emit('message', { room: currentRoom, text });
  textInput.value = '';
});

socket.on('message', (msg) => {
  const bubble = document.createElement('div');
  bubble.className = 'msg';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.style.color = msg.color || '#1d4ed8';
  meta.innerHTML = `${escapeHtml(msg.name)} <span class="country-tag">• ${escapeHtml(msg.country)}</span>`;
  bubble.appendChild(meta);

  if (msg.type === 'text') {
    const p = document.createElement('div');
    p.className = 'text';
    p.textContent = msg.text;
    bubble.appendChild(p);
  } else if (msg.type === 'image') {
    const img = document.createElement('img');
    img.src = msg.url;
    bubble.appendChild(img);
  } else if (msg.type === 'audio') {
    const audio = document.createElement('audio');
    audio.src = msg.url;
    audio.controls = true;
    bubble.appendChild(audio);
  }
  messagesBox.appendChild(bubble);
  messagesBox.scrollTop = messagesBox.scrollHeight;
});

socket.on('system', (text) => {
  const div = document.createElement('div');
  div.className = 'msg system';
  div.textContent = text;
  messagesBox.appendChild(div);
  messagesBox.scrollTop = messagesBox.scrollHeight;
});

// --- ENVOI DE PHOTO ---
photoInput.addEventListener('change', async () => {
  const file = photoInput.files[0];
  if (!file) return;
  const url = await uploadFile(file);
  if (url) socket.emit('media', { room: currentRoom, url, mediaType: 'image' });
  photoInput.value = '';
});

// --- NOTE VOCALE ---
recordBtn.addEventListener('click', async () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    recordBtn.classList.remove('recording');
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      const file = new File([blob], 'note-vocale.webm', { type: 'audio/webm' });
      const url = await uploadFile(file);
      if (url) socket.emit('media', { room: currentRoom, url, mediaType: 'audio' });
      stream.getTracks().forEach(t => t.stop());
    };
    mediaRecorder.start();
    recordBtn.classList.add('recording');
  } catch (err) {
    alert("Impossible d'accéder au micro : " + err.message);
  }
});

async function uploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (data.error) { alert(data.error); return null; }
    return data.url;
  } catch (err) {
    alert("Erreur d'envoi du fichier.");
    return null;
  }
}

// --- MUSIQUE PARTAGEE ---
musicForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = document.getElementById('musicUrl').value.trim();
  if (!url) return;
  socket.emit('playMusic', { room: currentRoom, url, title: url.split('/').pop() });
  document.getElementById('musicUrl').value = '';
});

socket.on('nowPlaying', ({ url, title, by }) => {
  nowPlayingBox.classList.remove('hidden');
  nowPlayingText.textContent = `🎵 ${title} — lancé par ${by}`;
  musicPlayer.src = url;
  musicPlayer.play().catch(() => {});
});

// --- JEU DU MORPION ---
challengeBtn.addEventListener('click', () => {
  socket.emit('challengeGame', { room: currentRoom });
  gameStatus.textContent = "Invitation envoyée, en attente...";
});

socket.on('gameInvite', ({ from, name, room }) => {
  gameInviteBox.classList.remove('hidden');
  gameInviteBox.innerHTML = `${escapeHtml(name)} te défie au Morpion ! <button id="acceptBtn">Accepter</button>`;
  document.getElementById('acceptBtn').addEventListener('click', () => {
    socket.emit('acceptGame', { opponentId: from, room });
    gameInviteBox.classList.add('hidden');
  });
});

socket.on('gameStart', ({ gameId, symbol, yourTurn }) => {
  currentGameId = gameId;
  mySymbol = symbol;
  gameModal.classList.remove('hidden');
  renderBoard(Array(9).fill(null));
  gameStatus.textContent = yourTurn ? "À toi de jouer" : "Au tour de l'adversaire";
});

socket.on('gameUpdate', ({ board, turn, winner }) => {
  renderBoard(board);
  if (winner) {
    gameStatus.textContent = winner === 'draw' ? "Match nul !" : (winner === mySymbol ? "Tu as gagné ! 🎉" : "Tu as perdu.");
  } else {
    gameStatus.textContent = (turn === socket.id) ? "À toi de jouer" : "Au tour de l'adversaire";
  }
});

function renderBoard(board) {
  boardEl.innerHTML = '';
  board.forEach((val, i) => {
    const btn = document.createElement('button');
    btn.className = 'cell';
    btn.textContent = val || '';
    btn.addEventListener('click', () => {
      if (!val && currentGameId) socket.emit('gameMove', { gameId: currentGameId, index: i });
    });
    boardEl.appendChild(btn);
  });
}

closeGame.addEventListener('click', () => {
  gameModal.classList.add('hidden');
  currentGameId = null;
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

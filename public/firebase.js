// ============ Firebase Config ============
const firebaseConfig = {
  apiKey: "AIzaSyBhKgs3SvKXE5c9PTYfwLlVBkEkDbwoSD0",
  authDomain: "npm-install-firebase-fb9da.firebaseapp.com",
  databaseURL: "https://npm-install-firebase-fb9da-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "npm-install-firebase-fb9da",
  storageBucket: "npm-install-firebase-fb9da.firebasestorage.app",
  messagingSenderId: "884178999322",
  appId: "1:884178999322:web:2a505a13fd66a1c3af19a3"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();
const storage = firebase.storage();

// ============ EmailJS Config ============
emailjs.init("ILfMM-EFqQXbiBmeZ");

// ============ الحالة العامة ============
const state = {
  user: null,
  userData: null,
  peer: null,
  myPeerId: '',
  localStream: null,
  micEnabled: true,
  handRaised: false,
  currentRoom: null,
  connections: {},
  remoteStreams: {},
  speakers: [],
  audience: [],
  viewedProfileUid: null
};

// ============ دوال مساعدة ============
function toast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(id);
  if (screen) screen.classList.add('active');
}

function generateId() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ============ المصادقة ============
async function login() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass = document.getElementById('loginPassword').value.trim();
  if (!email || !pass) return toast('يرجى ملء جميع الحقول');
  try {
    const cred = await auth.signInWithEmailAndPassword(email, pass);
    state.user = cred.user;
    toast('✅ تم تسجيل الدخول');
  } catch (e) {
    toast('❌ ' + (e.code === 'auth/user-not-found' ? 'الحساب غير موجود' : e.code === 'auth/wrong-password' ? 'كلمة مرور خاطئة' : 'خطأ في تسجيل الدخول'));
  }
}

async function register() {
  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const pass = document.getElementById('regPassword').value.trim();
  if (!name || !email || !pass) return toast('يرجى ملء جميع الحقول');
  if (pass.length < 6) return toast('كلمة المرور 6 أحرف على الأقل');
  try {
    const cred = await auth.createUserWithEmailAndPassword(email, pass);
    state.user = cred.user;
    const snap = await db.ref('users').once('value');
    const users = snap.val() || {};
    const existingIds = Object.values(users).map(u => u.customId).filter(Boolean);
    let newId;
    if (Object.keys(users).length === 0) {
      newId = '10000';
    } else {
      do { newId = generateId(); } while (existingIds.includes(newId));
    }
    await db.ref('users/' + cred.user.uid).set({
      name, email, customId: newId, photoURL: '', bio: '', coins: 1000,
      isAdmin: Object.keys(users).length === 0,
      createdAt: Date.now()
    });
    toast('✅ تم إنشاء الحساب. ID: ' + newId);
  } catch (e) {
    toast('❌ ' + (e.code === 'auth/email-already-in-use' ? 'البريد مستخدم مسبقاً' : 'خطأ في إنشاء الحساب'));
  }
}

function forgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  if (!email) return toast('يرجى إدخال البريد الإلكتروني');
  auth.sendPasswordResetEmail(email).then(() => {
    toast('📧 تم إرسال رابط إعادة التعيين إلى بريدك');
    showScreen('loginScreen');
  }).catch(() => toast('❌ البريد غير مسجل'));
}

function logout() {
  auth.signOut();
  state.user = null;
  state.userData = null;
  showScreen('loginScreen');
  closeSettings();
}

// ============ بيانات المستخدم ============
function loadUserData() {
  if (!state.user) return;
  db.ref('users/' + state.user.uid).once('value').then(snap => {
    const data = snap.val();
    if (data) {
      state.userData = data;
      updateLobbyUI();
      showScreen('lobbyScreen');
      initPeer();
      renderRooms();
    }
  });
}

function updateLobbyUI() {
  if (!state.userData) return;
  document.getElementById('lobbyNameDisplay').textContent = state.userData.name;
  document.getElementById('lobbyAvatar').textContent = state.userData.name.charAt(0).toUpperCase();
  document.getElementById('lobbyUserId').textContent = state.userData.customId;
  document.getElementById('coinDisplay').textContent = state.userData.coins || 0;
}

// ============ PeerJS ============
function initPeer() {
  if (state.peer) state.peer.destroy();
  state.peer = new Peer(undefined, {
    debug: 0,
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    }
  });
  state.peer.on('open', id => {
    state.myPeerId = id;
    db.ref('users/' + state.user.uid + '/peerId').set(id);
  });
  state.peer.on('call', async call => {
    if (!state.localStream) {
      try { state.localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
      catch (e) { toast('يجب السماح بالميكروفون'); return; }
    }
    call.answer(state.localStream);
    handleCallStream(call);
    addToStage(call.peer);
    call.on('close', () => removeFromStage(call.peer));
  });
  state.peer.on('connection', conn => {
    conn.on('data', data => handleData(conn.peer, data));
  });
}

function handleCallStream(call) {
  call.on('stream', remoteStream => {
    state.remoteStreams[call.peer] = remoteStream;
    const audio = new Audio();
    audio.srcObject = remoteStream;
    audio.play().catch(() => {});
  });
}

// ============ إدارة الغرف ============
function showCreateModal() { document.getElementById('createModal').classList.add('show'); }
function closeCreateModal() { document.getElementById('createModal').classList.remove('show'); }

function previewRoomBg() {
  const file = document.getElementById('roomBgInput').files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = e => {
      const img = document.getElementById('roomBgPreview');
      img.src = e.target.result;
      img.style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}

function createRoom() {
  if (!state.userData) return toast('سجل الدخول أولاً');
  if (state.userData.hasRoom) return toast('لديك غرفة بالفعل');
  const name = document.getElementById('newRoomName').value.trim() || 'غرفة ' + state.userData.name;
  const roomId = state.userData.customId;
  const bgFile = document.getElementById('roomBgInput').files[0];

  const roomData = {
    id: roomId,
    name,
    hostUid: state.user.uid,
    hostName: state.userData.name,
    hostId: state.userData.customId,
    speakers: [state.user.uid],
    audience: [],
    createdAt: Date.now(),
    bgURL: ''
  };

  if (bgFile) {
    const ref = storage.ref('room_bgs/' + roomId);
    ref.put(bgFile).then(() => ref.getDownloadURL()).then(url => {
      roomData.bgURL = url;
      saveRoom(roomData);
    }).catch(() => saveRoom(roomData));
  } else {
    saveRoom(roomData);
  }
}

function saveRoom(roomData) {
  db.ref('rooms/' + roomData.id).set(roomData).then(() => {
    db.ref('users/' + state.user.uid + '/hasRoom').set(true);
    state.userData.hasRoom = true;
    state.currentRoom = roomData;
    enterRoomUI(roomData);
    closeCreateModal();
    toast('✅ تم إنشاء الغرفة');
  });
}

function joinRoomById(roomId) {
  if (!state.userData) return toast('سجل الدخول أولاً');
  db.ref('rooms/' + roomId).once('value').then(snap => {
    const room = snap.val();
    if (!room) return toast('الغرفة غير موجودة');
    state.currentRoom = room;
    const aud = room.audience || [];
    if (!aud.includes(state.user.uid) && !room.speakers.includes(state.user.uid)) {
      aud.push(state.user.uid);
      db.ref('rooms/' + roomId + '/audience').set(aud);
    }
    enterRoomUI(room);
    joinPeerRoom(room.hostUid);
  });
}

function joinPeerRoom(hostUid) {
  db.ref('users/' + hostUid + '/peerId').once('value').then(snap => {
    const hostPeerId = snap.val();
    if (!hostPeerId) return toast('المضيف غير متصل حالياً');
    if (!state.localStream) {
      navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(stream => {
        state.localStream = stream;
        connectToHost(hostPeerId);
      }).catch(() => toast('يجب السماح بالميكروفون'));
    } else {
      connectToHost(hostPeerId);
    }
  });
}

function connectToHost(hostPeerId) {
  const call = state.peer.call(hostPeerId, state.localStream);
  handleCallStream(call);
  addToStage(hostPeerId);
  call.on('close', () => removeFromStage(hostPeerId));
  const conn = state.peer.connect(hostPeerId, { reliable: true });
  conn.on('data', data => handleData(hostPeerId, data));
  state.connections[hostPeerId] = { call, conn };
}

function enterRoomUI(room) {
  document.getElementById('roomTitle').textContent = room.name;
  document.getElementById('roomPeerIdDisplay').textContent = room.id;
  state.speakers = room.speakers || [];
  state.audience = room.audience || [];
  renderRoomUI();
  showScreen('roomScreen');
}

function addToStage(peerId) {
  if (state.speakers.length >= 10) {
    if (!state.audience.includes(peerId)) state.audience.push(peerId);
  } else {
    if (!state.speakers.includes(peerId)) state.speakers.push(peerId);
  }
  renderRoomUI();
}

function removeFromStage(peerId) {
  state.speakers = state.speakers.filter(p => p !== peerId);
  state.audience = state.audience.filter(p => p !== peerId);
  renderRoomUI();
}

function handleData(sender, data) {
  if (data.type === 'hand') toast(`✋ ${data.sender} يطلب الكلام`);
  if (data.type === 'mic-state') {
    if (data.active && !state.speakers.includes(sender)) addToStage(sender);
    if (!data.active) removeFromStage(sender);
  }
}

function renderRoomUI() {
  const grid = document.getElementById('micGrid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 10; i++) {
    const speakerUid = state.speakers[i];
    const slot = document.createElement('div');
    slot.className = 'mic-slot' + (speakerUid ? ' occupied' : '');
    if (speakerUid === state.user?.uid) slot.classList.add('speaking');
    if (speakerUid) {
      db.ref('users/' + speakerUid + '/name').once('value').then(s => {
        slot.innerHTML = `<div class="slot-icon">🎤</div><div class="slot-name">${s.val()||'...'}${speakerUid===state.user.uid?' (أنت)':''}</div><div class="slot-badge">متحدث</div>`;
      });
      slot.onclick = () => viewProfile(speakerUid);
    } else {
      slot.innerHTML = `<div class="slot-icon" style="opacity:0.3;">🎤</div><div style="font-size:11px;color:var(--muted);">فارغ</div>`;
    }
    grid.appendChild(slot);
  }
  const audList = document.getElementById('audienceList');
  if (audList) {
    audList.innerHTML = '';
    const allAud = state.audience.filter(a => !state.speakers.includes(a));
    if (allAud.length === 0) {
      audList.innerHTML = '<span style="color:var(--muted);font-size:12px;">لا يوجد مستمعون</span>';
    } else {
      allAud.forEach(a => {
        db.ref('users/' + a + '/name').once('value').then(s => {
          const tag = document.createElement('span');
          tag.className = 'audience-tag';
          tag.textContent = '👤 ' + (s.val()||'...');
          tag.onclick = () => viewProfile(a);
          audList.appendChild(tag);
        });
      });
    }
  }
}

// ============ الملف الشخصي ============
function viewProfile(uid) {
  state.viewedProfileUid = uid;
  db.ref('users/' + uid).once('value').then(snap => {
    const data = snap.val();
    if (!data) return;
    document.getElementById('profileAvatar').textContent = data.name.charAt(0).toUpperCase();
    document.getElementById('profileName').textContent = data.name;
    document.getElementById('profileId').textContent = 'ID: ' + data.customId;
    document.getElementById('profileModal').classList.add('show');
  });
}

function closeProfile() {
  document.getElementById('profileModal').classList.remove('show');
}

function inviteToMic() { toast('🚀 تم إرسال دعوة للمايك'); closeProfile(); }
function muteUser() { toast('🔇 تم كتم الصوت'); closeProfile(); }

function kickUser() {
  if (!state.viewedProfileUid || !state.currentRoom) return;
  if (state.userData?.customId !== '10000' && state.user?.uid !== state.currentRoom.hostUid) return toast('ليس لديك صلاحية');
  toast('🚫 تم طرد المستخدم');
  closeProfile();
}

function reportUser() { toast('🚩 تم إرسال البلاغ'); closeProfile(); }
function inviteToRoom() { toast('📨 تم إرسال دعوة للغرفة'); closeProfile(); }

// ============ أدوات الغرفة ============
async function toggleMic() {
  state.micEnabled = !state.micEnabled;
  const btn = document.getElementById('micBtn');
  if (btn) {
    btn.classList.toggle('active', state.micEnabled);
    btn.classList.toggle('muted', !state.micEnabled);
  }
  if (state.localStream) state.localStream.getAudioTracks().forEach(t => t.enabled = state.micEnabled);
  if (state.micEnabled && !state.speakers.includes(state.user.uid)) {
    state.speakers.push(state.user.uid);
    db.ref('rooms/' + state.currentRoom.id + '/speakers').set(state.speakers);
    renderRoomUI();
  }
}

function raiseHand() {
  state.handRaised = !state.handRaised;
  document.getElementById('handBtn')?.classList.toggle('active', state.handRaised);
  toast(state.handRaised ? '✋ طلبت الكلام' : 'أنزلت يدك');
  broadcast({ type: 'hand', sender: state.userData.name });
}

function broadcast(data) {
  Object.values(state.connections).forEach(c => {
    if (c.conn && c.conn.open) c.conn.send(data);
  });
}

function copyRoomLink() {
  const link = window.location.origin + window.location.pathname + '?room=' + (state.currentRoom?.id || '');
  navigator.clipboard.writeText(link).then(() => toast('🔗 تم نسخ الرابط'));
}

function leaveRoom() {
  Object.values(state.connections).forEach(c => {
    if (c.call) c.call.close();
    if (c.conn) c.conn.close();
  });
  state.connections = {};
  state.remoteStreams = {};
  state.speakers = [];
  state.audience = [];
  state.currentRoom = null;
  document.getElementById('micGrid').innerHTML = '';
  document.getElementById('audienceList').innerHTML = '';
  showScreen('lobbyScreen');
}

// ============ الإعدادات ============
function showSettings() { document.getElementById('settingsModal').classList.add('show'); }
function closeSettings() { document.getElementById('settingsModal').classList.remove('show'); }

function uploadAvatar() {
  const file = document.getElementById('avatarInput').files[0];
  if (!file || !state.user) return;
  const ref = storage.ref('avatars/' + state.user.uid);
  ref.put(file).then(() => ref.getDownloadURL()).then(url => {
    db.ref('users/' + state.user.uid + '/photoURL').set(url);
    toast('✅ تم رفع الصورة');
  });
}

function saveProfile() {
  const name = document.getElementById('settingsName').value.trim();
  const bio = document.getElementById('settingsBio').value.trim();
  if (!name) return toast('الاسم مطلوب');
  db.ref('users/' + state.user.uid).update({ name, bio }).then(() => {
    state.userData.name = name;
    state.userData.bio = bio;
    updateLobbyUI();
    closeSettings();
    toast('✅ تم الحفظ');
  });
}

// ============ الردهة ============
function renderRooms() {
  db.ref('rooms').on('value', snap => {
    const rooms = snap.val() || {};
    const container = document.getElementById('roomListContainer');
    if (!container) return;
    container.innerHTML = '';
    const roomIds = Object.keys(rooms);
    if (roomIds.length === 0) {
      container.innerHTML = '<div class="empty-rooms"><i class="fa-solid fa-microphone-lines empty-icon"></i>لا توجد غرف نشطة حالياً<br>أنشئ غرفتك الأولى</div>';
      return;
    }
    roomIds.forEach(id => {
      const room = rooms[id];
      const card = document.createElement('div');
      card.className = 'room-card';
      card.onclick = () => joinRoomById(id);
      card.innerHTML = `
        <div class="room-info">
          <div class="room-title">${room.name}</div>
          <div class="room-meta">ID: ${room.id} · ${(room.speakers||[]).length+(room.audience||[]).length} مشارك</div>
        </div>
        <div class="room-speakers">
          ${(room.speakers||[]).slice(0,5).map(() => '<span class="dot"></span>').join('')}
          ${(room.audience||[]).length > 0 ? '<span class="dot empty"></span>' : ''}
        </div>
      `;
      container.appendChild(card);
    });
  });
}

function joinById() {
  const id = document.getElementById('joinRoomIdInput')?.value.trim();
  if (id) joinRoomById(id);
}

// ============ مراقبة حالة المصادقة ============
auth.onAuthStateChanged(user => {
  if (user) {
    state.user = user;
    loadUserData();
  } else {
    state.user = null;
    state.userData = null;
    showScreen('loginScreen');
  }
});

// ============ انضمام تلقائي عبر الرابط ============
const params = new URLSearchParams(window.location.search);
const roomParam = params.get('room');
if (roomParam) {
  window.addEventListener('load', () => {
    setTimeout(() => {
      if (state.user && state.userData) joinRoomById(roomParam);
    }, 2000);
  });
}

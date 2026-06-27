const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// خدمة الملفات الثابتة (الواجهة)
app.use(express.static('public'));

// حالة الغرف
const rooms = {};

io.on('connection', (socket) => {
  console.log('اتصال جديد:', socket.id);

  // الانضمام إلى غرفة
  socket.on('join-room', (roomId, userName) => {
    socket.join(roomId);
    socket.userName = userName;
    socket.roomId = roomId;

    if (!rooms[roomId]) rooms[roomId] = [];
    rooms[roomId].push({ id: socket.id, name: userName });

    // إخبار الآخرين في الغرفة
    socket.to(roomId).emit('user-joined', { id: socket.id, name: userName });
    
    // إرسال قائمة الموجودين للمستخدم الجديد
    socket.emit('room-users', rooms[roomId].filter(u => u.id !== socket.id));
  });

  // استقبال الصوت وبثه للجميع في الغرفة
  socket.on('audio-stream', (audioData) => {
    socket.to(socket.roomId).emit('audio-stream', {
      id: socket.id,
      audio: audioData
    });
  });

  // رسائل الدردشة
  socket.on('chat-message', (text) => {
    io.to(socket.roomId).emit('chat-message', {
      sender: socket.userName,
      text: text
    });
  });

  // رفع اليد
  socket.on('raise-hand', () => {
    socket.to(socket.roomId).emit('hand-raised', socket.userName);
  });

  // عند الخروج
  socket.on('disconnect', () => {
    if (socket.roomId && rooms[socket.roomId]) {
      rooms[socket.roomId] = rooms[socket.roomId].filter(u => u.id !== socket.id);
      if (rooms[socket.roomId].length === 0) delete rooms[socket.roomId];
      socket.to(socket.roomId).emit('user-left', socket.id);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`السيرفر يعمل على المنفذ ${PORT}`));

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const os = require('os');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 1e7 // 10MB limit for image attachments/snippets
});

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory room store (history per room)
// Structure: roomCode -> { clips: [ { id, text, type, deviceName, deviceType, timestamp, encrypted } ], users: Map(socketId -> userInfo) }
const rooms = new Map();

function getRoom(roomCode) {
  if (!rooms.has(roomCode)) {
    rooms.set(roomCode, {
      clips: [],
      users: new Map()
    });
  }
  return rooms.get(roomCode);
}

// Helper: Get local network IP addresses
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: name, ip: iface.address });
      }
    }
  }
  return addresses;
}

// ==========================================
// REST API Endpoints
// ==========================================

// Server & Network Status
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    port: PORT,
    localIps: getLocalIpAddresses(),
    activeRooms: rooms.size
  });
});

// Push a clip via HTTP POST (Great for iOS Shortcuts, Tasker, cURL, or CLI)
app.post('/api/clip', (req, res) => {
  const { room, text, type = 'text', deviceName = 'API-Client', deviceType = 'api', encrypted = false } = req.body;

  if (!room || typeof text !== 'string') {
    return res.status(400).json({ error: 'Missing required fields: "room" and "text"' });
  }

  const roomData = getRoom(room);
  const clip = {
    id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
    text,
    type, // 'text', 'url', 'image', 'code'
    deviceName,
    deviceType, // 'laptop', 'mobile', 'tablet', 'api'
    encrypted: Boolean(encrypted),
    timestamp: new Date().toISOString()
  };

  // Add to history (keep max 50 items)
  roomData.clips.unshift(clip);
  if (roomData.clips.length > 50) {
    roomData.clips.pop();
  }

  // Broadcast to all sockets in room
  io.to(room).emit('new-clip', clip);

  return res.status(201).json({ success: true, clip });
});

// Get latest clip for a room
app.get('/api/clip/latest', (req, res) => {
  const room = req.query.room;
  if (!room) {
    return res.status(400).json({ error: 'Query parameter "room" is required' });
  }

  const roomData = getRoom(room);
  const latest = roomData.clips[0] || null;
  res.json({ room, latest });
});

// Get clip history for a room
app.get('/api/clip/history', (req, res) => {
  const room = req.query.room;
  if (!room) {
    return res.status(400).json({ error: 'Query parameter "room" is required' });
  }

  const roomData = getRoom(room);
  const limit = parseInt(req.query.limit, 10) || 25;
  res.json({
    room,
    count: roomData.clips.length,
    clips: roomData.clips.slice(0, limit)
  });
});

// Clear room history
app.delete('/api/clip/history', (req, res) => {
  const room = req.query.room;
  if (!room) {
    return res.status(400).json({ error: 'Query parameter "room" is required' });
  }

  const roomData = getRoom(room);
  roomData.clips = [];
  io.to(room).emit('clear-history');

  res.json({ success: true, message: `History cleared for room ${room}` });
});

// ==========================================
// Real-Time Socket.io Connection
// ==========================================
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  // Client joins a room
  socket.on('join-room', ({ room, deviceName, deviceType }) => {
    if (!room) return;

    // Leave previous room if any
    if (currentRoom) {
      socket.leave(currentRoom);
      const prevRoomData = rooms.get(currentRoom);
      if (prevRoomData) {
        prevRoomData.users.delete(socket.id);
        io.to(currentRoom).emit('room-users', Array.from(prevRoomData.users.values()));
      }
    }

    currentRoom = room;
    currentUser = {
      socketId: socket.id,
      deviceName: deviceName || 'Anonymous Device',
      deviceType: deviceType || 'unknown',
      joinedAt: new Date().toISOString()
    };

    socket.join(room);
    const roomData = getRoom(room);
    roomData.users.set(socket.id, currentUser);

    // Send existing history & device roster to the newly connected device
    socket.emit('init-history', roomData.clips.slice(0, 30));
    io.to(room).emit('room-users', Array.from(roomData.users.values()));
  });

  // Client broadcasts a new clip
  socket.on('send-clip', (data) => {
    if (!currentRoom || !data || typeof data.text !== 'string') return;

    const roomData = getRoom(currentRoom);
    const clip = {
      id: 'clip_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      text: data.text,
      type: data.type || 'text',
      deviceName: currentUser ? currentUser.deviceName : (data.deviceName || 'Device'),
      deviceType: currentUser ? currentUser.deviceType : (data.deviceType || 'unknown'),
      encrypted: Boolean(data.encrypted),
      timestamp: new Date().toISOString()
    };

    roomData.clips.unshift(clip);
    if (roomData.clips.length > 50) {
      roomData.clips.pop();
    }

    // Broadcast to EVERYONE else in the room
    socket.to(currentRoom).emit('new-clip', clip);
    // Confirm back to sender
    socket.emit('clip-sent', clip);
  });

  // Client requests history clear
  socket.on('request-clear', () => {
    if (!currentRoom) return;
    const roomData = getRoom(currentRoom);
    roomData.clips = [];
    io.to(currentRoom).emit('clear-history');
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (currentRoom && rooms.has(currentRoom)) {
      const roomData = rooms.get(currentRoom);
      roomData.users.delete(socket.id);
      io.to(currentRoom).emit('room-users', Array.from(roomData.users.values()));

      // Clean up empty room after 1 hour if inactive
      if (roomData.users.size === 0) {
        setTimeout(() => {
          if (rooms.has(currentRoom) && rooms.get(currentRoom).users.size === 0) {
            rooms.delete(currentRoom);
          }
        }, 3600000);
      }
    }
  });
});

// Start Server
server.listen(PORT, '0.0.0.0', () => {
  const localIps = getLocalIpAddresses();
  console.log(`\n======================================================`);
  console.log(`🚀 ClipSync Server is running on port ${PORT}!`);
  console.log(`💻 Laptop Access:   http://localhost:${PORT}`);
  if (localIps.length > 0) {
    console.log(`📱 Mobile Access:   http://${localIps[0].ip}:${PORT}`);
    localIps.forEach(net => {
      console.log(`   └─ Interface (${net.interface}): http://${net.ip}:${PORT}`);
    });
  }
  console.log(`======================================================\n`);
});

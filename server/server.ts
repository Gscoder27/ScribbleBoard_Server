import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import { Server } from 'socket.io';

/** Whiteboard element type */
type WhiteboardElement = { id: string;[key: string]: any };

/** In-memory storage of all whiteboard elements per room */
const whiteboardStates: { [roomId: string]: WhiteboardElement[] } = {};
/** In-memory storage of users per room */
const roomUsers: { [roomId: string]: Array<{ id: string; name: string; isHost: boolean }> } = {};

/** 1. Setup Express app */
const app = express();
app.use(cors());

/** 2. Create HTTP + WebSocket server */
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

/** 3. REST Route (for testing) */
app.get("/", (req, res) => {
  res.send("✅ Server is working! Welcome to ScribbleBoard Server.");
});

/** 4. WebSocket handling */
io.on('connection', (socket) => {
  console.log('🔌 A user connected:', socket.id);

  // Store user's room and info
  let joinedRoomId: string | null = null;
  let userName: string | null = null;
  let isHost: boolean = false;

  // Handle joining a room
  socket.on('join-room', (roomId, name, isHostParam) => {
    socket.join(roomId);
    joinedRoomId = roomId;
    userName = name;
    isHost = !!isHostParam;

    // Store user data in socket for easy access
    socket.data.user = { name, roomId, isHost };

    // Add user to roomUsers
    if (!roomUsers[roomId]) roomUsers[roomId] = [];
    // Remove any previous entry for this socket
    roomUsers[roomId] = roomUsers[roomId].filter(u => u.id !== socket.id);
    roomUsers[roomId].push({ id: socket.id, name, isHost });

    // Emit updated user list
    io.to(roomId).emit('room-users', roomUsers[roomId].map(u => ({ name: u.name, isHost: u.isHost })));

    // Debug log
    console.log('roomUsers after join:', JSON.stringify(roomUsers, null, 2));

    // Send current state to the new user
    if (whiteboardStates[roomId]) {
      socket.emit('whiteboard-state', whiteboardStates[roomId]);
    } else {
      whiteboardStates[roomId] = [];
      socket.emit('whiteboard-state', []);
    }
  });

  // When a user updates or draws an element
  socket.on('element-update', (elementData) => {
    // Find the room this socket is in
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    const roomId = rooms[0];
    if (!roomId) return;
    if (!whiteboardStates[roomId]) whiteboardStates[roomId] = [];
    updateElementInRoom(roomId, elementData);
    // Broadcast to others in the room
    socket.to(roomId).emit('element-update', elementData);
  });

  // Handle request for current whiteboard state
  socket.on('request-whiteboard-state', (roomId) => {
    if (whiteboardStates[roomId]) {
      socket.emit('whiteboard-state', whiteboardStates[roomId]);
    }
  });

  // FIXED: Clear whiteboard - only host can clear for everyone
  socket.on('clear-whiteboard', (roomId) => {
    const user = socket.data?.user;

    if (!user || !roomId) {
      console.log('❌ Clear whiteboard: Invalid user or room data');
      return;
    }

    if (user.isHost && user.roomId === roomId) {
      console.log('🧹 Host clearing canvas for room:', roomId);
      // Clear the server-side whiteboard state
      whiteboardStates[roomId] = [];
      // Broadcast clear to all users in the room (including host)
      io.to(roomId).emit('clear-whiteboard');
    } else {
      console.log('❌ Non-host attempted to clear canvas or room mismatch. User:', user.name, 'isHost:', user.isHost, 'requestedRoom:', roomId, 'userRoom:', user.roomId);
      // Send error message to the user
      socket.emit('clear-whiteboard-error', 'Only the host can clear the canvas for everyone.');
    }
  });

  socket.on('color-change', (color) => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    const roomId = rooms[0];
    if (!roomId) return;
    socket.to(roomId).emit('color-change', color);
  });

  socket.on('brush-size-change', (size) => {
    const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
    const roomId = rooms[0];
    if (!roomId) return;
    socket.to(roomId).emit('brush-size-change', size);
  });

  // Relay user cursor and typing activity to others in the room
  // socket.on('user-cursor-activity', (activity) => {
  //   const { roomId } = activity;
  //   if (!roomId) return;
  //   socket.to(roomId).emit('user-cursor-activity', activity);
  // });

  // // Relay user-cursor-activity events for live cursor/username overlays
  // socket.on('user-cursor-activity', (data) => {
  //   if (!data || !data.roomId) return;
  //   socket.to(data.roomId).emit('user-cursor-activity', data);
  // });

  // In server.ts, replace the existing user-cursor-activity handler with this:

  socket.on('user-cursor-activity', (activity) => {
    const { roomId } = activity;
    if (!roomId) return;

    // Add username from socket data if not provided
    const user = socket.data?.user;
    const activityWithUser = {
      ...activity,
      username: activity.username || (user ? user.name : 'Unknown User'),
      userId: activity.userId || socket.id
    };

    console.log('Broadcasting cursor activity:', activityWithUser);
    socket.to(roomId).emit('user-cursor-activity', activityWithUser);
  });


  socket.on('disconnect', () => {
    console.log('❌ User disconnected:', socket.id);
    if (joinedRoomId && roomUsers[joinedRoomId]) {
      // Find the user that disconnected
      const disconnectedUser = roomUsers[joinedRoomId].find(u => u.id === socket.id);

      roomUsers[joinedRoomId] = roomUsers[joinedRoomId].filter(u => u.id !== socket.id);
      // Emit updated user list
      io.to(joinedRoomId).emit('room-users', roomUsers[joinedRoomId].map(u => ({ name: u.name, isHost: u.isHost })));

      // Emit user-left-alert if we found the user
      if (disconnectedUser) {
        console.log(`[disconnect] User ${disconnectedUser.name} disconnected from room ${joinedRoomId}`);
        io.to(joinedRoomId).emit('user-left-alert', disconnectedUser.name);
      }

      // Debug log
      console.log('roomUsers after disconnect:', JSON.stringify(roomUsers, null, 2));
      // Optionally, clean up empty rooms
      if (roomUsers[joinedRoomId].length === 0) {
        delete roomUsers[joinedRoomId];
        delete whiteboardStates[joinedRoomId];
      }
    }
  });
});

/** 5. Start the server */
const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});

/** 🔧 Utility function to update the element list for a room */
const updateElementInRoom = (roomId: string, elementData: WhiteboardElement) => {
  if (!elementData || !elementData.id || !elementData.type) return;
  const elements = whiteboardStates[roomId];
  const index = elements.findIndex(element => element.id === elementData.id);
  if (index === -1) {
    elements.push(elementData); // new element
  } else {
    elements[index] = elementData; // updated element
  }
};

const pendingApprovals = new Map(); // socketId -> { userName, roomId }

io.on("connection", (socket) => {
  socket.on("join-request", ({ userName, roomId }) => {
    // Find the host socket ID for the room
    const hostUser = roomUsers[roomId]?.find(u => u.isHost);
    const hostSocketId = hostUser?.id;

    if (hostSocketId) {
      pendingApprovals.set(socket.id, { userName, roomId });

      // Send approval request to host
      io.to(hostSocketId).emit("approve-user-request", {
        userId: socket.id,
        userName,
        roomId,
      });

      // Tell joining user to wait
      socket.emit("waiting-for-approval");
    } else {
      socket.emit("room-error", "Host not found for the room.");
    }
  });

  socket.on("host-response", ({ userId, approved }) => {
    const request = pendingApprovals.get(userId);
    if (!request) return;

    if (approved) {
      io.to(userId).emit("join-response", { approved: true });
    } else {
      io.to(userId).emit("join-response", { approved: false });
    }

    pendingApprovals.delete(userId);
  });
});


export default app; // For potential future testing
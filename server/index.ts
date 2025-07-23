import express, { type Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { Server as SocketIOServer } from "socket.io";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import { loadAppStorage, saveAppStorage } from "./storage";

// Whiteboard element type
type WhiteboardElement = { id: string; [key: string]: any };

// In-memory storage of all whiteboard elements per room
const whiteboardStates: { [roomId: string]: WhiteboardElement[] } = {};

// Persistent storage for rooms, messages, hosts, and whiteboard states
let { validRooms, chatMessages, roomHosts, whiteboardStates: savedWhiteboardStates } = loadAppStorage();
if (!Array.isArray(validRooms)) validRooms = [];
if (!chatMessages) chatMessages = {};
if (!roomHosts) roomHosts = {};
if (!savedWhiteboardStates) savedWhiteboardStates = {};

// Load whiteboard states from persistent storage
Object.assign(whiteboardStates, savedWhiteboardStates);

// In-memory storage of users per room
const roomUsers: { [roomId: string]: Array<{ id: string; name: string; isHost: boolean }> } = {};

const app = express();
console.log("Server running in", app.get("env"), "mode");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const httpServer = await registerRoutes(app);
  
  // Create Socket.IO server
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Socket.IO event handling
  io.on('connection', (socket) => {
    console.log('🔌 A user connected:', socket.id);

    // Store user's room and info
    let joinedRoomId: string | null = null;
    let userName: string | null = null;
    let isHost: boolean = false;

    // Join request approval system
    socket.on('join-request', ({ userName, roomId }) => {
      // Only allow join requests for existing rooms
      if (!validRooms.includes(roomId)) {
        socket.emit('room-error', 'No such room exists. Either enter a valid code or create your new room.');
        return;
      }
      // Find host socket for the room
      const hostName = roomHosts[roomId];
      const hostSocketId = roomUsers[roomId]?.find(u => u.name === hostName)?.id;
      if (!hostSocketId) {
        socket.emit('room-error', 'Host is not available. Try again later.');
        return;
      }
      // Notify host of join request
      io.to(hostSocketId).emit('approve-user-request', {
        userId: socket.id,
        userName,
        roomId
      });
      // Tell joining user to wait
      socket.emit('waiting-for-approval');
    });

    // Host responds to join request
    socket.on('host-response', ({ userId, approved }) => {
      if (!joinedRoomId || !userName || !isHost) return;
      // Only allow host to approve/reject
      const hostName = roomHosts[joinedRoomId];
      if (userName !== hostName) return;
      io.to(userId).emit('join-response', { approved });
    });

    // Join room (bypasses approval for host, or after approval for guests)
    socket.on('join-room', (roomId: string, userNameParam: string, isHostParam: boolean) => {
      console.log(`[join-room] user: ${userNameParam}, roomId: ${roomId}, isHost: ${isHostParam}, validRooms: ${validRooms.join(',')}`);
      
      // Store user info
      joinedRoomId = roomId;
      userName = userNameParam;
      isHost = isHostParam;
      
      // If creating a room (host), only allow if it does not exist
      if (isHost && !validRooms.includes(roomId)) {
        // Room does not exist, so create it
        roomHosts[roomId] = userName;
        validRooms.push(roomId);
        if (!chatMessages[roomId]) chatMessages[roomId] = [];
        if (!whiteboardStates[roomId]) whiteboardStates[roomId] = [];
        
        const createdMsg = {
          id: `system-created-${Date.now()}`,
          user: userName,
          message: `${userName} created the room`,
          timestamp: Date.now(),
          system: true,
        };
        chatMessages[roomId].push(createdMsg);

        // Avoid duplicate join messages on refresh for the host
        const lastMessage = chatMessages[roomId][chatMessages[roomId].length - 1];
        const alreadyJoined = lastMessage && lastMessage.system && lastMessage.user === userName && lastMessage.message.includes('joined');
        if (!alreadyJoined) {
          const joinMsg = {
            id: `system-join-${Date.now()}`,
            user: userName,
            message: `${userName} joined the room`,
            timestamp: Date.now(),
            system: true,
          };
          chatMessages[roomId].push(joinMsg);
        }
        saveAppStorage({ validRooms, chatMessages, roomHosts });
        socket.join(roomId);
        
        // ADD USER TO ROOM USERS
        if (!roomUsers[roomId]) roomUsers[roomId] = [];
        roomUsers[roomId] = roomUsers[roomId].filter(u => u.name !== userName);
        roomUsers[roomId].push({ id: socket.id, name: userName, isHost: true });
        
        // EMIT USER LIST
        io.to(roomId).emit('room-users', roomUsers[roomId].map(u => ({ name: u.name, isHost: u.isHost })));
        
        // Always send full chat history after join
        socket.emit('chat-messages', chatMessages[roomId]);
        socket.emit('whiteboard-state', whiteboardStates[roomId] || []);
        console.log(`[join-room] Host joined and chat history sent for room: ${roomId}`);
        return;
      }
      
      // For all other cases (host rejoining or guest joining), treat as a regular join if the room exists
      if (!validRooms.includes(roomId)) {
        console.warn(`[join-room] No such room exists: ${roomId}`);
        socket.emit('room-error', 'No such room exists. Either enter a valid code or create your new room.');
        return;
      }
      
      // Check if user is rejoining as host
      if (roomHosts[roomId] === userName) {
        isHost = true;
      }
      
      socket.join(roomId);
      if (!chatMessages[roomId]) chatMessages[roomId] = [];
      
      // ADD USER TO ROOM USERS
      if (!roomUsers[roomId]) roomUsers[roomId] = [];
      roomUsers[roomId] = roomUsers[roomId].filter(u => u.name !== userName);
      roomUsers[roomId].push({ id: socket.id, name: userName, isHost: isHost });
      
      // EMIT USER LIST
      io.to(roomId).emit('room-users', roomUsers[roomId].map(u => ({ name: u.name, isHost: u.isHost })));
      
      // Avoid duplicate join messages on refresh
      const lastMessage = chatMessages[roomId][chatMessages[roomId].length - 1];
      const alreadyJoined = lastMessage && lastMessage.system && lastMessage.user === userName && lastMessage.message.includes('joined');
      if (!alreadyJoined) {
        const joinMsg = {
          id: `system-join-${Date.now()}`,
          user: userName,
          message: `${userName} joined the room`,
          timestamp: Date.now(),
          system: true,
        };
        chatMessages[roomId].push(joinMsg);
        saveAppStorage({ validRooms, chatMessages, roomHosts });
        io.to(roomId).emit('chat-message', joinMsg);
        console.log(`[join-room] User joined and join message broadcasted for room: ${roomId}`);
      }
      
      // Always send full chat history after join
      socket.emit('chat-messages', chatMessages[roomId]);
      socket.emit('whiteboard-state', whiteboardStates[roomId] || []);
      console.log(`[join-room] User joined and chat history sent for room: ${roomId}`);
    });

    // User cursor activity
    socket.on('user-cursor-activity', (activity) => {
      const { roomId } = activity;
      if (roomId) {
        socket.to(roomId).emit('user-cursor-activity', activity);
      }
    });

    // Leave room - EXPLICIT LEAVE
    socket.on('leave-room', (roomId: string, userNameToLeave: string) => {
      console.log(`[leave-room] User ${userNameToLeave} explicitly leaving room ${roomId}`);
      // Remove user from roomUsers
      if (roomUsers[roomId]) {
        roomUsers[roomId] = roomUsers[roomId].filter(u => u.name !== userNameToLeave);
        // Emit updated user list to remaining users
        io.to(roomId).emit('room-users', roomUsers[roomId].map(u => ({ name: u.name, isHost: u.isHost })));
      }
      // Add leave message to chat
      if (chatMessages[roomId]) {
        const leaveMsg = {
          id: `system-leave-${Date.now()}`,
          user: userNameToLeave,
          message: `${userNameToLeave} left the room`,
          timestamp: Date.now(),
          system: true,
        };
        chatMessages[roomId].push(leaveMsg);
        saveAppStorage({ validRooms, chatMessages, roomHosts });
        // Broadcast leave message to ALL users in the room (including the one leaving if still connected)
        io.to(roomId).emit('chat-message', leaveMsg);
        // Emit user-left-alert to ALL users in the room EXCEPT the one leaving
        socket.to(roomId).emit('user-left-alert', userNameToLeave);
        console.log(`[leave-room] Broadcasted leave notifications for user: ${userNameToLeave} in room: ${roomId}`);
      }
      // If the leaving user is the host, clear the whiteboard and remove the room from validRooms
      if (roomHosts[roomId] === userNameToLeave) {
        whiteboardStates[roomId] = [];
        // Remove from validRooms and roomHosts
        validRooms = validRooms.filter((r: string) => r !== roomId);
        delete roomHosts[roomId];
        saveAppStorage({ validRooms, chatMessages, roomHosts, whiteboardStates });
        io.to(roomId).emit('clear-whiteboard');
      }
      // Remove the leaving user from the socket room
      socket.leave(roomId);
    });

    // Whiteboard element updates
    socket.on('element-update', (elementData) => {
      // Find the room this socket is in
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      const roomId = rooms[0];
      if (!roomId) return;
      
      if (!whiteboardStates[roomId]) whiteboardStates[roomId] = [];
      updateElementInRoom(roomId, elementData);
      socket.to(roomId).emit('element-update', elementData);
    });

    // Chat messages
    socket.on('chat-message', (roomId: string, message: any) => {
      if (!chatMessages[roomId]) {
        chatMessages[roomId] = [];
      }
      chatMessages[roomId].push(message);
      saveAppStorage({ validRooms, chatMessages, roomHosts });
      socket.to(roomId).emit('chat-message', message);
      console.log(`[chat-message] Message from ${message.user} in room ${roomId}: ${message.message}`);
    });

    // Clear whiteboard - only host can clear for everyone
    socket.on('clear-whiteboard', (roomId: string) => {
      console.log(`[clear-whiteboard] Request from user: ${userName}, roomId: ${roomId}, isHost: ${isHost}`);
      
      if (!roomId || !joinedRoomId) {
        console.log('❌ Clear whiteboard: Invalid room data');
        return;
      }
      
      // Check if user is host of the room
      const userIsHost = isHost && roomHosts[roomId] === userName;
      
      if (userIsHost) {
        console.log('🧹 Host clearing canvas for room:', roomId);
        // Clear the server-side whiteboard state
        whiteboardStates[roomId] = [];
        // Save the cleared state to persistent storage
        saveAppStorage({ validRooms, chatMessages, roomHosts, whiteboardStates });
        // Broadcast clear to all users in the room (including host)
        io.to(roomId).emit('clear-whiteboard');
        // Send success message to the host
        socket.emit('clear-whiteboard-success', 'Canvas cleared for everyone!');
      } else {
        console.log('❌ Non-host attempted to clear canvas. User:', userName, 'isHost:', isHost, 'roomHost:', roomHosts[roomId]);
        // Send error message to the user
        socket.emit('clear-whiteboard-error', 'Only the host can clear the canvas for everyone.');
      }
    });

    // Color change
    socket.on('color-change', (color) => {
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      const roomId = rooms[0];
      if (!roomId) return;
      socket.to(roomId).emit('color-change', color);
    });

    // Brush size change
    socket.on('brush-size-change', (size) => {
      const rooms = Array.from(socket.rooms).filter(r => r !== socket.id);
      const roomId = rooms[0];
      if (!roomId) return;
      socket.to(roomId).emit('brush-size-change', size);
    });

    // Disconnect - AUTOMATIC DISCONNECT
    socket.on('disconnect', () => {
      console.log('❌ User disconnected:', socket.id);
      // Handle user disconnect
      if (joinedRoomId && roomUsers[joinedRoomId]) {
        // Find the user that disconnected
        const disconnectedUser = roomUsers[joinedRoomId].find(u => u.id === socket.id);
        if (disconnectedUser) {
          console.log(`[disconnect] User ${disconnectedUser.name} disconnected from room ${joinedRoomId}`);
          // Remove user from roomUsers
          roomUsers[joinedRoomId] = roomUsers[joinedRoomId].filter(u => u.id !== socket.id);
          // Emit updated user list to remaining users
          io.to(joinedRoomId).emit('room-users', roomUsers[joinedRoomId].map(u => ({ name: u.name, isHost: u.isHost })));
          // Add disconnect message to chat
          if (chatMessages[joinedRoomId]) {
            const leaveMsg = {
              id: `system-disconnect-${Date.now()}`,
              user: disconnectedUser.name,
              message: `${disconnectedUser.name} left the room`,
              timestamp: Date.now(),
              system: true,
            };
            chatMessages[joinedRoomId].push(leaveMsg);
            saveAppStorage({ validRooms, chatMessages, roomHosts });
            // Broadcast to remaining users in the room
            io.to(joinedRoomId).emit('chat-message', leaveMsg);
          }
          // DO NOT emit user-left-alert on disconnect (prevents toast on refresh)
          // io.to(joinedRoomId).emit('user-left-alert', disconnectedUser.name);
          console.log(`[disconnect] Broadcasted disconnect notifications for user: ${disconnectedUser.name} in room: ${joinedRoomId}`);
        }
        // Optionally, clean up empty rooms
        if (roomUsers[joinedRoomId].length === 0) {
          delete roomUsers[joinedRoomId];
          console.log(`[disconnect] Cleaned up empty room: ${joinedRoomId}`);
        }
      }
    });
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    console.log("Using Vite middleware for frontend (dev mode)");
    await setupVite(app, httpServer);
  } else {
    console.log("Serving static files (production mode)");
    serveStatic(app);
  }

  // Serve the app on port 3000
  // this serves both the API and the client.
  const port = 3000;
  httpServer.listen({
    port,
    host: "0.0.0.0",
    reusePort: true,
  }, () => {
    log(`serving on port ${port}`);
  });
})();

// Utility function to update the element list for a room
const updateElementInRoom = (roomId: string, elementData: WhiteboardElement) => {
  if (!elementData || !elementData.id || !elementData.type) return;
  
  const elements = whiteboardStates[roomId];
  const index = elements.findIndex(element => element.id === elementData.id);

  if (index === -1) {
    elements.push(elementData); // new element
  } else {
    elements[index] = elementData; // updated element
  }
  
  // Save whiteboard states to persistent storage
  saveAppStorage({ validRooms, chatMessages, roomHosts, whiteboardStates });
};

// Utility function to clear specific rooms when host leaves
const roomsToClear = ["owldjr-t3k5-kvi","s8a27u-8i66-6m5","v6pfym-pef8-8cs","axdg2c-kamc-whj","b3p6qb-hypp-9cy","uonjkk-vt84-qk3","bzjgiu-qh13-rj9","5btfy6-vqzd-26t","leeeo3-xet0-tr6","1zubt5-lr81-f9i","hsob9g-e56h-e02","tup3il-te4l-kr3","o8qm14-h062-b6u","tpfho9-dqlm-sh4","lin739-uxvs-oty","21a5kn-6bvs-qo7","u0p0yj-5cb3-m4s","ogq0k7-qb0g-3uq","3x8p4f-1h0k-xkn","zonxdt-bnmp-9sx","0ncc2t-fqb6-nvn","17xjwp-r7ix-v9f","rgz3jw-0j56-pma","01op7f-qbck-zyu","oldlow-6zhp-z6n","a7hcgl-s3tq-04g","8h1lhs-bpc4-r00","rt7fx8-dl1f-mn0","ut3jek-zxd6-zp9","uskwx3-l2vz-fqh","8hpsz1-u3c4-7fd","6mbwa0-jedh-5xt","4pnc30-gv2a-irt","gow7uh-248v-w1l","00lsod-8lux-x30"];
roomsToClear.forEach(roomId => {
  whiteboardStates[roomId] = [];
});
saveAppStorage({ validRooms, chatMessages, roomHosts, whiteboardStates });
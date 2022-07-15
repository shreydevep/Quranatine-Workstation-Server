require("dotenv").config();
const express = require("express");
const socket = require("socket.io");
const { ExpressPeerServer } = require("peer");
const cors = require("cors");
const bodyParser = require("body-parser");
const lyricsFinder = require("lyrics-finder");
const SpotifyWebApi = require("spotify-web-api-node");
const groupCallHandler = require("./groupCallHandler");

const PORT = 3001;
const app = express();

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.post("/refresh", (req, res) => {
  const refreshToken = req.body.refreshToken;
  const spotifyApi = new SpotifyWebApi({
    redirectUri: process.env.REDIRECT_URI,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    refreshToken,
  });

  spotifyApi
    .refreshAccessToken()
    .then((data) => {
      res.json({
        accessToken: data.body.access_token,
        expiresIn: data.body.expires_in,
      });
    })
    .catch((err) => {
      console.log(err);
      res.sendStatus(400);
    });
});

app.post("/login", (req, res) => {
  const code = req.body.code;
  const spotifyApi = new SpotifyWebApi({
    redirectUri: process.env.REDIRECT_URI,
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
  });

  spotifyApi
    .authorizationCodeGrant(code)
    .then((data) => {
      res.json({
        accessToken: data.body.access_token,
        refreshToken: data.body.refresh_token,
        expiresIn: data.body.expires_in,
      });
    })
    .catch((err) => {
      res.sendStatus(400);
    });
});

const server = app.listen(PORT, () => {
  console.log(`server is listening on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});

const peerServer = ExpressPeerServer(server, { debug: true });

app.use("/peerjs", peerServer);
groupCallHandler.createPeerServerListeners(peerServer);
let peers = [];
let groupCallRooms = [];
let mapPeers = new Map();
const broadcastEventTypes = {
  ACTIVE_USERS: "ACTIVE_USERS",
  GROUP_CALL_ROOMS: "GROUP_CALL_ROOMS",
  ROOM_MEMBERS: "ROOM_MEMBERS",
  USER_DISCONNECTED: "USER_DISCONNECTED",
};

const io = socket(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.on("connection", (socket) => {
  socket.emit("connection", null);
  console.log(`New user connected ${socket.id}`);

  //Register New User
  socket.on("register-new-user", (data) => {
    peers.push({
      username: data.username,
      socketId: data.socketId,
    });
    console.log("Registered New User");
    console.log(peers);

    io.sockets.emit("broadcast", {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers,
    });
  });

  //Join Room
  socket.on("join_room", (data) => {
    console.log(data);
    socket.join(data.room);
    //Push New GroupCallRoom in array if doesn't exist
    const newGroupCallRoom = {
      peerId: data.peerId,
      hostName: data.username,
      socketId: socket.id,
      roomId: data.room,
      streamId: data.streamId,
    };
    mapPeers.set(newGroupCallRoom.socketId, newGroupCallRoom);
    let checkGroupCallRoom = groupCallRooms.filter(
      (groupCallRoom) => groupCallRoom.roomId === newGroupCallRoom.roomId
    );
    if (checkGroupCallRoom.length === 0) {
      console.log(newGroupCallRoom);

      groupCallRooms.push(newGroupCallRoom);
    } else {
      console.log("Is This Working", groupCallRooms);
    }

    io.to(data.room).emit("new_member", {
      peerId: data.peerId,
      streamId: data.streamId,
    });

    console.log(`New User ${data.username} joined the room ${data.room}`);
  });

  //Send Message
  socket.on("send_message", (data) => {
    console.log("Send", data);
    io.to(data.room).emit("receive_message", data);
  });

  socket.on("group-call-user-left", (data) => {
    console.log(data);
    socket.leave(data.roomId);

    io.to(data.roomId).emit("group-call-user-left", {
      streamId: data.streamId,
    });
  });

  socket.on("disconnect", (reason) => {
    console.log(`Disconnected ${socket.id}`, reason);
    peers = peers.filter((peer) => peer.socketId !== socket.id);
    const removeUser = mapPeers.get(socket.id);
    mapPeers.delete(socket.id);

    //Broadcast New User List
    io.sockets.emit("broadcast", {
      event: broadcastEventTypes.ACTIVE_USERS,
      activeUsers: peers,
    });
    if (removeUser)
      io.sockets.emit("broadcast", {
        event: broadcastEventTypes.USER_DISCONNECTED,
        streamId: removeUser.streamId,
      });
  });
});
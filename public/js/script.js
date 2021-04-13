const socket = io("/", {
  transports: ["websocket"],
}); // Force WebSocket transport to assure in-order arrival of events.

let questions = {};
let colors = ["#D88559", "#D159D8", "#595BD9", "#5CD859", "#8022D9", "#2D3436", "#24A6D9", "#A7CBD9"];

/* ####### Peer setup ####### */

const screen_vid = document.getElementById("screen-video");
const prof_cam = document.getElementById("prof-cam");
const my_cam = document.getElementById("my-cam");
my_cam.muted = true;

/* ####### Peer setup ####### */

const myPeer = new Peer(undefined, {
  host: "/",
  port: "8080",
});

// Resolve Peer ID.
let userIdPromise = new Promise((resolve) => {
  myPeer.on("open", (id) => {
    resolve(id);
  });
});

/* ####### Data structures ####### */

// Represent presenter information:
// { name: "presenter name", id: "presenter-id", call: callObject }
let presenter = null;
// Represent screen sharing peer's information:
// { id: "peer-id", call: callObject }
let screenshare = null;
// Represent supervisor information:
// { id: "supervisor-id", time: Number, call: Call, conn: DataConnection }
let supervisor = null;

let pendingCalls = [];

// An empty (fake) media stream.
const emptyStream = new MediaStream([
  (function ({ width, height }) {
    const canvas = Object.assign(document.createElement("canvas"), {
      width,
      height,
    });
    canvas.getContext("2d").fillRect(0, 0, width, height);

    const stream = canvas.captureStream();
    const track = stream.getVideoTracks()[0];

    return Object.assign(track, { enabled: false });
  })({ width: 0, height: 0 }),
]);

/* ####### socket.io data ####### */

// Name of the participant.
let myName = prompt("Enter your name", "anonymous");
var det = document.getElementById("partlist");
var cont = document.createElement("text");
cont.textContent = myName;
det.appendChild(cont);
var newline = document.createElement("br");
det.appendChild(newline);

// Whether the participant is ready to make/accept calls.
let isReady = false;

// Error cases: room not found. redirect to room creation page.
socket.on("rejected", (msg) => {
  alert(msg);
  location.href = "../create";
});

// Get video & audio stream, set event listeners on socket.
Promise.all([
  // Get your video and audio streams.
  navigator.mediaDevices.getUserMedia({ video: true }),
  navigator.mediaDevices.getUserMedia({ audio: true }),
]).then(([videoStream, audioStream]) => {
  // Add your own video & audio stream.
  let myStream = new MediaStream([
    videoStream.getVideoTracks()[0],
    audioStream.getAudioTracks()[0],
  ]);
  addVideoStream(my_cam, myStream);

  // Add onclick event listener on the MUTE button.
  let button = document.getElementById("mute");
  button.onclick = (ev) => {
    let purpose = button.innerText;
    if (purpose === "MUTE") {
      audioStream.getAudioTracks()[0].enabled = false;
      button.innerText = "UNMUTE";
    } else {
      audioStream.getAudioTracks()[0].enabled = true;
      button.innerText = "MUTE";
    }
  };

  // When a new presenter joins the room.
  socket.on("presenter-joined", (presenterId, name) => {
    console.log(`Presenter joined: ${presenterId}`);

    // Construct new data structure for the presenter.
    presenter = {
      id: presenterId,
      name: name,
    };

    // Call the presenter with your audio stream.
    presenter.call = myPeer.call(presenterId, audioStream, {
      constraints: {
        mandatory: {
          OfferToReceiveAudio: true,
          OfferToReceiveVideo: true,
        },
        offerToReceiveAudio: 1,
        offerToReceiveVideo: 1,
      },
    });

    // Attach the presenter's webcam stream to the video element.
    presenter.call.on("stream", (presenterStream) => {
      addVideoStream(prof_cam, presenterStream);
    });

    presenter.call.on("close", () => {
      prof_cam.srcObject = new MediaStream();
    });
  });

  // When the presenter is disconnected.
  socket.on("presenter-leaved", () => {
    console.log(`Presenter leaved`);

    if (presenter) {
      presenter.call?.close();
      presenter = null;
    }
  });

  // When screen sharing starts.
  socket.on("screenshare-started", (screenId) => {
    console.log(`Screenshare started: ${screenId}`);

    screenshare = {
      id: screenId,
    };

    // Call the screen sharing peer with an empty stream.
    screenshare.call = myPeer.call(screenId, emptyStream);

    // Attach the shared screen to the video element.
    screenshare.call.on("stream", (screenStream) => {
      addVideoStream(screen_vid, screenStream);
    });

    screenshare.call.on("close", () => {
      screen_vid.srcObject = new MediaStream();
    });
  });

  // When screen sharing stopped.
  socket.on("screenshare-stopped", () => {
    console.log(`Screenshare stopped`);

    if (screenshare) {
      screenshare.call?.close();
      screenshare = null;
    }
  });

  // When the supervisor is re-assigned.
  socket.on("call-supervisor", (userId, time) => {
    console.log(`Call supervisor: ${userId}, ${Date(time)}`);

    // Close the call to previous supervisor.
    if (supervisor) {
      supervisor.call?.close();
      supervisor.conn?.close();
    }

    // Construct new data structure for the supervisor.
    supervisor = {
      id: userId,
      time: time,
    };

    // Call the supervisor with your video stream and given timestamp.
    supervisor.call = myPeer.call(userId, videoStream, {
      metadata: { time: time },
    });
    // Also establish a data connection.
    supervisor.conn = myPeer.connect(userId, {
      metadata: { time: time },
    });
  });

  // A call from the presenter or screen sharing peer.
  myPeer.on("call", (call) => {
    console.log(`Call from ${call.peer}: incoming`);

    // If you cannot identify the caller yet, keep the call pending.
    if (!isReady) {
      console.log(`Call from ${call.peer}: pending`);

      pendingCalls.push(call);
      return;
    }

    // Accept the call if you can identify the caller.
    acceptOrDeclineCall(call, audioStream);
  });

  // Finally notify the server that you want to join the room.
  userIdPromise.then((userId) => {
    socket.emit(
      "participant-connected",
      ROOM_ID,
      userId,
      myName,
      resolvePendingCalls
    );
  });

  // Callback sent to the server to receive the presenter's identity
  // and resolve the pending calls.
  function resolvePendingCalls(presenterInfo) {
    console.log(`Presenter information arrived from the server`);

    // Initialize presenter and screenshare data structures.
    if (presenterInfo !== null) {
      presenter = {
        id: presenterInfo.presenterId,
        name: presenterInfo.name,
      };

      if (presenterInfo.screenId !== null) {
        screenshare = {
          id: presenterInfo.screenId,
        };
      }
    }

    // Accept or reject each pending call.
    while (pendingCalls.length > 0) {
      let call = pendingCalls.shift();
      acceptOrDeclineCall(call, audioStream);
    }

    // Now you do not have to keep calls pending. You're ready.
    isReady = true;
  }
});

// Answer or reject a call with appropriate stream.
function acceptOrDeclineCall(call, audioStream) {
  if (call.peer === presenter?.id) {
    // Call from the presenter.
    console.log(`Call from ${call.peer}: accepted (presenter)`);

    call.answer(audioStream); // Audio stream.

    // Attach the presenter's stream to the video element.
    call.on("stream", (presenterStream) => {
      addVideoStream(prof_cam, presenterStream);
    });

    // Replace with an empty stream if call is closed.
    call.on("close", () => {
      prof_cam.srcObject = new MediaStream();
    });

    // Add the call to the presenter data structure.
    presenter.call = call;
  } else if (call.peer === screenshare?.id) {
    // Call from the screen sharing peer.
    console.log(`Call from ${call.peer}: accepted (screen sharing)`);

    call.answer(); // NO stream.

    // Attach the screen stream to the video element.
    call.on("stream", (screenStream) => {
      addVideoStream(screen_vid, screenStream);
    });

    // Replace with an empty stream if call is closed.
    call.on("close", () => {
      screen_vid.srcObject = new MediaStream();
    });

    // Add the call to the screensharer data structure.
    screenshare.call = call;
  } else {
    // Reject any other calls.
    console.log(`Call from ${call.peer}: rejected`);

    call.close();
  }
}

function addVideoStream(video, stream) {
  video.srcObject = stream;
  video.addEventListener("loadedmetadata", () => {
    video.play();
  });
}

// chat
const form = document.getElementById("form");
const input = document.getElementById("input");
const messages = document.getElementById("messages");

// If user click submit button, send input value to server socket.
form.addEventListener("submit", function (e) {
  console.log("eventlistener!");
  e.preventDefault();
  if (input.value) {
    socket.emit("message", ROOM_ID, "question", null, input.value, myName);
    console.log("listener: " + input.value);
    input.value = "";
  }
});

function showbig(id){
  document.getElementById("questions").style.display = "none";
  document.getElementById(id).style.display = "block";
}

function closenres(id){
  document.getElementById(id).style.display = "none";
  document.getElementById("questions").style.display = "block";
}
function sendnback(uuid){
  var answer = document.getElementById(uuid + "-ans").value;
  if(answer){
    socket.emit("message", ROOM_ID, "answer", uuid, answer, myName);
    input.value = "";
  }
  var id = uuid + "--detail";
  document.getElementById(id).style.display = "none";
  document.getElementById("questions").style.display = "block";
}

function doupdate(uuid){
  var det = document.getElementById(uuid + "-content");
  det.innerHTML = "";
  lis = questions[uuid];
  if(lis.length > 2){
    for(var i = 2; i < lis.length; i++){
      var cont = document.createElement("text");
      cont.textContent = lis[i][0] + ": " + lis[i][1];
      det.appendChild(cont);
      var newline = document.createElement("br");
      det.appendChild(newline);
    }
  }
}

function partilist(){
  var e = document.getElementById("partlist");
  if(e.style.display == "none"){
    e.style.display = "block";
  }
  else{
    e.style.display = "none";
  }
}

// Receive message1 from server.js and add given msg to all client
socket.on("question", function (uuid, msg, name) {
  console.log("question arrived");
  questions[uuid] = [];
  questions[uuid].push(msg, name);
  //entry information
  var fr = document.createElement("div");
  var title = document.createElement("text");
  var btn = document.createElement("button");
  fr.className = "fr";
  fr.id = uuid;
  fr.style.height = "20%";
  len = Object.keys(questions).length;
  fr.style.backgroundColor = colors[len%8];
  title.className = "tit";
  title.textContent = msg;
  fr.appendChild(title);
  btn.className = "btn";
  btn.textContent = "Detail";
  fr.appendChild(btn);

  document.getElementById("questions").appendChild(fr);
//detail information
  list = questions[uuid];
  var biginfo = document.createElement("div");
  biginfo.id = uuid + "--detail"
  biginfo.className = "biginfo";
  biginfo.style.backgroundColor = colors[len%8];
  document.getElementById("main").appendChild(biginfo);

  var btitle = document.createElement("text");
  btitle.textContent = list[0];
  btitle.className = "btitle";
  biginfo.appendChild(btitle);

  var cont = document.createElement("div");
  cont.id = uuid + "-content";
  biginfo.appendChild(cont);

  var inp = document.createElement("input");
  inp.id = uuid + "-ans";
  inp.className = "inp";
  inp.placeholder = "Answer";
  biginfo.appendChild(inp);
  var sub = document.createElement("button");
  sub.id = uuid + "-sub";
  sub.className = "sub";
  sub.textContent = "Submit";
  sub.onclick = function(){
    sendnback(uuid);
  }
  var clobtn = document.createElement("button");
  clobtn.textContent = "Close";
  clobtn.className = "clobtn";
  clobtn.onclick = function(){
    closenres(biginfo.id);
  }
  biginfo.appendChild(sub);
  biginfo.appendChild(clobtn);
  biginfo.style.display = "none";

  btn.onclick = function(){
    showbig(biginfo.id);
  }
});

socket.on("answer", function (uuid, msg, name) {
  console.log("answer arrived");
  var queslist = questions[uuid];
  queslist.push([name, msg])
  console.log(questions);
  doupdate(uuid);
});

// webgazer
// store calibration
function add_concentrate_log(t, level) {
  userIdPromise.then((userId) => {
    send_data([userId, t, level]);
  });
}

// Send concentration data to the supervisor and the server.
// data: [userId, timestamp, concentrate_level]
function send_data(data) {
  // Send data to supervisor.
  if (supervisor?.conn) {
    supervisor.conn.send(data);
  }

  console.log(data);

  // Send data to server
  socket.emit("concent_data", ROOM_ID, data);
}

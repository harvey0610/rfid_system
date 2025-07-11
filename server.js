const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const XLSX = require("xlsx");
const { sendEmails } = require("./sendEmails");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

const credentials = {
  username: "admin",
  password: "password123",
};

const registeredStudentsPath = path.join(__dirname, "students.json");
let students = fs.existsSync(registeredStudentsPath)
  ? JSON.parse(fs.readFileSync(registeredStudentsPath, "utf8"))
  : {};

const emailQueuePath = path.join(__dirname, "emailQueue.json");
let attendanceList = [];
let lastSeen = {};

function queueEmail(log) {
  let queue = fs.existsSync(emailQueuePath)
    ? JSON.parse(fs.readFileSync(emailQueuePath, "utf8"))
    : [];

  const email = students[log.id]?.email || "default@example.com";
  queue.push({ ...log, email });
  fs.writeFileSync(emailQueuePath, JSON.stringify(queue, null, 2));
}

function getStudentName(tag) {
  return students[tag]?.name || `Unknown (${tag})`;
}

// ROUTES

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.post("/register-student", (req, res) => {
  const { tag, name, email } = req.body;
  if (!tag || !name || !email) {
    return res.status(400).json({ message: "Missing fields" });
  }
  students[tag] = { name, email };
  fs.writeFileSync(registeredStudentsPath, JSON.stringify(students, null, 2));
  res.json({ message: "Student registered successfully" });
});

app.post("/send-emails", (req, res) => {
  try {
    sendEmails();
    res.json({ message: "Email alerts sent!" });
  } catch (err) {
    res.status(500).json({ message: "Failed to send emails" });
  }
});

// ✅ This is for your serial-relay.js to send tag data to the cloud server
app.post("/receive-tag", (req, res) => {
  const { tag } = req.body;
  if (!tag || !/^[0-9A-F]{8,}$/.test(tag.toUpperCase())) {
    return res.status(400).json({ message: "Invalid tag format" });
  }

  const now = Date.now();
  const time = new Date();
  const readableTime = time.toLocaleTimeString();
  const readableDate = time.toLocaleDateString();
  const name = getStudentName(tag);

  const previous = lastSeen[tag];
  let status = "IN";

  if (previous?.status === "IN" && now - previous.timestamp > 5000) {
    status = "OUT";
  } else if (previous?.status === "OUT") {
    status = "IN";
  }

  lastSeen[tag] = { timestamp: now, status };

  const log = {
    id: tag,
    name,
    time: readableTime,
    date: readableDate,
    status,
  };

  attendanceList.push(log);
  queueEmail(log);
  io.emit("rfid_tag", log);

  try {
    sendEmails();
  } catch (err) {
    console.error("❌ sendEmails error:", err.message);
  }

  res.json({ message: "Tag processed", log });
});

// SOCKET.IO HANDLERS

io.on("connection", (socket) => {
  socket.on("login", (data) => {
    if (data.username === credentials.username && data.password === credentials.password) {
      socket.emit("login_success");
    } else {
      socket.emit("login_failed");
    }
  });

  socket.on("attendance_list_request", () => {
    socket.emit("attendance_list", attendanceList);
  });

  socket.on("export_excel", () => {
    const worksheet = XLSX.utils.json_to_sheet(attendanceList);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance");
    const exportPath = path.join(__dirname, "public", "attendance.xlsx");
    XLSX.writeFile(workbook, exportPath);
    socket.emit("export_ready", "/attendance.xlsx");
  });

  socket.on("update_log", (index, newName) => {
    if (attendanceList[index]) {
      attendanceList[index].name = newName;
      socket.emit("attendance_list", attendanceList);
    }
  });

  socket.on("delete_log", (index) => {
    if (attendanceList[index]) {
      attendanceList.splice(index, 1);
      socket.emit("attendance_list", attendanceList);
    }
  });

  socket.emit("attendance_list", attendanceList);
});

// SERVER START
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

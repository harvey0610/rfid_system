const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const { sendEmails } = require("./sendEmails");
const cors = require("cors");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Credentials
const credentials = {
  username: "admin",
  password: "password123",
};

// Load students
const registeredStudentsPath = path.join(__dirname, "students.json");
let students = {};
if (fs.existsSync(registeredStudentsPath)) {
  students = JSON.parse(fs.readFileSync(registeredStudentsPath, "utf8"));
}

let attendanceList = [];
let lastSeen = {};

const emailQueuePath = path.join(__dirname, "emailQueue.json");

// Queue email
function queueEmail(log) {
  let queue = [];
  if (fs.existsSync(emailQueuePath)) {
    try {
      queue = JSON.parse(fs.readFileSync(emailQueuePath, "utf8"));
    } catch (err) {
      console.error("Error reading email queue:", err.message);
    }
  }
  const email = students[log.id]?.email || "default@example.com";
  queue.push({
    name: log.name,
    status: log.status,
    date: log.date,
    time: log.time,
    email,
  });
  fs.writeFileSync(emailQueuePath, JSON.stringify(queue, null, 2));
}

function getStudentName(tag) {
  return students[tag]?.name || `Unknown (${tag})`;
}

// ----------------------
// ✅ Arduino POST Route
// ----------------------
app.post("/api/arduino-tag", (req, res) => {
  const { tag } = req.body;

  if (!tag || !/^[0-9A-F]{8,}$/.test(tag)) {
    return res.status(400).json({ message: "Invalid or missing tag" });
  }

  const now = Date.now();
  const time = new Date();
  const readableTime = time.toLocaleTimeString();
  const readableDate = time.toLocaleDateString();
  const name = getStudentName(tag);

  const previous = lastSeen[tag];
  let status;
  if (!previous || previous.status === "OUT") {
    status = "IN";
  } else if (previous.status === "IN" && now - previous.timestamp > 5000) {
    status = "OUT";
  } else {
    return res.status(200).json({ message: "Ignored duplicate tag" });
  }

  lastSeen[tag] = { timestamp: now, status };
  const log = { id: tag, name, time: readableTime, date: readableDate, status };
  attendanceList.push(log);
  queueEmail(log);
  io.emit("rfid_tag", log);

  try {
    sendEmails();
  } catch (error) {
    console.error("sendEmails error:", error.message);
  }

  res.status(200).json({ message: "Tag logged successfully" });
});

// ----------------------
// Frontend routes
// ----------------------
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// ----------------------
// Register new student
// ----------------------
app.post("/register-student", (req, res) => {
  const { tag, name, email } = req.body;
  if (!tag || !name || !email) {
    return res.status(400).json({ message: "Missing fields" });
  }
  students[tag] = { name, email };
  fs.writeFileSync(registeredStudentsPath, JSON.stringify(students, null, 2));
  res.json({ message: "Student registered successfully" });
});

// ----------------------
// Send all queued emails
// ----------------------
app.post("/send-emails", (req, res) => {
  try {
    sendEmails();
    res.json({ message: "Emails sent!" });
  } catch (err) {
    console.error("Send email error:", err.message);
    res.status(500).json({ message: "Failed to send emails" });
  }
});

// ----------------------
// Socket.IO Operations
// ----------------------
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

// ----------------------
// Global error handler
// ----------------------
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
});

// ----------------------
// Start the server
// ----------------------
server.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});

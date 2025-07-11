// server.js
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

const SERIAL_PORT_PATH = "COM4";
const BAUD_RATE = 9600;

let attendanceList = [];
let lastSeen = {};

const credentials = {
  username: "admin",
  password: "password123",
};

// Serve static files from /public
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// Serve HTML pages
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});
app.get("/dashboard", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

// Load student data
const registeredStudentsPath = path.join(__dirname, "students.json");
let students = {};
if (fs.existsSync(registeredStudentsPath)) {
  students = JSON.parse(fs.readFileSync(registeredStudentsPath, "utf8"));
}

// Register student
app.post("/register-student", (req, res) => {
  const { tag, name, email } = req.body;
  if (!tag || !name || !email) {
    return res.status(400).json({ message: "Missing fields" });
  }
  students[tag] = { name, email };
  fs.writeFileSync(registeredStudentsPath, JSON.stringify(students, null, 2));
  res.json({ message: "Student registered successfully" });
});

// Email queue
const emailQueuePath = path.join(__dirname, "emailQueue.json");
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

// Utility
function getStudentName(tag) {
  return students[tag]?.name || `Unknown (${tag})`;
}

// ✅ Only use SerialPort when not on Render (based on env or default)
if (process.env.USE_SERIAL !== "false") {
  const { SerialPort, ReadlineParser } = require("serialport");

  try {
    const port = new SerialPort({ path: SERIAL_PORT_PATH, baudRate: BAUD_RATE });
    const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

    parser.on("data", (data) => {
      const tag = data.toString().trim().toUpperCase();
      if (!/^[0-9A-F]{8,}$/.test(tag)) {
        console.warn("⚠️ Invalid tag format:", tag);
        return;
      }

      console.log("✅ UID received:", tag);
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
        return;
      }

      lastSeen[tag] = { timestamp: now, status };
      const log = { id: tag, name, time: readableTime, date: readableDate, status };
      attendanceList.push(log);
      queueEmail(log);
      io.emit("rfid_tag", log);

      try {
        sendEmails();
      } catch (error) {
        console.error("❌ sendEmails error:", error.message);
      }
    });

    console.log(`✅ Connected to Arduino on ${SERIAL_PORT_PATH}`);
  } catch (err) {
    console.error(`❌ Failed to open serial port: ${err.message}`);
  }
} else {
  console.log("⚠️ Skipping SerialPort on Render (USE_SERIAL=false)");
}

// Socket.IO logic
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

// Send emails API
app.post("/send-emails", (req, res) => {
  try {
    sendEmails();
    res.json({ message: "Email alerts sent successfully." });
  } catch (error) {
    console.error("Email error:", error.message);
    res.status(500).json({ message: "Failed to send emails." });
  }
});

// Error handler
process.on("uncaughtException", (error) => {
  console.error("💥 Uncaught Exception:", error);
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

require("dotenv").config(); // Load environment variables
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const emailQueuePath = path.join(__dirname, "emailQueue.json");

// Create transporter using Gmail and environment credentials
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,    // Your Gmail (e.g., yourname@gmail.com)
    pass: process.env.EMAIL_PASS,    // Your Gmail App Password
  },
});

function sendEmails() {
  if (!fs.existsSync(emailQueuePath)) {
    console.log("ℹ️ No email queue file found.");
    return;
  }

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(emailQueuePath, "utf8"));
  } catch (err) {
    console.error("❌ Failed to parse email queue:", err.message);
    return;
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    console.log("ℹ️ Email queue is empty.");
    return;
  }

  queue.forEach((log) => {
    const mailOptions = {
      from: `"RFID Attendance System" <${process.env.EMAIL_USER}>`,
      to: log.email,
      subject: `Attendance Alert: ${log.name}`,
      text: `${log.name} was marked as ${log.status} at ${log.time} on ${log.date}.`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`❌ Email error for ${log.email}:`, error.message);
      } else {
        console.log(`✅ Email sent to ${log.email}:`, info.response);
      }
    });
  });

  // Clear the queue after sending
  fs.writeFileSync(emailQueuePath, JSON.stringify([], null, 2));
}

module.exports = { sendEmails };

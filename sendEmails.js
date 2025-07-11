require("dotenv").config();
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const emailQueuePath = path.join(__dirname, "emailQueue.json");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD,
  },
});

function sendEmails() {
  if (!fs.existsSync(emailQueuePath)) {
    console.log("ℹ️ No email queue found.");
    return { status: "empty" };
  }

  let queue;
  try {
    queue = JSON.parse(fs.readFileSync(emailQueuePath, "utf8"));
  } catch (error) {
    console.error("❌ Failed to parse email queue:", error);
    return { status: "error", message: "Failed to parse email queue" };
  }

  if (!Array.isArray(queue) || queue.length === 0) {
    console.log("ℹ️ Email queue is empty.");
    return { status: "empty" };
  }

  let successCount = 0;
  let failCount = 0;

  queue.forEach((entry) => {
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: entry.email,
      subject: `Attendance Alert: ${entry.name}`,
      text: `${entry.name} marked as ${entry.status} at ${entry.time} on ${entry.date}.`,
    };

    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error(`❌ Email error for ${entry.email}: ${error.message}`);
        failCount++;
      } else {
        console.log(`✅ Email sent to ${entry.email}`);
        successCount++;
      }
    });
  });

  // Clear queue after sending
  fs.writeFileSync(emailQueuePath, JSON.stringify([], null, 2));

  return {
    status: "done",
    message: `Emails sent: ${successCount}, Failed: ${failCount}`,
  };
}

module.exports = {
  sendEmails,
};

const nodemailer = require('nodemailer');

const sendEmail = async (to, subject, text) => {
  // Check if we have email config
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log("========================================");
    console.log("⚠️  EMAIL SERVICE (MOCK MODE)");
    console.log(`To: ${to}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body: ${text}`);
    console.log("========================================");
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'Gmail', // Can be configured via env
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to,
    subject,
    text,
  };

  await transporter.sendMail(mailOptions);
};

module.exports = sendEmail;

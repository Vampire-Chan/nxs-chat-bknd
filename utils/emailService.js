const nodemailer = require('nodemailer');

/**
 * PRODUCTION-READY EMAIL SERVICE
 * Env requirements: 
 * - EMAIL_USER: Email address to send from.
 * - EMAIL_PASS: App-specific password or OAuth2 token.
 * - EMAIL_HOST: SMTP Server (default: Gmail).
 * - EMAIL_PORT: SMTP Port (default: 587).
 */
const sendEmail = async (to, subject, text) => {
  const isDev = process.env.NODE_ENV !== 'production';

  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    if (isDev) {
      console.log("🛠️ [DEV MODE] Email signal trapped:");
      console.log(`   To: ${to}`);
      console.log(`   Subject: ${subject}`);
      console.log(`   Body: ${text}`);
      return;
    }
    // In production, we should handle this as an error.
    throw new Error("Email credentials missing. Protocol failed.");
  }

  const transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT || '587'),
    secure: process.env.EMAIL_PORT === '465',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  const mailOptions = {
    from: `"Yantravani Nexus" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text,
  };

  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("❌ Email transmission failed:", err);
    throw err;
  }
};

module.exports = sendEmail;

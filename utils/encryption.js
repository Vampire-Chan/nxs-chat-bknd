const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('❌ [FATAL] ENCRYPTION_KEY is missing or invalid. Application cannot start securely.');
  // In production, we should exit. In development/build, we might need a fallback, 
  // but for safety, we'll enforce it.
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
}

const key = ENCRYPTION_KEY ? Buffer.from(ENCRYPTION_KEY, 'hex') : crypto.randomBytes(32);

function encrypt(text) {
  if (text === null || typeof text === 'undefined') return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text.toString(), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (text === null || typeof text === 'undefined') return null;
  try {
    const parts = text.split(':');
    if (parts.length !== 2) {
      // If it's not in the expected format, we return null to ensure 
      // unencrypted data isn't accidentally treated as valid decrypted data.
      return null;
    }
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error("Decryption failure. Data may be corrupt or key is invalid.");
    return null; 
  }
}

module.exports = { encrypt, decrypt };

const crypto = require('crypto');

const ALGORITHM = 'aes-256-cbc';
const IV_LENGTH = 16;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  throw new Error('Invalid ENCRYPTION_KEY. Must be a 64-character hex string (32 bytes).');
}

const key = Buffer.from(ENCRYPTION_KEY, 'hex');

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
      // Could be an old, unencrypted value. Return as is.
      // Or handle error appropriately. For now, we return it.
      return text;
    }
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = parts.join(':');
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // If decryption fails, it might be an unencrypted value.
    // Log the error and return the original text.
    console.error("Decryption failed for a value, returning original. This might be expected during migration.", error);
    return text;
  }
}

module.exports = { encrypt, decrypt };

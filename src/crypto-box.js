// AES-256-GCM protection for sensitive personal data at rest.
//
// Scope note: passwords are NOT handled here. They stay one-way salted scrypt
// hashes, because a password must never be recoverable. Encryption is for data
// the system has to read back later, such as a school ID number.
//
// Stored format: "v1.<iv>.<authTag>.<ciphertext>", each part base64url. The
// GCM auth tag means tampering with a stored value is detected on decrypt.
const crypto = require('node:crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const PREFIX = 'v1';

function parseKey(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return null;
  }
  // Accept base64/base64url or hex, as long as it decodes to 32 bytes.
  const candidates = [];
  if (/^[0-9a-fA-F]+$/.test(text) && text.length === KEY_BYTES * 2) {
    candidates.push(Buffer.from(text, 'hex'));
  }
  candidates.push(Buffer.from(text, 'base64'));
  const key = candidates.find((buffer) => buffer.length === KEY_BYTES);
  return key || null;
}

// A separate key for the blind index, derived from the master key, so the
// lookup hash cannot be used to attack the encryption key (or the reverse).
function deriveIndexKey(key) {
  return crypto.hkdfSync('sha256', key, Buffer.alloc(0), Buffer.from('roomq-blind-index'), 32);
}

function createCipherBox(rawKey = process.env.ROOMQ_ENCRYPTION_KEY) {
  const key = parseKey(rawKey);
  if (!key) {
    throw new Error(
      'Set ROOMQ_ENCRYPTION_KEY to a 32-byte key (base64 or hex) before starting RoomQ. ' +
      'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  const indexKey = deriveIndexKey(key);

  return {
    encrypt(plaintext) {
      if (plaintext === null || plaintext === undefined || plaintext === '') {
        return null;
      }
      const iv = crypto.randomBytes(IV_BYTES);
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
      const ciphertext = Buffer.concat([
        cipher.update(String(plaintext), 'utf8'),
        cipher.final()
      ]);
      return [
        PREFIX,
        iv.toString('base64url'),
        cipher.getAuthTag().toString('base64url'),
        ciphertext.toString('base64url')
      ].join('.');
    },

    decrypt(payload) {
      if (!payload) {
        return null;
      }
      const [version, iv, tag, ciphertext] = String(payload).split('.');
      if (version !== PREFIX || !iv || !tag || !ciphertext) {
        throw new Error('Stored value is not in the expected encrypted format.');
      }
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([
        decipher.update(Buffer.from(ciphertext, 'base64url')),
        decipher.final()
      ]).toString('utf8');
    },

    // Deterministic keyed hash, so an encrypted value can still be looked up
    // and kept unique without storing or scanning the plaintext.
    blindIndex(value) {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      return crypto.createHmac('sha256', indexKey)
        .update(String(value).trim().toLowerCase())
        .digest('hex');
    }
  };
}

module.exports = { createCipherBox, parseKey };

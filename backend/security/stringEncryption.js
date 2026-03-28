/**
 * String Encryption Utility
 * Mã hóa các string nhạy cảm (API URLs, secrets, error messages)
 * để tránh reverse engineering
 */
import crypto from 'node:crypto';
// Key derivation từ một constant (có thể thay đổi)
var STRING_ENCRYPTION_KEY = crypto
    .createHash('sha256')
    .update('93MediaToolMixNhac2025StringEncryptionKey!@#')
    .digest();
var IV_LENGTH = 16;
/**
 * Encrypt một string
 */
export function encryptString(plaintext) {
    var iv = crypto.randomBytes(IV_LENGTH);
    var cipher = crypto.createCipheriv('aes-256-cbc', STRING_ENCRYPTION_KEY, iv);
    var encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return iv.toString('base64') + ':' + encrypted.toString('base64');
}
/**
 * Decrypt một string
 */
export function decryptString(encrypted) {
    var parts = encrypted.split(':');
    if (parts.length !== 2) {
        throw new Error('Invalid encrypted string format');
    }
    var iv = Buffer.from(parts[0], 'base64');
    var encryptedData = Buffer.from(parts[1], 'base64');
    var decipher = crypto.createDecipheriv('aes-256-cbc', STRING_ENCRYPTION_KEY, iv);
    return decipher.update(encryptedData, undefined, 'utf8') + decipher.final('utf8');
}
/**
 * Pre-encrypted strings (được encrypt tại build time)
 * Format: { key: encrypted_value }
 */
var ENCRYPTED_STRINGS = {
    // API URLs
    AUTH_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
    LICENSE_BASE: encryptString('https://license-server.dungdong333.workers.dev'),
    // Secrets (sẽ được encrypt trong production)
    INSTALLER_SECRET: encryptString('2025LEONYG280722'),
    INSTALLER_KEY: encryptString('Ins$2025!LEONYG'),
};
/**
 * Get decrypted string by key
 */
export function getDecryptedString(key) {
    var encrypted = ENCRYPTED_STRINGS[key];
    if (!encrypted) {
        throw new Error("Encrypted string not found: ".concat(key));
    }
    return decryptString(encrypted);
}
/**
 * Runtime encryption (cho các string động)
 */
var StringEncryptor = /** @class */ (function () {
    function StringEncryptor() {
    }
    StringEncryptor.encrypt = function (plaintext) {
        if (this.cache.has(plaintext)) {
            return this.cache.get(plaintext);
        }
        var encrypted = encryptString(plaintext);
        this.cache.set(plaintext, encrypted);
        return encrypted;
    };
    StringEncryptor.decrypt = function (encrypted) {
        return decryptString(encrypted);
    };
    StringEncryptor.cache = new Map();
    return StringEncryptor;
}());
export { StringEncryptor };

/**
 * String Encryption Utility
 * Mã hóa các string nhạy cảm (API URLs, secrets, error messages)
 * để tránh reverse engineering
 */
/**
 * Encrypt một string
 */
export declare function encryptString(plaintext: string): string;
/**
 * Decrypt một string
 */
export declare function decryptString(encrypted: string): string;
/**
 * Pre-encrypted strings (được encrypt tại build time)
 * Format: { key: encrypted_value }
 */
declare const ENCRYPTED_STRINGS: Record<string, string>;
/**
 * Get decrypted string by key
 */
export declare function getDecryptedString(key: keyof typeof ENCRYPTED_STRINGS): string;
/**
 * Runtime encryption (cho các string động)
 */
export declare class StringEncryptor {
    private static cache;
    static encrypt(plaintext: string): string;
    static decrypt(encrypted: string): string;
}
export {};

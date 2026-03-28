/**
 * Encrypted Auth Store - Mã hóa auth state để bảo mật
 * Sử dụng AES-256-GCM với key derivation từ machineId
 * Kèm HMAC-SHA256 để integrity check
 */
import type { StoredAuthState } from './authStore';
/**
 * Đọc encrypted auth state từ file
 */
export declare function readEncryptedAuthState(): Promise<StoredAuthState | null>;
/**
 * Ghi encrypted auth state vào file
 */
export declare function writeEncryptedAuthState(state: StoredAuthState): Promise<void>;
/**
 * Xóa encrypted auth state file
 */
export declare function clearEncryptedAuthState(): void;
/**
 * Migrate từ old plaintext format sang encrypted format
 * (Chỉ chạy một lần khi upgrade)
 */
export declare function migrateFromPlaintext(): Promise<boolean>;

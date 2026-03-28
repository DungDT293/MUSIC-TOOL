/**
 * License Check Helper
 * Kiểm tra license trước khi thực hiện actions quan trọng
 */
import { type LicenseState } from '../license/onlineLicenseService';
/**
 * Check license và throw error nếu không hợp lệ
 */
export declare function requireValidLicense(): Promise<void>;
/**
 * Check license và return boolean (không throw)
 */
export declare function hasValidLicense(): Promise<boolean>;
/**
 * Get current license state
 */
export declare function getLicenseState(): Promise<LicenseState>;

/**
 * Tamper Detection
 * Phát hiện khi code/executable bị sửa đổi
 */
/**
 * Calculate file hash (SHA-256)
 */
export declare function calculateFileHash(filePath: string): Promise<string>;
/**
 * Verify executable integrity
 */
export declare function verifyExecutableIntegrity(): Promise<boolean>;
/**
 * Verify main.js integrity (Electron main process)
 */
export declare function verifyMainJsIntegrity(): Promise<boolean>;
/**
 * Detect function hooking (basic check)
 * Chỉ chạy trong renderer process
 */
export declare function detectFunctionHooking(): boolean;
/**
 * Self-checksum verification (verify chính nó)
 */
export declare function verifySelfChecksum(): Promise<boolean>;
/**
 * Main tamper detection check
 */
export declare function checkTampering(): Promise<{
    isTampered: boolean;
    reasons: string[];
}>;
/**
 * Initialize tamper detection
 */
export declare function initTamperDetection(): void;

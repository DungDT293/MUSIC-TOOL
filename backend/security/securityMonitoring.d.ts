/**
 * Security Monitoring & Alerting
 * Phát hiện và báo cáo các hoạt động đáng ngờ (crack attempts)
 */
export type SecurityEventType = 'SIGNATURE_INVALID' | 'SIGNATURE_REPLAY' | 'NONCE_REUSED' | 'TIMESTAMP_INVALID' | 'LICENSE_CHECK_FAILED' | 'TAMPERING_DETECTED' | 'ANTI_DEBUG_TRIGGERED' | 'MACHINE_ID_MISMATCH' | 'ENCRYPTION_DECRYPT_FAILED' | 'FILE_INTEGRITY_FAILED' | 'MULTIPLE_MACHINE_IDS' | 'RATE_LIMIT_EXCEEDED' | 'UNSAFE_ENVIRONMENT';
export interface SecurityEvent {
    type: SecurityEventType;
    severity: 'low' | 'medium' | 'high' | 'critical';
    message: string;
    details?: Record<string, any>;
    timestamp: number;
    machineId: string;
    username?: string;
}
/**
 * Report security event lên server
 */
export declare function reportSecurityEvent(event: SecurityEvent): Promise<void>;
/**
 * Report signature invalid
 */
export declare function reportSignatureInvalid(details: {
    path: string;
    method: string;
    expectedSignature?: string;
    receivedSignature?: string;
}): Promise<void>;
/**
 * Report signature replay (timestamp quá cũ hoặc nonce reused)
 */
export declare function reportSignatureReplay(details: {
    path: string;
    method: string;
    timestamp: number;
    age: number;
}): Promise<void>;
/**
 * Report nonce reused
 */
export declare function reportNonceReused(details: {
    path: string;
    method: string;
    nonce: string;
}): Promise<void>;
/**
 * Report license check failed nhiều lần
 */
export declare function reportLicenseCheckFailed(details: {
    reason: string;
    status: string;
    attemptCount?: number;
}): Promise<void>;
/**
 * Report tampering detected
 */
export declare function reportTamperingDetected(details: {
    reasons: string[];
    file?: string;
}): Promise<void>;
/**
 * Report anti-debugging triggered
 */
export declare function reportAntiDebugTriggered(details: {
    method: string;
    detected: boolean;
}): Promise<void>;
/**
 * Report machine ID mismatch
 */
export declare function reportMachineIdMismatch(details: {
    storedMachineId: string;
    currentMachineId: string;
    context: string;
}): Promise<void>;
/**
 * Report encryption/decryption failed
 */
export declare function reportEncryptionFailed(details: {
    operation: 'encrypt' | 'decrypt';
    error: string;
}): Promise<void>;
/**
 * Report file integrity check failed
 */
export declare function reportFileIntegrityFailed(details: {
    file: string;
    expectedHash?: string;
    actualHash?: string;
}): Promise<void>;
/**
 * Report multiple machine IDs cho cùng account
 */
export declare function reportMultipleMachineIds(details: {
    username: string;
    machineIds: string[];
    count: number;
}): Promise<void>;
/**
 * Report rate limit exceeded
 */
export declare function reportRateLimitExceeded(details: {
    endpoint: string;
    count: number;
    window: number;
}): Promise<void>;
/**
 * Initialize security monitoring
 */
export declare function initSecurityMonitoring(): void;

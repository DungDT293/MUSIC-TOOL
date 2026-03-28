/**
 * Environment Detection
 * Phát hiện VM, sandbox, và môi trường không an toàn
 */
interface EnvironmentCheckResult {
    safe: boolean;
    reason?: string;
    detected?: string[];
}
/**
 * Detect Virtual Machine
 */
export declare function detectVM(): Promise<{
    detected: boolean;
    type?: string;
}>;
/**
 * Detect Sandbox Environment
 */
export declare function detectSandbox(): Promise<{
    detected: boolean;
    type?: string;
}>;
/**
 * Check if environment is safe
 */
export declare function isSafeEnvironment(): Promise<EnvironmentCheckResult>;
export {};

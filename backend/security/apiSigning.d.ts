/**
 * API Request Signing
 * Mỗi request kèm theo timestamp, nonce, và HMAC signature để chống replay attack và tampering
 */
/**
 * Sign request
 * Returns: { timestamp, nonce, signature }
 */
export declare function signRequest(method: string, path: string, body: any): Promise<{
    timestamp: number;
    nonce: string;
    signature: string;
}>;
/**
 * Verify request signature
 * (Dùng cho server-side, nhưng có thể test client-side)
 */
export declare function verifyRequest(method: string, path: string, body: string, timestamp: number, nonce: string, signature: string): Promise<boolean>;
/**
 * Create signed headers cho request
 */
export declare function createSignedHeaders(method: string, path: string, body: any): Promise<Record<string, string>>;

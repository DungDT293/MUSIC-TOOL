import type { SessionInfo } from './sessionManager';
export interface StoredAuthState {
    status: 'unregistered' | 'pending' | 'allowed' | 'blocked' | 'error';
    username?: string;
    password?: string;
    machineId: string;
    activationKey?: string;
    message?: string;
    latestVersion?: string;
    downloadUrl?: string;
    remember?: boolean;
    sessionInfo?: SessionInfo;
}
export declare function readStoredAuthState(): StoredAuthState | null;
export declare function writeStoredAuthState(state: StoredAuthState): void;
export declare function clearStoredAuthState(): void;

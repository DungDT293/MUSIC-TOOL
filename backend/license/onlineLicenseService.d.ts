export type LicenseStatus = 'checking' | 'needsRegistration' | 'pending' | 'ok' | 'offline' | 'denied';
export interface LicenseState {
    status: LicenseStatus;
    machineHash: string;
    message?: string;
    lastSuccessAt?: number;
    ticket?: string;
    requestId?: string;
    note?: string;
}
export declare function submitLicenseRequest(note?: string): Promise<{
    success: boolean;
    state: LicenseState;
    error?: string;
}>;
export declare function clearLicense(): Promise<void>;
export declare function evaluateLicenseState(forceRemote?: boolean): Promise<LicenseState>;

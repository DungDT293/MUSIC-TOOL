export interface LicensePayload {
    licenseId: string;
    allowedVersion: string;
    machineHash: string;
    issuedAt: string;
    expiresAt?: string;
    notes?: string;
}
export interface SignedLicenseFile {
    payload: string;
    signature: string;
}

export interface LicensePayload {
  licenseId: string
  allowedVersion: string
  machineHash: string
  issuedAt: string
  expiresAt?: string
  notes?: string
}

export interface SignedLicenseFile {
  payload: string // base64url-encoded JSON payload
  signature: string // base64 signature (Ed25519)
}




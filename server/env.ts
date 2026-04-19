/// <reference path="./types.d.ts" />

/**
 * Shared environment interface and constants for Cloudflare Workers
 */

export interface Env {
  // Database
  DB?: D1Database

  // Secrets
  INSTALLER_SECRET?: string
  ADMIN_TOKEN?: string
  JWT_SECRET?: string // V2: JWT signing secret

  // Email service (optional)
  SENDGRID_API_KEY?: string
  ALERT_EMAIL?: string

  // Webhook URL (optional)
  WEBHOOK_URL?: string
}

export const DEFAULT_POLICY_VERSION = '4.1.0'
export const DEFAULT_VERSION_POLICY = {
  latest_version: DEFAULT_POLICY_VERSION,
  min_supported_version: DEFAULT_POLICY_VERSION,
  blocked_versions: [],
  recommended_version: DEFAULT_POLICY_VERSION,
  recommended_installer_url: '',
  force_update: false,
  message: '',
  channel: 'stable',
} as const

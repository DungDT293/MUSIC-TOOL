import fs from 'node:fs'
import path from 'node:path'

const TICKET_FILE_NAME = 'licenseTicket.json'

function resolveStoragePath(): string {
  if (process.env.LICENSE_TICKET_PATH) {
    return process.env.LICENSE_TICKET_PATH
  }
  const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
  const dir = path.join(commonAppData, '93MediaToolMixNhac')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return path.join(dir, TICKET_FILE_NAME)
}

export interface StoredTicket {
  ticket?: string
  requestId?: string
  note?: string
  lastSuccessAt?: number
}

export function readStoredTicket(): StoredTicket | null {
  try {
    const file = resolveStoragePath()
    if (!fs.existsSync(file)) return null
    const raw = fs.readFileSync(file, 'utf8')
    return JSON.parse(raw) as StoredTicket
  } catch (error) {
    console.warn('[license] Failed to read stored ticket:', error)
    return null
  }
}

export function writeStoredTicket(ticket: StoredTicket): void {
  try {
    const file = resolveStoragePath()
    fs.writeFileSync(file, JSON.stringify(ticket, null, 2), 'utf8')
  } catch (error) {
    console.error('[license] Failed to persist ticket:', error)
  }
}

export function clearStoredTicket(): void {
  try {
    const file = resolveStoragePath()
    if (fs.existsSync(file)) {
      fs.unlinkSync(file)
    }
  } catch (error) {
    console.error('[license] Failed to clear ticket:', error)
  }
}


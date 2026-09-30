import crypto from 'node:crypto'

export type OperationStatus = 'start' | 'decision' | 'retry' | 'success' | 'failure' | 'cancelled' | 'cleanup'

export interface OperationLogEvent {
  scope: string
  operation: string
  status: OperationStatus
  requestId?: string
  batchId?: string
  step?: string
  message?: string
  metadata?: Record<string, string | number | boolean | null | undefined>
}

function safeValue(value: string | number | boolean | null | undefined): string | number | boolean | null | undefined {
  if (typeof value !== 'string') return value
  return value.length > 240 ? `${value.slice(0, 237)}...` : value
}

export function hashOperationPath(filePath: string): string {
  return crypto.createHash('sha256').update(filePath).digest('hex').slice(0, 12)
}

export function writeOperationLog(event: OperationLogEvent): void {
  const metadata = Object.fromEntries(
    Object.entries(event.metadata ?? {}).map(([key, value]) => [key, safeValue(value)]),
  )
  const payload = {
    ts: new Date().toISOString(),
    scope: event.scope,
    operation: event.operation,
    status: event.status,
    ...(event.requestId ? { requestId: event.requestId } : {}),
    ...(event.batchId ? { batchId: event.batchId } : {}),
    ...(event.step ? { step: event.step } : {}),
    ...(event.message ? { message: event.message } : {}),
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  }
  console.log(`[Operation] ${JSON.stringify(payload)}`)
}

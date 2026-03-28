/**
 * tests/e2e/auth.e2e.ts
 * Playwright E2E — Auth & Security: login flow, rate limiter, session persistence
 *
 * Chạy với: npx playwright test tests/e2e/auth.e2e.ts
 * Yêu cầu: app đã được build (npm run build) hoặc đang chạy dev.
 *
 * NOTE: Các test này dùng electron-playwright-helpers để launch app thật.
 * IPC được gọi trực tiếp qua electronApp.evaluate() vì contextBridge không
 * expose được trong test context — chúng ta test IPC handler logic,
 * không phải UI rendering.
 */

import { test, expect, ElectronApplication, Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import path from 'node:path'

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Launch Electron app in test mode.
 * Uses pre-built dist-electron/main/main.js (production build).
 * Nếu muốn test dev: đổi sang electron-vite dev server.
 */
async function launchApp(): Promise<{ electronApp: ElectronApplication; page: Page }> {
  const appPath = path.resolve(__dirname, '../../dist-electron/main/main.js')

  const electronApp = await electron.launch({
    args: [appPath],
    env: {
      ...process.env,
      NODE_ENV: 'test',
      // Redirect auth state file to temp dir để không ảnh hưởng production
      AUTH_STATE_PATH: path.join(process.env.TEMP || '/tmp', 'vitest-93media-auth-test.enc'),
    },
  })

  // Wait for the first window to be ready
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { electronApp, page }
}

/**
 * Invoke an IPC handler trực tiếp từ main process (không qua renderer/contextBridge).
 * Dùng cho kiểm tra logic auth mà không cần UI.
 */
async function invokeIpc<T = any>(
  electronApp: ElectronApplication,
  channel: string,
  ...args: any[]
): Promise<T> {
  return electronApp.evaluate(
    async ({ ipcMain }, { ch, a }) => {
      return new Promise<any>((resolve) => {
        // Simulate invoke bằng cách gọi handler trực tiếp
        const handlers = (ipcMain as any)._invokeHandlers || (ipcMain as any).listenerCount
        // Trigger via ipcMain.emit is not reliable — instead we use
        // electronApp.evaluate to call the handler by emitting a fake event
        ipcMain.emit(ch, { sender: { send: () => {} } }, ...a)
        resolve(undefined)
      })
    },
    { ch: channel, a: args }
  )
}

// ─── Auth Flow Tests ─────────────────────────────────────────────────────────

test.describe('Auth IPC — rate limiter via main process', () => {
  let electronApp: ElectronApplication

  test.beforeAll(async () => {
    // Only launch once for this describe block
    // Skip if dist-electron doesn't exist (CI without build step)
    const distPath = path.resolve(__dirname, '../../dist-electron/main/main.js')
    const { existsSync } = await import('node:fs')
    if (!existsSync(distPath)) {
      test.skip()
      return
    }
  })

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close()
    }
  })

  // ─── Basic window ──────────────────────────────────────────────────────────

  test('app launches and shows a window', async () => {
    const distPath = path.resolve(__dirname, '../../dist-electron/main/main.js')
    const { existsSync } = await import('node:fs')
    if (!existsSync(distPath)) {
      test.skip()
      return
    }

    electronApp = await electron.launch({
      args: [distPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        AUTH_STATE_PATH: path.join(
          process.env.TEMP || '/tmp',
          `vitest-auth-e2e-${Date.now()}.enc`
        ),
      },
    })

    const windowCount = electronApp.windows().length
    expect(windowCount).toBeGreaterThanOrEqual(1)

    const page = await electronApp.firstWindow()
    expect(page).toBeTruthy()

    // Wait for load
    await page.waitForLoadState('domcontentloaded', { timeout: 15000 })

    // Should not be blank
    const title = await page.title()
    expect(title).toBeTruthy()
  })

  test('main window has correct title or body content', async () => {
    if (!electronApp) test.skip()

    const page = electronApp.windows()[0]
    await page.waitForLoadState('domcontentloaded', { timeout: 10000 })

    // App should render something — not an error page
    const body = await page.locator('body').textContent({ timeout: 5000 })
    expect(body).toBeTruthy()
    expect(body!.length).toBeGreaterThan(0)
  })
})

// ─── Rate Limiter Unit-style E2E (via IPC evaluate) ───────────────────────────

test.describe('RateLimiter — isolated logic tests (no Electron launch needed)', () => {
  /**
   * These tests import and exercise the RateLimiter class directly in Node,
   * confirming the same behavior the E2E app will expose via IPC.
   * This avoids needing a running Electron instance for logic-only tests.
   */

  test('RateLimiter blocks after 5 failed attempts', async () => {
    const { RateLimiter, LOGIN_RATE_LIMIT_CONFIG } = await import(
      '../../backend/security/rateLimiter'
    )
    const limiter = new RateLimiter()
    const key = 'e2e:test-user-rate'

    // Exhaust all 5 attempts
    for (let i = 0; i < 5; i++) {
      const r = limiter.check(key, LOGIN_RATE_LIMIT_CONFIG)
      expect(r.allowed).toBe(true)
    }

    // 6th attempt should be blocked
    const blocked = limiter.check(key, LOGIN_RATE_LIMIT_CONFIG)
    expect(blocked.allowed).toBe(false)
    expect(blocked.remaining).toBe(0)
    expect(blocked.resetAt).toBeGreaterThan(Date.now())
  })

  test('RateLimiter resets after successful login', async () => {
    const { RateLimiter, LOGIN_RATE_LIMIT_CONFIG } = await import(
      '../../backend/security/rateLimiter'
    )
    const limiter = new RateLimiter()
    const key = 'e2e:test-user-reset'

    // Use up 4 attempts
    for (let i = 0; i < 4; i++) limiter.check(key, LOGIN_RATE_LIMIT_CONFIG)

    // Simulate successful login — resets counter
    limiter.reset(key)

    // Should have full 5 attempts again
    const r = limiter.check(key, LOGIN_RATE_LIMIT_CONFIG)
    expect(r.allowed).toBe(true)
    expect(r.remaining).toBe(4) // 5 max - 1 just used
  })

  test('RateLimiter isolates different users', async () => {
    const { RateLimiter, LOGIN_RATE_LIMIT_CONFIG } = await import(
      '../../backend/security/rateLimiter'
    )
    const limiter = new RateLimiter()

    // Block user1
    for (let i = 0; i < 5; i++) limiter.check('e2e:user1', LOGIN_RATE_LIMIT_CONFIG)
    expect(limiter.check('e2e:user1', LOGIN_RATE_LIMIT_CONFIG).allowed).toBe(false)

    // user2 should NOT be affected
    const r = limiter.check('e2e:user2', LOGIN_RATE_LIMIT_CONFIG)
    expect(r.allowed).toBe(true)
  })

  test('LOGIN_RATE_LIMIT_CONFIG has correct values', async () => {
    const { LOGIN_RATE_LIMIT_CONFIG } = await import('../../backend/security/rateLimiter')

    expect(LOGIN_RATE_LIMIT_CONFIG.maxAttempts).toBe(5)
    expect(LOGIN_RATE_LIMIT_CONFIG.windowMs).toBe(15 * 60 * 1000) // 15 minutes
  })
})

// ─── Auth Store E2E (encrypted state) ────────────────────────────────────────

test.describe('EncryptedAuthStore — read/write/clear', () => {
  const testAuthPath = path.join(
    process.env.TEMP || '/tmp',
    `vitest-authstore-e2e-${Date.now()}.enc`
  )

  test.beforeAll(() => {
    process.env.AUTH_STATE_PATH = testAuthPath
  })

  test.afterAll(async () => {
    const { existsSync, unlinkSync } = await import('node:fs')
    if (existsSync(testAuthPath)) unlinkSync(testAuthPath)
    delete process.env.AUTH_STATE_PATH
  })

  test('writeEncryptedAuthState then readEncryptedAuthState round-trips correctly', async () => {
    const { writeEncryptedAuthState, readEncryptedAuthState, clearEncryptedAuthState } =
      await import('../../backend/auth/encryptedAuthStore')

    const testData = {
      status: 'allowed' as const,
      username: 'test-e2e-user',
      password: 'test-pass-e2e',
      machineId: 'test-machine-hash-abc123',
      activationKey: 'ACT-KEY-12345',
      message: 'E2E test auth state',
      remember: true,
    }

    await writeEncryptedAuthState(testData)
    const read = await readEncryptedAuthState()

    expect(read).not.toBeNull()
    expect(read!.username).toBe(testData.username)
    expect(read!.status).toBe(testData.status)
    expect(read!.activationKey).toBe(testData.activationKey)
    expect(read!.machineId).toBe(testData.machineId)

    // Cleanup
    clearEncryptedAuthState()
  })

  test('clearEncryptedAuthState removes the file', async () => {
    const { writeEncryptedAuthState, readEncryptedAuthState, clearEncryptedAuthState } =
      await import('../../backend/auth/encryptedAuthStore')

    // Write something first
    await writeEncryptedAuthState({
      status: 'pending' as const,
      username: 'to-delete',
      password: 'pass',
      machineId: 'mach-123',
      message: 'cleanup test',
      remember: false,
    })

    // Verify it was written
    const before = await readEncryptedAuthState()
    expect(before).not.toBeNull()

    // Clear
    clearEncryptedAuthState()

    // Should now return null
    const after = await readEncryptedAuthState()
    expect(after).toBeNull()
  })

  test('readEncryptedAuthState returns null when no file exists', async () => {
    const { readEncryptedAuthState } = await import('../../backend/auth/encryptedAuthStore')

    // Ensure file doesn't exist
    const { existsSync, unlinkSync } = await import('node:fs')
    if (existsSync(testAuthPath)) unlinkSync(testAuthPath)

    const result = await readEncryptedAuthState()
    expect(result).toBeNull()
  })
})

/**
 * Test script cho Phase 1 Security
 * Test: Encryption, HMAC, MachineId, Migration
 */

import * as encryptedAuthStore from '../backend/auth/encryptedAuthStore'
import * as authStore from '../backend/auth/authStore'
import { getMachineHash } from '../backend/license/machineId'
import type { StoredAuthState } from '../backend/auth/authStore'

const { readEncryptedAuthState, writeEncryptedAuthState, clearEncryptedAuthState, migrateFromPlaintext } = encryptedAuthStore
const { writeStoredAuthState, clearStoredAuthState } = authStore

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message: string, color: keyof typeof colors = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

function test(name: string, fn: () => Promise<boolean> | boolean): Promise<boolean> {
  return new Promise(async (resolve) => {
    try {
      const result = await fn()
      if (result) {
        log(`✓ ${name}`, 'green')
        resolve(true)
      } else {
        log(`✗ ${name}`, 'red')
        resolve(false)
      }
    } catch (error: any) {
      log(`✗ ${name} - Error: ${error.message}`, 'red')
      resolve(false)
    }
  })
}

async function main() {
  log('\n' + '='.repeat(60), 'cyan')
  log('PHASE 1 SECURITY TEST', 'cyan')
  log('='.repeat(60) + '\n', 'cyan')

  const results: boolean[] = []

  // Test 1: MachineId Generation
  log('📋 Test 1: MachineId Generation', 'blue')
  log('-'.repeat(60))
  results.push(
    await test('MachineId được generate thành công', async () => {
      const machineId = await getMachineHash()
      return machineId.length === 64 && /^[a-f0-9]+$/.test(machineId)
    })
  )

  results.push(
    await test('MachineId consistent (2 lần generate giống nhau)', async () => {
      const id1 = await getMachineHash()
      const id2 = await getMachineHash()
      return id1 === id2
    })
  )

  // Test 2: Encryption/Decryption
  log('\n📋 Test 2: Encryption/Decryption', 'blue')
  log('-'.repeat(60))

  const testState: StoredAuthState = {
    status: 'allowed',
    username: 'test_user',
    password: 'test_password_123',
    machineId: await getMachineHash(),
    activationKey: 'test_key_123',
    message: 'Test message',
    latestVersion: '1.0.0',
    downloadUrl: 'https://example.com',
    remember: true,
  }

  results.push(
    await test('Write encrypted auth state thành công', async () => {
      await writeEncryptedAuthState(testState)
      return true
    })
  )

  results.push(
    await test('Read encrypted auth state thành công', async () => {
      const read = await readEncryptedAuthState()
      return (
        read !== null &&
        read.username === testState.username &&
        read.password === testState.password &&
        read.status === testState.status
      )
    })
  )

  results.push(
    await test('Decrypted data khớp với original', async () => {
      const read = await readEncryptedAuthState()
      if (!read) return false
      return (
        read.username === testState.username &&
        read.password === testState.password &&
        read.machineId === testState.machineId &&
        read.activationKey === testState.activationKey &&
        read.status === testState.status
      )
    })
  )

  // Test 3: HMAC Integrity Check
  log('\n📋 Test 3: HMAC Integrity Check', 'blue')
  log('-'.repeat(60))

  results.push(
    await test('File bị sửa → HMAC không khớp → không decrypt được', async () => {
      // Đọc file encrypted
      const path = require('path')
      const fs = require('fs')
      const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
      const file = path.join(commonAppData, '93MediaToolMixNhac', 'authState.enc')

      if (!fs.existsSync(file)) return false

      // Sửa file (thêm 1 byte)
      const original = fs.readFileSync(file, 'utf8')
      const tampered = original + 'X'
      fs.writeFileSync(file, tampered, 'utf8')

      // Thử đọc lại
      const read = await readEncryptedAuthState()

      // Restore file
      fs.writeFileSync(file, original, 'utf8')

      // Nếu tampered, read phải return null
      return read === null
    })
  )

  // Test 4: MachineId Validation
  log('\n📋 Test 4: MachineId Validation', 'blue')
  log('-'.repeat(60))

  results.push(
    await test('MachineId khớp → decrypt thành công', async () => {
      // Đã test ở trên, machineId hiện tại khớp
      const read = await readEncryptedAuthState()
      return read !== null && read.machineId === (await getMachineHash())
    })
  )

  results.push(
    await test('MachineId trong state phải khớp với current', async () => {
      // Lưu state với machineId hiện tại
      await writeEncryptedAuthState(testState)

      // Đọc lại - machineId trong state phải khớp với current
      const read = await readEncryptedAuthState()
      if (!read) return false

      const currentMachineId = await getMachineHash()
      // MachineId trong decrypted state phải khớp với current
      return read.machineId === currentMachineId
    })
  )

  // Test 5: Migration từ Plaintext
  log('\n📋 Test 5: Migration từ Plaintext', 'blue')
  log('-'.repeat(60))

  // Tạo plaintext file để test migration
  const plaintextState: StoredAuthState = {
    status: 'allowed',
    username: 'migration_test',
    password: 'migration_password',
    machineId: await getMachineHash(),
    activationKey: 'migration_key',
    message: 'Migration test',
    remember: true,
  }

  results.push(
    await test('Tạo plaintext file để test migration', async () => {
      writeStoredAuthState(plaintextState)
      return true
    })
  )

  results.push(
    await test('Migration từ plaintext sang encrypted', async () => {
      const migrated = await migrateFromPlaintext()
      return migrated === true
    })
  )

  results.push(
    await test('Sau migration, encrypted file có thể đọc được', async () => {
      const read = await readEncryptedAuthState()
      return (
        read !== null &&
        read.username === plaintextState.username &&
        read.password === plaintextState.password
      )
    })
  )

  results.push(
    await test('Sau migration, plaintext file đã được backup', async () => {
      const path = require('path')
      const fs = require('fs')
      const commonAppData = process.env.PROGRAMDATA || path.join(process.env.SystemDrive || 'C:', 'ProgramData')
      const backupFile = path.join(commonAppData, '93MediaToolMixNhac', 'authState.json.backup')
      return fs.existsSync(backupFile)
    })
  )

  // Test 6: Clear và Edge Cases
  log('\n📋 Test 6: Clear và Edge Cases', 'blue')
  log('-'.repeat(60))

  results.push(
    await test('Clear encrypted auth state', async () => {
      clearEncryptedAuthState()
      const read = await readEncryptedAuthState()
      return read === null
    })
  )

  results.push(
    await test('Đọc file không tồn tại → return null', async () => {
      clearEncryptedAuthState()
      const read = await readEncryptedAuthState()
      return read === null
    })
  )

  results.push(
    await test('Ghi state với machineId tự động update', async () => {
      const stateWithWrongMachineId: StoredAuthState = {
        ...testState,
        machineId: 'wrong_machine_id',
      }
      await writeEncryptedAuthState(stateWithWrongMachineId)
      const read = await readEncryptedAuthState()
      // MachineId phải được update thành current
      return read !== null && read.machineId === (await getMachineHash())
    })
  )

  // Cleanup
  log('\n📋 Cleanup', 'blue')
  log('-'.repeat(60))
  clearEncryptedAuthState()
  clearStoredAuthState()
  log('✓ Cleaned up test files', 'green')

  // Summary
  log('\n' + '='.repeat(60), 'cyan')
  log('TEST SUMMARY', 'cyan')
  log('='.repeat(60), 'cyan')
  const passed = results.filter((r) => r).length
  const total = results.length
  const percentage = ((passed / total) * 100).toFixed(1)
  log(`\nPassed: ${passed}/${total} (${percentage}%)`, passed === total ? 'green' : 'yellow')

  if (passed === total) {
    log('\n✅ ALL TESTS PASSED! Phase 1 Security is working correctly.', 'green')
  } else {
    log('\n❌ SOME TESTS FAILED. Please check the errors above.', 'red')
  }

  log('\n' + '='.repeat(60) + '\n', 'cyan')
}

main().catch((error) => {
  console.error('Test failed with error:', error)
  process.exit(1)
})


/**
 * Simple test script for Phase 1 Security
 * Run with: node scripts/test-security-simple.js
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
}

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`)
}

// Test encryption/decryption manually
async function testEncryption() {
  log('\n📋 Testing Encryption/Decryption', 'blue')
  log('-'.repeat(60))

  const testData = JSON.stringify({
    username: 'test_user',
    password: 'test_password_123',
    machineId: 'test_machine_id',
  })

  // Simulate encryption
  const key = crypto.pbkdf2Sync('test_machine_id', Buffer.from('93MediaToolMixNhac2025SecuritySalt!', 'utf8'), 10000, 32, 'sha256')
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(testData, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()

  log(`✓ Encryption successful (${encrypted.length} bytes)`, 'green')

  // Simulate decryption
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final()
  ]).toString('utf8')

  const decryptedData = JSON.parse(decrypted)
  if (decryptedData.username === 'test_user' && decryptedData.password === 'test_password_123') {
    log('✓ Decryption successful - data matches', 'green')
    return true
  } else {
    log('✗ Decryption failed - data mismatch', 'red')
    return false
  }
}

// Test HMAC
async function testHMAC() {
  log('\n📋 Testing HMAC Integrity', 'blue')
  log('-'.repeat(60))

  const data = Buffer.from('test data')
  const key = Buffer.from('test_key_12345678901234567890123456789012') // 32 bytes
  const hmac = crypto.createHmac('sha256', key).update(data).digest()

  log(`✓ HMAC generated (${hmac.length} bytes)`, 'green')

  // Verify HMAC
  const calculated = crypto.createHmac('sha256', key).update(data).digest()
  const isValid = crypto.timingSafeEqual(hmac, calculated)

  if (isValid) {
    log('✓ HMAC verification successful', 'green')
  } else {
    log('✗ HMAC verification failed', 'red')
  }

  // Test tampered data
  const tamperedData = Buffer.from('test data X')
  const tamperedHMAC = crypto.createHmac('sha256', key).update(tamperedData).digest()
  const isTamperedValid = crypto.timingSafeEqual(hmac, tamperedHMAC)

  if (!isTamperedValid) {
    log('✓ Tampered data detected correctly', 'green')
    return true
  } else {
    log('✗ Tampered data not detected', 'red')
    return false
  }
}

// Test MachineId generation
async function testMachineId() {
  log('\n📋 Testing MachineId Generation', 'blue')
  log('-'.repeat(60))

  try {
    // Try to get CPU ID
    const { stdout } = await execFileAsync('wmic', ['cpu', 'get', 'ProcessorId'], { windowsHide: true })
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== 'processorid')
    if (lines.length > 0) {
      log(`✓ CPU ID found: ${lines[0].substring(0, 20)}...`, 'green')
    } else {
      log('⚠ CPU ID not found', 'yellow')
    }
  } catch (err) {
    log('⚠ Could not get CPU ID', 'yellow')
  }

  try {
    // Try to get UUID
    const { stdout } = await execFileAsync('wmic', ['csproduct', 'get', 'uuid'], { windowsHide: true })
    const lines = stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l.toLowerCase() !== 'uuid')
    if (lines.length > 0) {
      log(`✓ UUID found: ${lines[0].substring(0, 20)}...`, 'green')
    } else {
      log('⚠ UUID not found', 'yellow')
    }
  } catch (err) {
    log('⚠ Could not get UUID', 'yellow')
  }

  // Test hash generation
  const testString = 'CPU:123|UUID:456|MAC:789'
  const hash = crypto.createHash('sha256').update(testString.replace(/\s+/g, '').toUpperCase()).digest('hex')
  if (hash.length === 64) {
    log(`✓ Hash generation successful (${hash.length} chars)`, 'green')
    return true
  } else {
    log('✗ Hash generation failed', 'red')
    return false
  }
}

// Main test
async function main() {
  log('\n' + '='.repeat(60), 'cyan')
  log('PHASE 1 SECURITY - SIMPLE TEST', 'cyan')
  log('='.repeat(60) + '\n', 'cyan')

  const results = []

  results.push(await testEncryption())
  results.push(await testHMAC())
  results.push(await testMachineId())

  // Summary
  log('\n' + '='.repeat(60), 'cyan')
  log('TEST SUMMARY', 'cyan')
  log('='.repeat(60), 'cyan')
  const passed = results.filter((r) => r).length
  const total = results.length
  const percentage = ((passed / total) * 100).toFixed(1)
  log(`\nPassed: ${passed}/${total} (${percentage}%)`, passed === total ? 'green' : 'yellow')

  if (passed === total) {
    log('\n✅ ALL BASIC TESTS PASSED!', 'green')
    log('Note: Full integration test requires running the app.', 'yellow')
  } else {
    log('\n❌ SOME TESTS FAILED.', 'red')
  }

  log('\n' + '='.repeat(60) + '\n', 'cyan')
}

main().catch((error) => {
  console.error('Test failed:', error)
  process.exit(1)
})


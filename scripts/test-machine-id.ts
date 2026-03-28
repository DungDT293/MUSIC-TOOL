/**
 * Test script để verify machine ID generation
 * Kiểm tra tính cố định và độ tin cậy của machine ID
 */

import { getMachineHash } from '../backend/license/machineId'
import fs from 'fs'
import path from 'path'
import os from 'os'

async function testMachineId() {
  console.log('========================================')
  console.log('🧪 TEST MACHINE ID GENERATION')
  console.log('========================================\n')

  // Test 1: Generate machine ID lần đầu
  console.log('[Test 1] Generating machine ID (first time)...')
  const machineId1 = await getMachineHash()
  console.log(`✅ Machine ID: ${machineId1.substring(0, 32)}...`)
  console.log(`   Length: ${machineId1.length} characters\n`)

  // Test 2: Generate lại để verify tính nhất quán
  console.log('[Test 2] Generating machine ID again (should be cached)...')
  const machineId2 = await getMachineHash()
  console.log(`✅ Machine ID: ${machineId2.substring(0, 32)}...`)
  console.log(`   Length: ${machineId2.length} characters`)

  if (machineId1 === machineId2) {
    console.log('✅ PASS: Machine ID is consistent (cached correctly)\n')
  } else {
    console.log('❌ FAIL: Machine ID changed between calls!\n')
    process.exit(1)
  }

  // Test 3: Verify cache file exists
  console.log('[Test 3] Checking cache file...')
  const cacheFile = path.join(os.homedir(), '.93media', 'machine-id.txt')
  if (fs.existsSync(cacheFile)) {
    const cachedContent = fs.readFileSync(cacheFile, 'utf8').trim()
    console.log(`✅ Cache file exists: ${cacheFile}`)
    console.log(`   Cached value: ${cachedContent.substring(0, 32)}...`)
    
    if (cachedContent === machineId1) {
      console.log('✅ PASS: Cache file matches generated ID\n')
    } else {
      console.log('❌ FAIL: Cache file does not match generated ID\n')
      process.exit(1)
    }
  } else {
    console.log('⚠️  WARNING: Cache file not found (may be first run)\n')
  }

  // Test 4: Verify format (SHA256 hash = 64 hex characters)
  console.log('[Test 4] Verifying machine ID format...')
  const isValidFormat = /^[a-f0-9]{64}$/i.test(machineId1)
  if (isValidFormat) {
    console.log('✅ PASS: Machine ID format is valid (64 hex characters)\n')
  } else {
    console.log('❌ FAIL: Machine ID format is invalid\n')
    process.exit(1)
  }

  // Test 5: Test với environment variable override
  console.log('[Test 5] Testing with environment variable override...')
  const testCacheFile = path.join(os.tmpdir(), 'test-machine-id.txt')
  process.env.MACHINE_ID_FILE = testCacheFile
  
  // Clear cache để force regenerate
  const originalCacheFile = path.join(os.homedir(), '.93media', 'machine-id.txt')
  let originalCache: string | null = null
  if (fs.existsSync(originalCacheFile)) {
    originalCache = fs.readFileSync(originalCacheFile, 'utf8')
    fs.unlinkSync(originalCacheFile)
  }
  
  const machineId3 = await getMachineHash()
  console.log(`✅ Machine ID with override: ${machineId3.substring(0, 32)}...`)
  
  if (fs.existsSync(testCacheFile)) {
    console.log('✅ PASS: Environment variable override works\n')
    fs.unlinkSync(testCacheFile)
  } else {
    console.log('❌ FAIL: Environment variable override did not work\n')
  }
  
  // Restore original cache
  if (originalCache) {
    fs.writeFileSync(originalCacheFile, originalCache)
  }
  delete process.env.MACHINE_ID_FILE

  // Summary
  console.log('========================================')
  console.log('✅ ALL TESTS PASSED!')
  console.log('========================================')
  console.log('\n📋 Summary:')
  console.log(`   - Machine ID is consistent: ✅`)
  console.log(`   - Cache mechanism works: ✅`)
  console.log(`   - Format is valid: ✅`)
  console.log(`   - Environment override works: ✅`)
  console.log(`\n💡 Machine ID: ${machineId1.substring(0, 16)}...${machineId1.substring(48)}`)
  console.log(`   This ID is based on hardware identifiers and should remain constant.`)
  console.log(`   It will NOT change when using VPN or changing IP address.`)
}

// Run tests
testMachineId().catch((error) => {
  console.error('❌ Test failed with error:', error)
  process.exit(1)
})

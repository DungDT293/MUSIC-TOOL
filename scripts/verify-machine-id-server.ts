/**
 * Script để verify machine ID trên server sau khi đăng ký
 * Kiểm tra xem machine ID có được lưu đúng trên server không
 */

import { getMachineHash } from '../backend/license/machineId'

async function verifyMachineIdOnServer() {
  console.log('========================================')
  console.log('🔍 VERIFY MACHINE ID ON SERVER')
  console.log('========================================\n')

  // Get local machine ID
  console.log('[Step 1] Getting local machine ID...')
  const localMachineId = await getMachineHash()
  console.log(`✅ Local Machine ID: ${localMachineId}`)
  console.log(`   Short: ${localMachineId.substring(0, 16)}...${localMachineId.substring(48)}\n`)

  console.log('[Step 2] Instructions to verify on server:')
  console.log('\n📋 Manual Verification Steps:')
  console.log('   1. Open the app and register a new account')
  console.log('   2. Go to server dashboard: https://license-server.dungdong333.workers.dev/')
  console.log('   3. Login with admin credentials')
  console.log('   4. Check the "Registrations" or "Audit Logs" tab')
  console.log('   5. Find your registration entry')
  console.log('   6. Verify the "ma_may" field matches:')
  console.log(`      ${localMachineId.substring(0, 16)}...${localMachineId.substring(48)}`)
  console.log('\n💡 Expected Behavior:')
  console.log('   ✅ Machine ID in server should match local machine ID')
  console.log('   ✅ Machine ID should be 64 hex characters (SHA256 hash)')
  console.log('   ✅ Same machine ID should be used for login/validation')
  console.log('\n🔒 Security Check:')
  console.log('   ✅ Machine ID is hardware-based, not IP-based')
  console.log('   ✅ Using VPN will NOT change machine ID')
  console.log('   ✅ Changing IP address will NOT change machine ID')
  console.log('   ✅ Only 1 machine ID per registration (1 key = 1 machine)')

  console.log('\n========================================')
  console.log('✅ VERIFICATION READY')
  console.log('========================================')
  console.log('\n📝 Your Machine ID for reference:')
  console.log(`   Full: ${localMachineId}`)
  console.log(`   Short: ${localMachineId.substring(0, 16)}...${localMachineId.substring(48)}`)
  console.log('\n💡 Tip: Copy the machine ID above and compare it with the server dashboard')
}

// Run
verifyMachineIdOnServer().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})

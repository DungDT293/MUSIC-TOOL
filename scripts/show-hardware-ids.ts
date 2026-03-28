/**
 * Script để hiển thị chi tiết các hardware identifiers được sử dụng
 * Giúp verify rằng machine ID dựa trên các identifiers cố định
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import fs from 'fs'
import path from 'path'

const execFileAsync = promisify(execFile)

async function tryCommand(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true })
    const lines = stdout
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line && line.toLowerCase() !== 'uuid' && line.toLowerCase() !== 'serialnumber')
    if (lines.length > 0) {
      return lines[0]
    }
    return null
  } catch {
    return null
  }
}

async function showHardwareIdentifiers() {
  console.log('========================================')
  console.log('🔍 HARDWARE IDENTIFIERS ANALYSIS')
  console.log('========================================\n')

  if (process.platform !== 'win32') {
    console.log('⚠️  This script is optimized for Windows.')
    console.log('   For Unix/Linux, machine ID uses different identifiers.\n')
    return
  }

  console.log('📋 Collecting hardware identifiers...\n')

  // Windows MachineGuid
  console.log('[1] Windows MachineGuid (Registry):')
  try {
    const { execSync } = require('child_process')
    const winId = execSync('reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const match = winId.match(/MachineGuid\s+REG_SZ\s+([a-f0-9-]+)/i)
    if (match && match[1]) {
      console.log(`   ✅ Found: ${match[1]}`)
      console.log('   📌 Priority: HIGHEST (most stable)')
      console.log('   💡 This is Microsoft\'s recommended machine identifier\n')
    } else {
      console.log('   ❌ Not found\n')
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}\n`)
  }

  // Computer System UUID
  console.log('[2] Computer System UUID (SMBIOS):')
  const uuid = await tryCommand('wmic', ['csproduct', 'get', 'uuid'])
  if (uuid) {
    console.log(`   ✅ Found: ${uuid}`)
    console.log('   📌 Priority: HIGH (from motherboard)\n')
  } else {
    console.log('   ❌ Not found\n')
  }

  // Motherboard Serial
  console.log('[3] Motherboard Serial:')
  const baseboard = await tryCommand('wmic', ['baseboard', 'get', 'serialnumber'])
  if (baseboard) {
    console.log(`   ✅ Found: ${baseboard}`)
    console.log('   📌 Priority: HIGH (from hardware)\n')
  } else {
    console.log('   ❌ Not found\n')
  }

  // BIOS Serial
  console.log('[4] BIOS Serial:')
  const bios = await tryCommand('wmic', ['bios', 'get', 'serialnumber'])
  if (bios) {
    console.log(`   ✅ Found: ${bios}`)
    console.log('   📌 Priority: HIGH (from firmware)\n')
  } else {
    console.log('   ❌ Not found\n')
  }

  // CPU ID
  console.log('[5] CPU Processor ID:')
  const cpuId = await tryCommand('wmic', ['cpu', 'get', 'ProcessorId'])
  if (cpuId) {
    console.log(`   ✅ Found: ${cpuId}`)
    console.log('   📌 Priority: MEDIUM (from CPU)\n')
  } else {
    console.log('   ❌ Not found\n')
  }

  // Disk Serial Numbers
  console.log('[6] Disk Serial Numbers:')
  try {
    const { execSync } = require('child_process')
    const diskOutput = execSync('wmic diskdrive get serialnumber', {
      windowsHide: true,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const diskLines = diskOutput
      .split(/\r?\n/)
      .map((line: string) => line.trim())
      .filter((line: string) => line && line.toLowerCase() !== 'serialnumber')
    
    if (diskLines.length > 0) {
      diskLines.forEach((disk: string, index: number) => {
        console.log(`   ✅ Disk ${index + 1}: ${disk}`)
      })
      console.log('   📌 Priority: MEDIUM (from storage devices)\n')
    } else {
      console.log('   ❌ Not found\n')
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}\n`)
  }

  // MAC Addresses
  console.log('[7] Physical Network Adapters (MAC):')
  try {
    const interfaces = os.networkInterfaces()
    const macs: string[] = []
    const virtualAdapterKeywords = ['virtual', 'vpn', 'tun', 'tap', 'vmware', 'virtualbox', 'hyper-v', 'vbox', 'npcap', 'nmap', 'loopback', 'docker', 'wsl', 'wsl2']
    
    for (const [ifaceName, ifaceList] of Object.entries(interfaces)) {
      if (!ifaceList) continue
      
      const nameLower = ifaceName.toLowerCase()
      const isVirtual = virtualAdapterKeywords.some(keyword => nameLower.includes(keyword))
      
      for (const iface of ifaceList) {
        if (iface.internal) continue
        if (iface.mac && iface.mac !== '00:00:00:00:00:00') {
          const status = isVirtual ? '❌ Virtual (excluded)' : '✅ Physical'
          console.log(`   ${status}: ${ifaceName} - ${iface.mac}`)
          if (!isVirtual) {
            macs.push(iface.mac)
          }
        }
      }
    }
    
    if (macs.length > 0) {
      macs.sort()
      console.log(`\n   📌 Priority: LOW (fallback only)`)
      console.log(`   💡 Using first MAC: ${macs[0]}`)
      console.log('   ⚠️  Note: MAC address can change if network adapter is replaced\n')
    } else {
      console.log('   ⚠️  No physical adapters found\n')
    }
  } catch (error: any) {
    console.log(`   ❌ Error: ${error.message}\n`)
  }

  // Cache file info
  console.log('========================================')
  console.log('💾 CACHE INFORMATION')
  console.log('========================================\n')
  const cacheFile = path.join(os.homedir(), '.93media', 'machine-id.txt')
  if (fs.existsSync(cacheFile)) {
    const cachedId = fs.readFileSync(cacheFile, 'utf8').trim()
    console.log(`✅ Cache file: ${cacheFile}`)
    console.log(`   Machine ID: ${cachedId.substring(0, 32)}...${cachedId.substring(32)}`)
    console.log('\n💡 The cache ensures machine ID remains constant even if:')
    console.log('   - Windows/drivers are updated')
    console.log('   - Network adapters are added/removed')
    console.log('   - Disks are added (if not primary disk)')
    console.log('   - VPN is used (MAC filtering excludes VPN adapters)')
  } else {
    console.log('⚠️  Cache file not found (will be created on first run)')
  }

  console.log('\n========================================')
  console.log('✅ ANALYSIS COMPLETE')
  console.log('========================================')
  console.log('\n📌 Key Points:')
  console.log('   1. Machine ID is based on HARDWARE identifiers, NOT IP address')
  console.log('   2. Using VPN or changing IP will NOT affect machine ID')
  console.log('   3. Cache file ensures consistency across app restarts')
  console.log('   4. Machine ID only changes if hardware is replaced')
  console.log('      (motherboard, CPU, or primary disk)')
}

// Run
showHardwareIdentifiers().catch((error) => {
  console.error('❌ Error:', error)
  process.exit(1)
})

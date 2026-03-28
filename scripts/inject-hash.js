/**
 * inject-hash.js
 * Post-build script: tính SHA-256 của dist-electron/main/main.js
 * và ghi hash vào dist-electron/main/chunks/buildHashConstants-*.js
 * (hoặc tạo file buildHashConstants.js riêng nếu được bundle độc lập).
 *
 * Approach: patch trực tiếp main.js — thay string sentinel bằng hash thực tế.
 * String sentinel được inject qua Vite define: '__MAIN_JS_HASH_PLACEHOLDER__'
 *
 * Chạy tự động sau `npm run build` qua "postbuild" trong package.json.
 */

const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const MAIN_JS = path.resolve(__dirname, '../dist-electron/main/main.js')
// Sentinel string phải khớp với giá trị trong Vite define config
const SENTINEL = '__MAIN_JS_HASH_PLACEHOLDER__'

function calcHashOfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function run() {
  if (!fs.existsSync(MAIN_JS)) {
    console.warn('[inject-hash] dist-electron/main/main.js not found — skipping')
    return
  }

  const originalBuf = fs.readFileSync(MAIN_JS)
  const originalContent = originalBuf.toString('utf8')

  // Tính hash của main.js TRƯỚC khi patch
  const mainHash = calcHashOfBuffer(originalBuf)

  // Tìm và thay sentinel trong bundle
  const sentinelPattern = new RegExp(SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
  const occurrences = (originalContent.match(sentinelPattern) || []).length

  if (occurrences === 0) {
    console.warn('[inject-hash] Sentinel "' + SENTINEL + '" not found in main.js')
    console.warn('[inject-hash] Check that Vite define config has __MAIN_JS_HASH_PLACEHOLDER__')
    // Ghi hash vào separate file để tamperDetection có thể đọc
    const hashFile = path.resolve(__dirname, '../dist-electron/main/build-hash.json')
    fs.writeFileSync(hashFile, JSON.stringify({ mainJsHash: mainHash }), 'utf8')
    console.log('[inject-hash] ✅ Wrote hash to build-hash.json:', mainHash.slice(0, 16) + '...')
    return
  }

  const patched = originalContent.replace(sentinelPattern, mainHash)
  fs.writeFileSync(MAIN_JS, patched, 'utf8')
  console.log('[inject-hash] ✅ Injected main.js hash (' + occurrences + ' occurrence[s]):', mainHash.slice(0, 16) + '...')
}

run()

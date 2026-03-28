/**
 * Vite Plugin for JavaScript Obfuscation
 * Obfuscate code khi build production
 */

import type { Plugin } from 'vite'
import JavaScriptObfuscator from 'javascript-obfuscator'

export function obfuscatePlugin(): Plugin {
  return {
    name: 'obfuscate',
    apply: 'build', // Chỉ chạy khi build
    enforce: 'post', // Chạy sau các plugin khác
    generateBundle(options, bundle) {
      // Chỉ obfuscate trong production
      if (process.env.NODE_ENV !== 'production') {
        return
      }

      for (const [fileName, chunk] of Object.entries(bundle)) {
        // Chỉ obfuscate JavaScript files
        if (chunk.type === 'chunk' && fileName.endsWith('.js')) {
          const obfuscationResult = JavaScriptObfuscator.obfuscate(chunk.code, {
            compact: true,
            controlFlowFlattening: true,
            controlFlowFlatteningThreshold: 0.75,
            deadCodeInjection: true,
            deadCodeInjectionThreshold: 0.4,
            debugProtection: false, // Tắt để tránh conflict với anti-debug
            debugProtectionInterval: 0,
            disableConsoleOutput: false, // Giữ console để debug
            identifierNamesGenerator: 'hexadecimal',
            log: false,
            numbersToExpressions: true,
            renameGlobals: false,
            selfDefending: true, // Bảo vệ code khỏi formatting
            simplify: true,
            splitStrings: true,
            splitStringsChunkLength: 10,
            stringArray: true,
            stringArrayCallsTransform: true,
            stringArrayEncoding: ['base64'],
            stringArrayIndexShift: true,
            stringArrayRotate: true,
            stringArrayShuffle: true,
            stringArrayWrappersCount: 2,
            stringArrayWrappersChainedCalls: true,
            stringArrayWrappersParametersMaxCount: 4,
            stringArrayWrappersType: 'function',
            stringArrayThreshold: 0.75,
            transformObjectKeys: true,
            unicodeEscapeSequence: false,
          })

          chunk.code = obfuscationResult.getObfuscatedCode()
        }
      }
    },
  }
}



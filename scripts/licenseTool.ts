import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { LicensePayload, SignedLicenseFile } from '../shared/licenseTypes'
import { decodePayload, encodePayload, hashMachineIdentifier } from '../shared/licenseUtils'

interface CliOptions {
  [key: string]: string | boolean | undefined
}

function parseArgs(): { command: string | undefined; options: CliOptions } {
  const [, , ...rest] = process.argv
  const options: CliOptions = {}
  let command: string | undefined

  for (const arg of rest) {
    if (!command) {
      command = arg
      continue
    }
    if (arg.startsWith('--')) {
      const [key, value] = arg.substring(2).split('=')
      options[key] = value ?? true
    }
  }

  return { command, options }
}

function resolvePrivateKey(options: CliOptions): Buffer {
  const provided = options['private-key']
  const target = provided ? String(provided) : path.resolve(process.cwd(), 'security', 'dev_private_key.pem')
  if (!fs.existsSync(target)) {
    throw new Error(`Không tìm thấy private key ở ${target}. Dùng --private-key=... để chỉ định.`)
  }
  return fs.readFileSync(target)
}

function resolvePublicKey(options: CliOptions): Buffer {
  const provided = options['public-key']
  const target = provided ? String(provided) : path.resolve(process.cwd(), 'security', 'license_public_key.pem')
  if (!fs.existsSync(target)) {
    throw new Error(`Không tìm thấy public key ở ${target}. Dùng --public-key=... để chỉ định.`)
  }
  return fs.readFileSync(target)
}

function requireOption(options: CliOptions, key: string): string {
  const value = options[key]
  if (!value || typeof value !== 'string') {
    throw new Error(`Thiếu tham số --${key}=...`)
  }
  return value
}

function commandCreate(options: CliOptions) {
  const licenseId = requireOption(options, 'licenseId')
  const allowedVersion = requireOption(options, 'version')
  const machine = options['machine']
  const wildcard = options['wildcard'] === 'true' || options['wildcard'] === true
  if (!machine && !wildcard) {
    throw new Error('Cần truyền --machine="HWID" hoặc --wildcard=true')
  }
  const machineHash = wildcard ? '*' : hashMachineIdentifier(String(machine))
  const issuedAt = new Date().toISOString()
  const expiresAt = options['expires'] ? new Date(String(options['expires'])).toISOString() : undefined
  const notes = options['notes'] ? String(options['notes']) : undefined

  const payload: LicensePayload = {
    licenseId,
    allowedVersion,
    machineHash,
    issuedAt,
    expiresAt,
    notes,
  }

  const payloadEncoded = encodePayload(payload)
  const privateKey = resolvePrivateKey(options)
  const signature = crypto.sign(null, Buffer.from(payloadEncoded, 'utf8'), privateKey).toString('base64')

  const signed: SignedLicenseFile = {
    payload: payloadEncoded,
    signature,
  }

  const outputPath =
    typeof options['output'] === 'string'
      ? options['output']
      : path.resolve(process.cwd(), `license-${licenseId}.lic`)
  fs.writeFileSync(outputPath, JSON.stringify(signed, null, 2), 'utf8')
  console.log(`Đã tạo license lưu tại ${outputPath}`)
}

function commandInspect(options: CliOptions) {
  const file = requireOption(options, 'file')
  if (!fs.existsSync(file)) {
    throw new Error(`Không tìm thấy file ${file}`)
  }
  const content = fs.readFileSync(file, 'utf8')
  const data = JSON.parse(content) as SignedLicenseFile
  const payload = decodePayload<LicensePayload>(data.payload)
  console.log('License payload:', payload)
  if (options['verify']) {
    const publicKey = resolvePublicKey(options)
    const isValid = crypto.verify(
      null,
      Buffer.from(data.payload, 'utf8'),
      publicKey,
      Buffer.from(data.signature, 'base64')
    )
    console.log('Signature valid:', isValid)
  }
}

function printUsage() {
  console.log(`License tool commands:
  create --licenseId=EMP001 --version=1.0.0 --machine=ABC123 --output=dist/license.lic
    --private-key=security/dev_private_key.pem [--expires=2025-12-31] [--notes="Ghi chú"]
    --wildcard=true  (tuỳ chọn, chỉ dùng cho dev)

  inspect --file=dist/license.lic [--verify=true] [--public-key=security/license_public_key.pem]
`)
}

async function main() {
  try {
    const { command, options } = parseArgs()
    if (command === 'create') {
      commandCreate(options)
      return
    }
    if (command === 'inspect') {
      commandInspect(options)
      return
    }
    printUsage()
  } catch (error: any) {
    console.error('[licenseTool] Lỗi:', error?.message || error)
    process.exitCode = 1
  }
}

void main()


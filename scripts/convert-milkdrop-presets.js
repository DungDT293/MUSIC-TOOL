const fs = require('fs')
const path = require('path')
const { convertPreset } = require('milkdrop-preset-converter')

const projectDir = path.resolve(__dirname, '..')
const sourceDir = path.join(projectDir, 'MilkDrop 3.31')
const outputDir = path.join(projectDir, 'public', 'presets')
const outputFile = path.join(outputDir, 'milkdrop_331_converted.json')
const indexFile = path.join(projectDir, 'docs', 'milkdrop_331_index.json')
const errorFile = path.join(projectDir, 'docs', 'milkdrop_331_errors.json')
const summaryFile = path.join(projectDir, 'docs', 'milkdrop_331_summary.json')

const MAX_PRESETS = 500
const TAG_KEYWORDS = [
  { key: 'circle', tag: 'circle' },
  { key: 'ring', tag: 'circle' },
  { key: 'spiral', tag: 'spiral' },
  { key: 'tunnel', tag: 'tunnel' },
  { key: 'fractal', tag: 'fractal' },
  { key: 'plasma', tag: 'plasma' },
  { key: 'wave', tag: 'wave' },
  { key: 'spectrum', tag: 'spectrum' },
  { key: 'bars', tag: 'bars' },
  { key: 'grid', tag: 'grid' },
  { key: 'star', tag: 'stars' },
  { key: 'nebula', tag: 'nebula' },
  { key: 'kaleid', tag: 'kaleidoscope' },
  { key: 'flower', tag: 'flower' },
  { key: 'fire', tag: 'fire' },
  { key: 'water', tag: 'water' },
  { key: 'ice', tag: 'ice' },
  { key: 'matrix', tag: 'matrix' },
  { key: 'particle', tag: 'particles' },
  { key: 'warp', tag: 'warp' },
  { key: 'shader', tag: 'shader' },
]

function listPresetFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const results = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...listPresetFiles(full))
      continue
    }
    if (/\.milk2?$/i.test(entry.name)) {
      results.push(full)
    }
  }
  return results
}

function parseMeta(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const base = path.basename(filePath, ext).trim()
  let author = 'Unknown'
  let name = base
  if (base.includes(' - ')) {
    const parts = base.split(' - ')
    if (parts.length >= 2) {
      author = parts[0].trim() || 'Unknown'
      name = parts.slice(1).join(' - ').trim() || base
    }
  }
  const lower = base.toLowerCase()
  const tags = TAG_KEYWORDS.filter((t) => lower.includes(t.key)).map((t) => t.tag)
  return { base, author, name, ext, tags }
}

async function main() {
  if (!fs.existsSync(sourceDir)) {
    console.error('[ERROR] Missing MilkDrop folder:', sourceDir)
    process.exit(1)
  }
  const files = listPresetFiles(sourceDir).sort((a, b) => a.localeCompare(b))

  const index = []
  const output = {}
  const errors = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const meta = parseMeta(file)
    const key = meta.base
    try {
      const text = fs.readFileSync(file, 'utf8')
      const preset = await convertPreset(text)
      output[key] = preset
      index.push({
        key,
        author: meta.author,
        name: meta.name,
        ext: meta.ext,
        tags: meta.tags,
        sourcePath: path.relative(projectDir, file).replace(/\\/g, '/'),
        status: 'ok',
      })
    } catch (err) {
      errors.push({
        key,
        file: file,
        message: err ? String(err.message || err) : 'Unknown error',
      })
      index.push({
        key,
        author: meta.author,
        name: meta.name,
        ext: meta.ext,
        tags: meta.tags,
        sourcePath: path.relative(projectDir, file).replace(/\\/g, '/'),
        status: 'failed',
      })
    }
    if ((i + 1) % 50 === 0) {
      console.log(`[MilkDrop] Scanned ${i + 1}/${files.length} (ok: ${Object.keys(output).length})`)
    }
    if (Object.keys(output).length >= MAX_PRESETS) {
      break
    }
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const summary = {
    totalFiles: files.length,
    requested: MAX_PRESETS,
    converted: Object.keys(output).length,
    failed: errors.length,
  }
  fs.writeFileSync(outputFile, JSON.stringify(output), 'utf8')
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), 'utf8')
  fs.writeFileSync(errorFile, JSON.stringify(errors, null, 2), 'utf8')
  fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf8')
  console.log(`[MilkDrop] Output presets: ${Object.keys(output).length}`)
  console.log(`[MilkDrop] Index file: ${path.relative(projectDir, indexFile)}`)
  console.log(`[MilkDrop] Error file: ${path.relative(projectDir, errorFile)}`)
  console.log(`[MilkDrop] Summary file: ${path.relative(projectDir, summaryFile)}`)
}

main().catch((err) => {
  console.error('[ERROR] Conversion failed:', err)
  process.exit(1)
})

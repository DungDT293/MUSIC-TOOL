const fs = require('fs')
const path = require('path')

const projectDir = path.resolve(__dirname, '..')
const sourceDirs = [
  path.join(projectDir, 'MilkDrop 3.31', 'Milkdrop3', 'textures'),
  path.join(projectDir, 'MilkDrop 3.31', 'Milkdrop3', 'sprites'),
]
const destDir = path.join(projectDir, 'public', 'presets', 'milkdrop_textures')
const manifestPath = path.join(projectDir, 'public', 'presets', 'milkdrop_textures_manifest.json')

const allowedExt = new Set(['.jpg', '.jpeg', '.png', '.jfif'])

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function listFiles(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return listFiles(full)
    return [full]
  })
}

function main() {
  ensureDir(destDir)
  const manifest = {}
  const duplicates = []

  for (const dir of sourceDirs) {
    const files = listFiles(dir)
    for (const file of files) {
      const ext = path.extname(file).toLowerCase()
      if (!allowedExt.has(ext)) continue
      const fileName = path.basename(file)
      const baseName = path.basename(file, ext)
      const destPath = path.join(destDir, fileName)
      if (!fs.existsSync(destPath)) {
        fs.copyFileSync(file, destPath)
      }
      if (manifest[baseName] && manifest[baseName] !== `/presets/milkdrop_textures/${fileName}`) {
        duplicates.push({ baseName, existing: manifest[baseName], next: `/presets/milkdrop_textures/${fileName}` })
        continue
      }
      manifest[baseName] = `/presets/milkdrop_textures/${fileName}`
    }
  }

  fs.writeFileSync(manifestPath, JSON.stringify({ manifest, duplicates }, null, 2), 'utf8')
  console.log(`[MilkDrop] Manifest entries: ${Object.keys(manifest).length}`)
  console.log(`[MilkDrop] Duplicates: ${duplicates.length}`)
  console.log(`[MilkDrop] Manifest: ${path.relative(projectDir, manifestPath)}`)
}

main()

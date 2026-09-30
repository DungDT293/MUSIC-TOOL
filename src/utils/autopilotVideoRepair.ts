export function extractAutopilotVideoFailurePaths(error: string | undefined): string[] {
  if (!error) return []
  const paths: string[] = []
  for (const match of error.matchAll(/^\s*\d+\.\s+(.+?)\s*$/gm)) {
    const filePath = match[1]?.trim()
    if (!filePath || !/^[a-z]:[\\/]|^\\\\/i.test(filePath)) continue
    if (!paths.includes(filePath)) paths.push(filePath)
  }
  return paths.slice(0, 64)
}

export function splitAutopilotVideoRoots(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[;\r\n]+/)
    .map((root) => root.trim().replace(/[\\/]+$/, ''))
    .filter(Boolean)
}

function normalizeWindowsPath(value: string): string {
  return value.replace(/\//g, '\\').replace(/[\\/]+$/, '').toLowerCase()
}

export function groupVideoRepairPathsByRoot(
  paths: readonly string[],
  configuredRoots: readonly string[],
): Array<{ root: string; paths: string[] }> {
  const groups = configuredRoots.map((root) => ({ root, paths: [] as string[] }))
  for (const filePath of paths) {
    const normalizedPath = normalizeWindowsPath(filePath)
    const group = groups.find(({ root }) => {
      const normalizedRoot = normalizeWindowsPath(root)
      return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}\\`)
    })
    if (group) group.paths.push(filePath)
  }
  return groups.filter((group) => group.paths.length > 0)
}

export function getVideoRepairOutputDir(configuredRoot: string | undefined): string | null {
  const root = splitAutopilotVideoRoots(configuredRoot)[0]
  return root ? `${root}_autopilot_normalized` : null
}

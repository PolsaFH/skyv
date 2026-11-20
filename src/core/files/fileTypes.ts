const TEXT_EXT = new Set([
  'html', 'htm', 'php', 'phtml', 'inc', 'css', 'scss', 'sass', 'less', 'js', 'mjs', 'cjs', 'ts', 'jsx', 'tsx',
  'json', 'xml', 'svg', 'txt', 'md', 'csv', 'htaccess', 'ini', 'yml', 'yaml', 'map', 'webmanifest', 'tpl', 'twig', 'vue'
])

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  bmp: 'image/bmp',
  svg: 'image/svg+xml'
}

export function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? ''
  if (base.startsWith('.') && !base.slice(1).includes('.')) return base.slice(1).toLowerCase()
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i + 1).toLowerCase() : ''
}

export function isTextPath(path: string): boolean {
  return TEXT_EXT.has(extensionOf(path))
}

export function isImagePath(path: string): boolean {
  return extensionOf(path) in IMAGE_MIME
}

export function imageMime(path: string): string | undefined {
  return IMAGE_MIME[extensionOf(path)]
}

/** Heuristic: content with a NUL byte in the first 8 KB is binary. */
export function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** Max size of a text file Skyv keeps a copy of, for showing what changed. */
export const MAX_TEXT_COPY_BYTES = 1024 * 1024

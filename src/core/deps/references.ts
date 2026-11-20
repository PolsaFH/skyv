import { extensionOf } from '../files/fileTypes'

export interface RawReference {
  /** The reference exactly as written, e.g. "../css/stil.css?v=2". */
  ref: string
  line: number
}

export interface ResolvedReference extends RawReference {
  /** Site-relative path it points to, e.g. "css/stil.css". */
  path: string
  /** True for links to folders ("om-oss/"), which mean the folder's index file. */
  isFolder: boolean
}

const SCANNABLE = new Set(['html', 'htm', 'php', 'phtml', 'inc', 'css', 'js', 'mjs'])

export function canHaveReferences(path: string): boolean {
  return SCANNABLE.has(extensionOf(path))
}

function lineAt(text: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < text.length; i++) if (text.charCodeAt(i) === 10) n++
  return n
}

function push(out: RawReference[], text: string, index: number, ref: string): void {
  const r = ref.trim()
  if (r) out.push({ ref: r, line: lineAt(text, index) })
}

function cssRefs(text: string, out: RawReference[], offset = 0, full = text): void {
  for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) push(out, full, offset + m.index!, m[2])
  for (const m of text.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) push(out, full, offset + m.index!, m[2])
}

function jsRefs(text: string, out: RawReference[], offset = 0, full = text): void {
  for (const m of text.matchAll(/\bimport\s+(?:[\w*{}\s,$]+\s+from\s+)?(['"])([^'"]+)\1/g)) push(out, full, offset + m.index!, m[2])
  for (const m of text.matchAll(/\bimport\(\s*(['"])([^'"]+)\1\s*\)/g)) push(out, full, offset + m.index!, m[2])
  for (const m of text.matchAll(/\bexport\s+[\w*{}\s,$]+\s+from\s+(['"])([^'"]+)\1/g)) push(out, full, offset + m.index!, m[2])
  for (const m of text.matchAll(/\bimportScripts\(\s*(['"])([^'"]+)\1/g)) push(out, full, offset + m.index!, m[2])
}

function phpRefs(text: string, out: RawReference[]): void {
  // include 'x.php'; require_once("inc/x.php"); include __DIR__ . '/x.php'; include dirname(__FILE__) . '/x.php';
  const re = /\b(?:include|include_once|require|require_once)\b\s*\(?\s*(?:(__DIR__|dirname\(\s*__FILE__\s*\))\s*\.\s*)?(['"])([^'"$]+)\2/gi
  for (const m of text.matchAll(re)) {
    const viaDir = Boolean(m[1])
    // Paths built from __DIR__ are relative to the file; strip the leading slash they always have.
    push(out, text, m.index!, viaDir ? `./${m[3].replace(/^\/+/, '')}` : m[3])
  }
}

function htmlRefs(text: string, out: RawReference[]): void {
  for (const m of text.matchAll(/\s(src|href|poster|data-src|action)\s*=\s*(["'])([^"']*)\2/gi)) {
    push(out, text, m.index!, m[3])
  }
  for (const m of text.matchAll(/\s(?:srcset|data-srcset)\s*=\s*(["'])([^"']*)\1/gi)) {
    for (const part of m[2].split(',')) push(out, text, m.index!, part.trim().split(/\s+/)[0] ?? '')
  }
  // Double- and single-quoted values separately, so url('x') inside style="..." is kept whole.
  for (const m of text.matchAll(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) cssRefs(m[1] ?? m[2], out, m.index!, text)
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) cssRefs(m[1], out, m.index! + m[0].indexOf(m[1]), text)
  for (const m of text.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)) jsRefs(m[1], out, m.index! + m[0].indexOf(m[1]), text)
}

/** Extract references to other files from a page, stylesheet, script or PHP file. */
export function extractReferences(path: string, text: string): RawReference[] {
  const ext = extensionOf(path)
  const out: RawReference[] = []
  if (ext === 'css') cssRefs(text, out)
  else if (ext === 'js' || ext === 'mjs') jsRefs(text, out)
  else if (ext === 'html' || ext === 'htm') htmlRefs(text, out)
  else if (ext === 'php' || ext === 'phtml' || ext === 'inc') {
    htmlRefs(text, out)
    phpRefs(text, out)
  }
  return out
}

/** References that point somewhere else entirely (other sites, anchors, mail, data, templates). */
export function isExternal(ref: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(ref) || // http:, https:, mailto:, tel:, data:, javascript:, file:
    ref.startsWith('//') ||
    ref.startsWith('#') ||
    ref.startsWith('?') ||
    /[{}<>$`]/.test(ref) || // template placeholders like {{ x }} or <?= ?> or ${x}
    ref === '' ||
    ref === '/'
  )
}

/** Bare module names like "react" are not files. */
function isBareModule(ref: string, fromPath: string): boolean {
  const ext = extensionOf(fromPath)
  return (ext === 'js' || ext === 'mjs') && !ref.startsWith('.') && !ref.startsWith('/')
}

/**
 * Resolve a reference relative to the file it appears in.
 * Returns null for external links and for paths that leave the site folder.
 */
export function resolveReference(fromPath: string, raw: RawReference): ResolvedReference | null {
  if (isExternal(raw.ref) || isBareModule(raw.ref, fromPath)) return null
  let ref = raw.ref.split('#')[0].split('?')[0]
  try {
    ref = decodeURIComponent(ref)
  } catch {
    /* keep as written */
  }
  if (!ref) return null
  const isFolder = ref.endsWith('/')
  const baseParts = ref.startsWith('/') ? [] : fromPath.split('/').slice(0, -1)
  const parts = [...baseParts]
  for (const seg of ref.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else parts.push(seg)
  }
  return { ...raw, path: parts.join('/'), isFolder }
}

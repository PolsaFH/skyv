import { createServer, type Server } from 'node:http'
import { createReadStream, promises as fs } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { IgnoreMatcher } from '../scan/ignoreRules'
import { extensionOf } from '../files/fileTypes'

const MIME: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  webmanifest: 'application/manifest+json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  pdf: 'application/pdf'
}

export interface LocalServer {
  url: string
  stop: () => Promise<void>
}

/**
 * Tiny web server for previewing a static site folder. Listens on 127.0.0.1 only, never serves
 * files outside the folder, hidden files (.env, .git …) or files on the site's ignore list.
 */
export async function startStaticServer(root: string, ignore?: IgnoreMatcher): Promise<LocalServer> {
  const realRoot = await fs.realpath(root)
  const server: Server = createServer(async (req, res) => {
    const notFound = () => {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<!doctype html><meta charset="utf-8"><title>Finnes ikke</title><p>Filen finnes ikke i mappen.</p>')
    }
    try {
      let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
      if (path.split('/').some((seg) => seg.startsWith('.') && seg !== '')) return notFound()
      const rel = path.replace(/^\/+/, '')
      if (rel && ignore?.(rel.replace(/\/$/, ''), path.endsWith('/'))) return notFound()
      let abs = normalize(join(realRoot, rel))
      if (abs !== realRoot && !abs.startsWith(realRoot + sep)) return notFound()
      let st = await fs.stat(abs).catch(() => null)
      if (st?.isDirectory()) {
        if (!path.endsWith('/')) {
          res.writeHead(301, { Location: `${path}/` })
          return res.end()
        }
        for (const idx of ['index.html', 'index.htm']) {
          const cand = join(abs, idx)
          const s2 = await fs.stat(cand).catch(() => null)
          if (s2?.isFile()) {
            abs = cand
            st = s2
            path = path + idx
            break
          }
        }
      }
      if (!st?.isFile()) return notFound()
      // Symbolic links must not lead out of the folder.
      const real = await fs.realpath(abs)
      if (real !== realRoot && !real.startsWith(realRoot + sep)) return notFound()
      res.writeHead(200, {
        'Content-Type': MIME[extensionOf(abs)] ?? 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-store'
      })
      if (req.method === 'HEAD') return res.end()
      createReadStream(real).pipe(res)
    } catch {
      notFound()
    }
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve())
  })
  const port = (server.address() as AddressInfo).port
  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

/**
 * Router for PHP's built-in server: refuses hidden files (.env, .git …) and otherwise lets PHP
 * serve the file as usual. Written to a file outside the site folder.
 */
export const PHP_ROUTER = `<?php
$p = urldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?? '/');
if (preg_match('#(^|/)\\.#', $p)) { http_response_code(404); header('Content-Type: text/html; charset=utf-8'); echo 'Filen finnes ikke i mappen.'; return true; }
return false;
`

// Worker thread: scans and hashes a site folder so the app stays responsive with thousands of files.
// Imports only the scanner and ignore rules, and those are bundled into this file, so the worker
// can run from outside the app archive (see asarUnpack in package.json).
import { parentPort } from 'node:worker_threads'
import { scanFolder, type HashCache } from '../core/scan/scanner'
import { createIgnoreMatcher, type IgnoreOptions } from '../core/scan/ignoreRules'

interface Job {
  root: string
  ignore: IgnoreOptions
  cache: HashCache
}

parentPort?.on('message', async (job: Job) => {
  try {
    const res = await scanFolder(job.root, {
      ignore: createIgnoreMatcher(job.ignore),
      cache: job.cache,
      onProgress: (p) => parentPort?.postMessage({ type: 'progress', progress: p })
    })
    parentPort?.postMessage({ type: 'done', result: { files: [...res.files.values()], cache: res.cache, warnings: res.warnings, ignoredCount: res.ignoredCount } })
  } catch (err) {
    parentPort?.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
})

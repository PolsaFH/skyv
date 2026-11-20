import { Worker } from 'node:worker_threads'
import { sep } from 'node:path'
import scanWorkerPath from './scanWorker?modulePath'
import type { ScanFn, ScanOutput } from '../core/workspace'
import type { ScanProgress } from '../core/scan/scanner'

/** Run the scan in a worker thread. */
export const workerScan: ScanFn = (root, ignore, cache, onProgress) =>
  new Promise<ScanOutput>((resolve, reject) => {
    // In the packaged app the worker is unpacked from the archive (see asarUnpack in package.json).
    const worker = new Worker(scanWorkerPath.replace(`app.asar${sep}`, `app.asar.unpacked${sep}`))
    worker.on('message', (msg: { type: string; progress?: ScanProgress; result?: ScanOutput; message?: string }) => {
      if (msg.type === 'progress' && msg.progress) onProgress?.(msg.progress)
      else if (msg.type === 'done') {
        resolve(msg.result!)
        void worker.terminate()
      } else if (msg.type === 'error') {
        reject(new Error(msg.message))
        void worker.terminate()
      }
    })
    worker.on('error', reject)
    worker.postMessage({ root, ignore, cache })
  })


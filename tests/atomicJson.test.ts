import { describe, it, expect, afterEach } from 'vitest'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readJson, writeJsonAtomic, Mutex } from '../src/core/storage/atomicJson'
import { makeTmpDir } from './helpers/tmp'

let cleanup: () => Promise<void> = async () => {}
afterEach(() => cleanup())

describe('atomic JSON storage', () => {
  it('returns fallback for missing file and round-trips data', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const f = join(t.dir, 'nested', 'a.json')
    expect(await readJson(f, { x: 0 })).toEqual({ x: 0 })
    await writeJsonAtomic(f, { x: 1, navn: 'æøå' })
    expect(await readJson(f, null)).toEqual({ x: 1, navn: 'æøå' })
  })

  it('leaves no temp files behind', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const f = join(t.dir, 'a.json')
    await Promise.all(Array.from({ length: 20 }, (_, i) => writeJsonAtomic(f, { i })))
    expect(await readdir(t.dir)).toEqual(['a.json'])
    const parsed = JSON.parse(await readFile(f, 'utf8'))
    expect(typeof parsed.i).toBe('number')
  })

  it('moves a corrupt file aside instead of deleting it', async () => {
    const t = await makeTmpDir()
    cleanup = t.cleanup
    const f = join(t.dir, 'a.json')
    await writeFile(f, '{ not json')
    expect(await readJson(f, 'fallback')).toBe('fallback')
    const files = await readdir(t.dir)
    expect(files.some((n) => n.startsWith('a.json.corrupt-'))).toBe(true)
  })

  it('mutex runs tasks in order even when one fails', async () => {
    const m = new Mutex()
    const order: number[] = []
    const a = m.run(async () => {
      await new Promise((r) => setTimeout(r, 20))
      order.push(1)
    })
    const b = m.run(async () => {
      order.push(2)
      throw new Error('x')
    })
    const c = m.run(async () => order.push(3))
    await a
    await expect(b).rejects.toThrow('x')
    await c
    expect(order).toEqual([1, 2, 3])
  })
})

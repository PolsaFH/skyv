import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export async function makeTmpDir(prefix = 'skyv-test-'): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** Fake encryptor for tests: reversible but never stores plaintext as-is. */
export const fakeEncryptor = {
  available: true,
  isAvailable() {
    return this.available
  },
  encrypt(plain: string) {
    return Buffer.from(Buffer.from(plain, 'utf8').map((b) => b ^ 0x5a))
  },
  decrypt(data: Buffer) {
    return Buffer.from(data.map((b) => b ^ 0x5a)).toString('utf8')
  }
}

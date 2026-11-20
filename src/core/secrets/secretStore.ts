import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomic } from '../storage/atomicJson'
import { UserError } from '../errors'

/**
 * Encrypts and decrypts strings. In the app this is Electron's `safeStorage`,
 * whose key lives in the macOS keychain. Tests use a fake.
 */
export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

/**
 * Stores secrets (FTP passwords, API key) encrypted on disk, one file per key.
 * Plaintext only exists in memory for the moment it is needed. Never logged.
 */
export class SecretStore {
  constructor(
    private readonly dir: string,
    private readonly encryptor: Encryptor
  ) {}

  private fileFor(key: string): string {
    if (!/^[a-z0-9-]{1,64}$/i.test(key)) throw new Error('Invalid secret key')
    return join(this.dir, `${key}.bin`)
  }

  private ensureAvailable(): void {
    if (!this.encryptor.isAvailable()) {
      throw new UserError(
        'Får ikke tilgang til nøkkelringen på Macen.',
        'Lås opp Macen og prøv igjen. Skyv lagrer aldri passord uten kryptering.'
      )
    }
  }

  async set(key: string, value: string): Promise<void> {
    this.ensureAvailable()
    await fs.mkdir(this.dir, { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.fileFor(key), this.encryptor.encrypt(value), 0o600)
  }

  async get(key: string): Promise<string | undefined> {
    let data: Buffer
    try {
      data = await fs.readFile(this.fileFor(key))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw err
    }
    this.ensureAvailable()
    try {
      return this.encryptor.decrypt(data)
    } catch {
      throw new UserError('Klarte ikke å lese det lagrede passordet.', 'Skriv inn passordet på nytt i innstillingene for nettsiden.')
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      await fs.access(this.fileFor(key))
      return true
    } catch {
      return false
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.fileFor(key), { force: true })
  }
}

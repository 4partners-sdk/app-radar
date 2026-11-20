// Encryption for everything that leaves the runner: the database in the `data` branch and the parallel jobs'
// results (Actions artifacts), so both can live in a public repository. AES-256-GCM over gzip.
// Key: DATA_KEY = 32 random bytes, base64 (`openssl rand -base64 32`). Without it files stay plain JSON (local work).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

const MAGIC = Buffer.from('ARD1')

export function dataKey(): Buffer | undefined {
  const raw = process.env.DATA_KEY?.trim()
  // in CI the data must never be written in the clear (the repository may be public)
  if (!raw && process.env.REQUIRE_ENCRYPTION === 'true') throw new Error('DATA_KEY is not set — refusing to write unencrypted data')
  if (!raw) return undefined
  const key = Buffer.from(raw, 'base64')
  if (key.length !== 32) throw new Error('DATA_KEY must be 32 bytes in base64 — create one with: openssl rand -base64 32')
  return key
}

export function seal(text: string, key: Buffer): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(gzipSync(text)), cipher.final()])
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body])
}

export function open(data: Buffer, key: Buffer): string {
  if (!data.subarray(0, 4).equals(MAGIC)) throw new Error('not an encrypted App Radar file')
  const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(4, 16))
  decipher.setAuthTag(data.subarray(16, 32))
  // a wrong key or a damaged file fails here instead of yielding garbage
  return gunzipSync(Buffer.concat([decipher.update(data.subarray(32)), decipher.final()])).toString('utf8')
}

export const isSealed = (data: Buffer) => data.subarray(0, 4).equals(MAGIC)

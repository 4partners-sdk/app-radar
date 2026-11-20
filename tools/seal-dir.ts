// `node tools/seal-dir.ts <from> <to>` — writes every <from>/*.json as <to>/*.json.enc, encrypted with DATA_KEY,
// after checking that each one is JSON and that the encrypted copy reads back. Used by tools/import-local.sh.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dataKey, open, seal } from '../collector/crypto.ts'

const [from, to] = process.argv.slice(2)
if (!from || !to) throw new Error('usage: node tools/seal-dir.ts <from> <to>')
const key = dataKey()
if (!key) throw new Error('DATA_KEY is not set')

const names = readdirSync(from).filter(f => f.endsWith('.json'))
if (!names.includes('global.json')) throw new Error(`${from} has no global.json — is it a state folder?`)
for (const name of names) {
  const text = readFileSync(join(from, name), 'utf8')
  JSON.parse(text) // a damaged file stops here
  const sealed = seal(text, key)
  if (open(sealed, key) !== text) throw new Error(`${name}: the encrypted copy does not read back`)
  writeFileSync(join(to, name + '.enc'), sealed)
}
console.log(`encrypted ${names.length} files`)

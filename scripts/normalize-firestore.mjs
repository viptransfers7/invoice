import fs from 'node:fs/promises'
import path from 'node:path'

const sourceDir = process.argv[2] ?? 'backups/firestore-2026-08-28'

function decode(value) {
  if (!value || typeof value !== 'object') return null
  if ('nullValue' in value) return null
  if ('stringValue' in value) return value.stringValue
  if ('integerValue' in value) return Number(value.integerValue)
  if ('doubleValue' in value) return Number(value.doubleValue)
  if ('booleanValue' in value) return value.booleanValue
  if ('timestampValue' in value) return value.timestampValue
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode)
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {})
  return null
}

function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, decode(value)]))
}

async function decodeCollection(name) {
  const raw = JSON.parse(await fs.readFile(path.join(sourceDir, `${name}.firestore.json`), 'utf8'))
  if (raw.nextPageToken) throw new Error(`${name} backup is paginated; fetch remaining pages before migration`)
  return (raw.documents ?? []).map((document) => ({
    _firestorePath: document.name,
    _createdAt: document.createTime,
    _updatedAt: document.updateTime,
    ...decodeFields(document.fields ?? {}),
  }))
}

const [invoices, clients, settings] = await Promise.all([
  decodeCollection('invoices'),
  decodeCollection('clients'),
  decodeCollection('settings'),
])

const backup = {
  version: 1,
  source: 'Firestore viptransferskorea-5b29b',
  exportedAt: new Date().toISOString(),
  invoices,
  clients,
  settings,
}

await fs.writeFile(path.join(sourceDir, 'normalized-backup.json'), `${JSON.stringify(backup, null, 2)}\n`)

const totals = invoices.reduce((result, invoice) => {
  const currency = invoice.currency || 'UNKNOWN'
  result[currency] = (result[currency] ?? 0) + Number(invoice.total || 0)
  return result
}, {})

const report = {
  invoices: invoices.length,
  clients: clients.length,
  settings: settings.length,
  totals,
  duplicateInvoiceNumbers: Object.entries(
    invoices.reduce((result, invoice) => {
      result[invoice.number] = (result[invoice.number] ?? 0) + 1
      return result
    }, {}),
  ).filter(([, count]) => count > 1),
}

await fs.writeFile(path.join(sourceDir, 'backup-report.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))

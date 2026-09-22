import fs from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

const source = process.argv[2] ?? 'backups/firestore-2026-08-28/normalized-backup.json'
const dryRun = !process.argv.includes('--commit')
const backup = JSON.parse(await fs.readFile(source, 'utf8'))

const invoiceNumbers = new Set()
const problems = []
for (const invoice of backup.invoices) {
  if (!invoice.number) problems.push(`missing invoice number: ${invoice.id}`)
  if (invoiceNumbers.has(invoice.number)) problems.push(`duplicate invoice number: ${invoice.number}`)
  invoiceNumbers.add(invoice.number)
  if (!['USD', 'KRW'].includes(invoice.currency)) problems.push(`invalid currency: ${invoice.number}`)
}

console.log(JSON.stringify({ mode: dryRun ? 'dry-run' : 'commit', invoices: backup.invoices.length, clients: backup.clients.length, problems }, null, 2))
if (dryRun) process.exit(problems.length ? 2 : 0)
if (problems.length) throw new Error('Resolve validation errors before importing')

const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_USER_ID']
for (const name of required) if (!process.env[name]) throw new Error(`Missing ${name}`)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
let organizationId = process.env.SUPABASE_ORGANIZATION_ID
if (!organizationId) {
  const { data, error } = await supabase.from('organizations').insert({ name: 'VIP Transfers Korea' }).select('id').single()
  if (error) throw error
  organizationId = data.id
  const { error: memberError } = await supabase.from('organization_members').insert({ organization_id: organizationId, user_id: process.env.SUPABASE_USER_ID, role: 'admin' })
  if (memberError) throw memberError
}

const sourceSettings = backup.settings[0] ?? {
  nameEn: 'The One Concierge Service',
  address: 'Unit 325, 66 Gonghang-ro 424beon-gil, Jung-gu, Incheon, Korea',
  email: 'info@viptransferskorea.com', phone: '+82 10-9668-4313', bank: 'Shinhan Bank',
  bankAddress: '120, 2-90 Taepyeong-ro, Chung-gu, Seoul, Korea', accountName: 'The One Concierge Service',
  accountNo: '180008736850', swift: 'SHBKKRSE', paypal: '',
}
const { error: settingsError } = await supabase.from('company_settings').upsert({
  organization_id: organizationId, company_name: sourceSettings.nameEn || 'VIP Transfers Korea', address: sourceSettings.address || '',
  email: sourceSettings.email || '', phone: sourceSettings.phone || '', bank_name: sourceSettings.bank || '', bank_address: sourceSettings.bankAddress || '',
  account_name: sourceSettings.accountName || '', account_number: sourceSettings.accountNo || '', swift_code: sourceSettings.swift || '', paypal: sourceSettings.paypal || '',
})
if (settingsError) throw settingsError

const clientByFingerprint = new Map()
for (const client of backup.clients) {
  const payload = {
    organization_id: organizationId,
    company_name: client.name || 'Unknown client',
    contact_name: client.contact || '', email: client.email || '', phone: client.phone || '', address: client.address || '', notes: client.notes || '',
    legacy_id: client._firestorePath?.split('/').pop() || null, created_by: process.env.SUPABASE_USER_ID,
  }
  const { data, error } = await supabase.from('clients').upsert(payload, { onConflict: 'organization_id,legacy_id' }).select('id').single()
  if (error) throw error
  clientByFingerprint.set(`${payload.company_name.toLowerCase()}|${payload.contact_name.toLowerCase()}`, data.id)
}

for (const invoice of backup.invoices) {
  const clientId = clientByFingerprint.get(`${(invoice.clientCompany || '').toLowerCase()}|${(invoice.clientContact || '').toLowerCase()}`) || null
  const status = invoice.status === 'unpaid' ? 'sent' : invoice.status === 'overdue' ? 'sent' : invoice.status
  const payload = {
    organization_id: organizationId, client_id: clientId, invoice_number: invoice.number, status,
    issue_date: invoice.date || null, due_date: invoice.due || null, currency: invoice.currency,
    bill_to_name: invoice.clientCompany || '', bill_to_contact: invoice.clientContact || '', bill_to_email: invoice.clientEmail || '', bill_to_address: invoice.clientAddress || '',
    vat_mode: invoice.vatOption === 'include' ? 'inclusive' : Number(invoice.vatRate || 0) === 0 ? 'none' : 'exclusive', vat_rate: Number(invoice.vatRate || 0),
    subtotal: Number(invoice.subtotal || 0), vat_amount: Number(invoice.vat || 0), total: Number(invoice.total || 0), notes: invoice.notes || '',
    payment_method: invoice.paymentMethod || 'bank', payment_link_url: invoice.paymentLinkUrl || '', legacy_id: String(invoice.id),
    created_by: process.env.SUPABASE_USER_ID, updated_by: process.env.SUPABASE_USER_ID, issued_at: invoice._createdAt || new Date().toISOString(),
  }
  const { data: saved, error } = await supabase.from('invoices').upsert(payload, { onConflict: 'organization_id,legacy_id' }).select('id').single()
  if (error) throw error
  const items = (invoice.items || []).filter((item) => item.desc || Number(item.amount)).map((item, index) => ({ invoice_id: saved.id, service_date: item.date || null, vehicle: item.vehicle || '', description: item.desc || 'Service', quantity: 1, unit_price: Number(item.amount || 0), amount: Number(item.amount || 0), sort_order: index }))
  await supabase.from('invoice_items').delete().eq('invoice_id', saved.id)
  if (items.length) { const { error: itemsError } = await supabase.from('invoice_items').insert(items); if (itemsError) throw itemsError }
  if (invoice.status === 'paid' && Number(invoice.total) > 0) {
    const { count } = await supabase.from('payments').select('id', { count: 'exact', head: true }).eq('invoice_id', saved.id)
    if (!count) {
      const { error: paymentError } = await supabase.from('payments').insert({ organization_id: organizationId, invoice_id: saved.id, amount: Number(invoice.total), currency: invoice.currency, payment_date: invoice.paymentDate || invoice.due || invoice.date, method: 'legacy_import', notes: invoice.paymentNotes || 'Imported paid status', created_by: process.env.SUPABASE_USER_ID })
      if (paymentError) throw paymentError
    }
  }
}

console.log(`Imported into organization ${organizationId}`)

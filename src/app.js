import './styles.css'
import { configured, supabase } from './lib/supabase.js'
import { calculateTotals, formatMoney } from './lib/money.js'

const app = document.querySelector('#app')
const state = { session: null, member: null, page: 'dashboard', invoices: [], clients: [], settings: null, editing: null, items: [] }

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag)
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value)
    else if (value !== null && value !== undefined) node.setAttribute(key, value)
  })
  for (const child of Array.isArray(children) ? children : [children]) node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  return node
}

function showError(message) {
  const box = el('div', { class: 'notice error' }, message)
  document.querySelector('.main')?.prepend(box)
  setTimeout(() => box.remove(), 5000)
}

async function buildPdf(invoice, items) {
  const { createInvoicePdf } = await import('./pdf.js')
  return createInvoicePdf(invoice, items, state.settings)
}

function configScreen() {
  app.replaceChildren(el('main', { class: 'login-shell' }, el('section', { class: 'login-card' }, [
    el('div', { class: 'brand' }, 'VIP TRANSFERS KOREA'), el('h1', {}, 'Supabase setup required'),
    el('p', { class: 'muted' }, 'Copy .env.example to .env and add your project URL and publishable key. Then run the included SQL migration.'),
    el('pre', {}, 'npm install\nnpm run dev'),
  ])))
}

function loginScreen(message = '') {
  const email = el('input', { type: 'email', autocomplete: 'email', required: '' })
  const password = el('input', { type: 'password', autocomplete: 'current-password', required: '' })
  const form = el('form', { onsubmit: async (event) => {
    event.preventDefault()
    const button = form.querySelector('button')
    button.disabled = true
    const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: password.value })
    if (error) { messageNode.textContent = error.message; button.disabled = false }
  } }, [
    el('div', { class: 'brand' }, 'VIP TRANSFERS KOREA'), el('h1', {}, 'Invoice Admin'),
    el('p', { class: 'muted' }, 'Authorized team members only.'),
    el('div', { class: 'field' }, [el('label', {}, 'Email'), email]),
    el('div', { class: 'field' }, [el('label', {}, 'Password'), password]),
    el('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
  ])
  const messageNode = el('p', { class: 'muted' }, message)
  form.append(messageNode)
  app.replaceChildren(el('main', { class: 'login-shell' }, el('section', { class: 'login-card' }, form)))
}

async function loadContext() {
  const { data, error } = await supabase.from('organization_members').select('organization_id, role, organizations(name)').limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This account has not been assigned to an organization.')
  state.member = data
  await Promise.all([loadInvoices(), loadClients(), loadSettings()])
}

async function loadInvoices() {
  const { data, error } = await supabase.from('invoice_balances').select('*').eq('organization_id', state.member.organization_id).order('updated_at', { ascending: false })
  if (error) throw error
  state.invoices = data ?? []
}

async function loadClients() {
  const { data, error } = await supabase.from('clients').select('*').eq('organization_id', state.member.organization_id).order('company_name')
  if (error) throw error
  state.clients = data ?? []
}

async function loadSettings() {
  const { data } = await supabase.from('company_settings').select('*').eq('organization_id', state.member.organization_id).maybeSingle()
  state.settings = data
}

function navButton(label, page) {
  return el('button', { class: `nav-btn ${state.page === page ? 'active' : ''}`, onclick: () => { state.page = page; state.editing = null; renderApp() } }, label)
}

function shell(content, title, actions = []) {
  app.replaceChildren(el('div', { class: 'app-shell' }, [
    el('aside', { class: 'sidebar' }, [el('div', { class: 'brand' }, 'VIP INVOICE'), el('nav', {}, [navButton('Overview', 'dashboard'), navButton('Invoices', 'invoices'), navButton('New invoice', 'editor'), navButton('Clients', 'clients'), navButton('Company settings', 'settings')]), el('div', { class: 'sidebar-footer' }, [el('div', {}, state.member.organizations?.name || ''), el('div', {}, state.session.user.email), el('button', { class: 'nav-btn', onclick: () => supabase.auth.signOut() }, 'Sign out')])]),
    el('main', { class: 'main' }, [el('header', { class: 'topbar' }, [el('h1', {}, title), el('div', { class: 'actions' }, actions)]), content]),
  ]))
}

function displayStatus(invoice) {
  return invoice.is_overdue ? 'overdue' : invoice.status
}

function invoiceTable(invoices) {
  if (!invoices.length) return el('div', { class: 'empty' }, 'No invoices yet.')
  const tbody = el('tbody')
  invoices.forEach((invoice) => tbody.append(el('tr', {}, [
    el('td', {}, invoice.invoice_number || 'Draft'), el('td', {}, invoice.bill_to_name), el('td', {}, invoice.due_date || '-'),
    el('td', {}, formatMoney(invoice.balance_due ?? invoice.total, invoice.currency)), el('td', {}, el('span', { class: `badge ${displayStatus(invoice)}` }, displayStatus(invoice))),
    el('td', {}, el('button', { class: 'btn small', onclick: () => editInvoice(invoice.id) }, invoice.status === 'draft' ? 'Continue' : 'Open')),
  ])))
  return el('div', { class: 'table-wrap' }, el('table', {}, [el('thead', {}, el('tr', {}, ['Invoice', 'Client', 'Due', 'Balance', 'Status', ''].map((x) => el('th', {}, x)))), tbody]))
}

function renderDashboard() {
  const active = state.invoices.filter((i) => !['paid', 'void', 'cancelled'].includes(i.status))
  const draft = state.invoices.filter((i) => i.status === 'draft')
  const overdue = state.invoices.filter((i) => i.is_overdue)
  const outstanding = active.reduce((result, invoice) => { result[invoice.currency] = (result[invoice.currency] ?? 0) + Number(invoice.balance_due ?? invoice.total); return result }, {})
  const stats = el('div', { class: 'stats' }, [
    stat('Drafts', draft.length), stat('Overdue', overdue.length), stat('USD outstanding', formatMoney(outstanding.USD ?? 0, 'USD')), stat('KRW outstanding', formatMoney(outstanding.KRW ?? 0, 'KRW')),
  ])
  shell(el('div', {}, [stats, el('div', { class: 'grid-two' }, [el('section', { class: 'card' }, [el('h2', {}, 'Needs attention'), invoiceTable([...overdue, ...draft].slice(0, 8))]), el('section', { class: 'card' }, [el('h2', {}, 'Recent invoices'), invoiceTable(state.invoices.slice(0, 6))])])]), 'Overview', [el('button', { class: 'btn primary', onclick: () => { state.page = 'editor'; renderApp() } }, 'New invoice')])
}

function renderInvoices() {
  const search = el('input', { type: 'search', placeholder: 'Search invoice or client…' })
  const status = el('select', {}, ['all', 'draft', 'issued', 'sent', 'partially_paid', 'paid', 'overdue', 'void'].map((value) => el('option', { value }, value)))
  const results = el('div')
  const refresh = () => {
    const q = search.value.toLowerCase()
    results.replaceChildren(invoiceTable(state.invoices.filter((invoice) => (!q || `${invoice.invoice_number} ${invoice.bill_to_name}`.toLowerCase().includes(q)) && (status.value === 'all' || displayStatus(invoice) === status.value))))
  }
  search.addEventListener('input', refresh); status.addEventListener('change', refresh); refresh()
  shell(el('section', { class: 'card' }, [el('div', { class: 'form-grid' }, [el('div', { class: 'field' }, [el('label', {}, 'Search'), search]), el('div', { class: 'field' }, [el('label', {}, 'Status'), status])]), results]), 'Invoices', [el('button', { class: 'btn primary', onclick: () => { state.page = 'editor'; renderApp() } }, 'New invoice')])
}

async function editInvoice(id) {
  const invoice = state.invoices.find((item) => item.id === id)
  const { data: items, error } = await supabase.from('invoice_items').select('*').eq('invoice_id', id).order('sort_order')
  if (error) return showError(error.message)
  state.editing = invoice; state.items = items ?? []; state.page = 'editor'; renderApp()
}

function field(label, input, extraClass = '') { return el('div', { class: `field ${extraClass}` }, [el('label', {}, label), input]) }

function renderEditor() {
  const invoice = state.editing ?? { status: 'draft', currency: 'USD', issue_date: new Date().toISOString().slice(0,10), due_date: '', vat_mode: 'exclusive', vat_rate: 10, bill_to_name: '', bill_to_contact: '', bill_to_email: '', bill_to_address: '', notes: '' }
  if (!state.editing && !state.items.length) state.items = [{ service_date: '', vehicle: '', description: '', amount: 0 }]
  const company = el('input', { value: invoice.bill_to_name, required: '' }), contact = el('input', { value: invoice.bill_to_contact }), email = el('input', { value: invoice.bill_to_email, type: 'email' }), address = el('textarea', {}, invoice.bill_to_address), issueDate = el('input', { value: invoice.issue_date || '', type: 'date' }), dueDate = el('input', { value: invoice.due_date || '', type: 'date' }), currency = el('select', {}, ['USD','KRW'].map((x) => el('option', { value:x, ...(invoice.currency === x ? {selected:''}: {}) }, x))), vatMode = el('select', {}, [['exclusive','VAT excluded'],['inclusive','VAT included'],['none','No VAT']].map(([value,label]) => el('option', { value, ...(invoice.vat_mode === value ? {selected:''}: {}) }, label))), vatRate = el('input', { type:'number', min:'0', step:'0.01', value: invoice.vat_rate ?? 10 }), notes = el('textarea', {}, invoice.notes)
  const itemsBox = el('div'), totalsBox = el('div', { class: 'totals' })
  const readItems = () => [...itemsBox.querySelectorAll('.item-grid')].map((row, index) => ({ service_date: row.querySelector('[name=date]').value || null, vehicle: row.querySelector('[name=vehicle]').value, description: row.querySelector('[name=description]').value.trim(), amount: Number(row.querySelector('[name=amount]').value || 0), sort_order: index }))
  const updateTotals = () => { const totals = calculateTotals(readItems(), vatMode.value, vatMode.value === 'none' ? 0 : vatRate.value); totalsBox.replaceChildren(...[['Subtotal',totals.subtotal],['VAT',totals.vatAmount],['Total',totals.total]].map(([label,value], index) => el('div', { class:`total-row ${index===2?'grand':''}` }, [el('span',{},label),el('span',{},formatMoney(value,currency.value))]))) }
  const addItem = (item = {}) => {
    const row = el('div', { class: 'item-grid' })
    const values = [el('input',{name:'date',type:'date',value:item.service_date||''}), el('input',{name:'vehicle',placeholder:'Vehicle',value:item.vehicle||''}), el('input',{name:'description',class:'description',placeholder:'Service description',value:item.description||'',required:''}), el('input',{name:'amount',type:'number',step:'0.01',value:item.amount||0}), el('button',{type:'button',class:'btn danger small',onclick:()=>{row.remove();updateTotals()}},'×')]
    values.slice(0,4).forEach((input)=>input.addEventListener('input',updateTotals)); row.append(...values); itemsBox.append(row)
  }
  state.items.forEach(addItem); [currency,vatMode,vatRate].forEach((input)=>input.addEventListener('change',updateTotals)); updateTotals()
  const save = async (nextStatus = invoice.status || 'draft') => {
    const items = readItems(); if (!company.value.trim() || !items.some((x)=>x.description && x.amount !== 0)) return showError('Client and at least one non-zero service item are required.')
    if (dueDate.value && issueDate.value && dueDate.value < issueDate.value) return showError('Due date cannot be earlier than issue date.')
    const totals = calculateTotals(items, vatMode.value, vatMode.value === 'none' ? 0 : vatRate.value)
    const payload = { organization_id: state.member.organization_id, status: nextStatus, issue_date: issueDate.value || null, due_date: dueDate.value || null, currency: currency.value, bill_to_name: company.value.trim(), bill_to_contact: contact.value.trim(), bill_to_email: email.value.trim(), bill_to_address: address.value.trim(), vat_mode: vatMode.value, vat_rate: vatMode.value === 'none' ? 0 : Number(vatRate.value), subtotal: totals.subtotal, vat_amount: totals.vatAmount, total: totals.total, notes: notes.value, created_by: invoice.created_by || state.session.user.id, updated_by: state.session.user.id }
    const query = state.editing ? supabase.from('invoices').update(payload).eq('id', state.editing.id) : supabase.from('invoices').insert(payload)
    const { data: saved, error } = await query.select().single(); if (error) return showError(error.message)
    if (saved.status === 'draft') {
      const { error: deleteError } = await supabase.from('invoice_items').delete().eq('invoice_id', saved.id); if (deleteError) return showError(deleteError.message)
      const { error: itemError } = await supabase.from('invoice_items').insert(items.map((item) => ({ ...item, invoice_id: saved.id }))); if (itemError) return showError(itemError.message)
    }
    await supabase.from('invoice_events').insert({ organization_id: state.member.organization_id, invoice_id: saved.id, event_type: state.editing ? (nextStatus === 'draft' ? 'updated' : 'issued') : 'draft_created', actor_id: state.session.user.id })
    await loadInvoices(); state.editing = null; state.items = []; state.page = 'invoices'; renderApp()
  }
  const actions = []
  if (!state.editing || state.editing.status === 'draft') actions.push(el('button',{class:'btn',onclick:()=>save('draft')},'Save draft'))
  if (state.editing?.status === 'draft' && ['admin','accounting'].includes(state.member.role)) actions.push(el('button',{class:'btn primary',onclick:()=>save('issued')},'Issue invoice'))
  if (state.editing && state.editing.status !== 'draft' && ['admin','accounting'].includes(state.member.role)) actions.push(el('button',{class:'btn primary',onclick:async()=>{
    const amount=Number(window.prompt(`Payment amount (${state.editing.currency})`,String(state.editing.balance_due||''))); if(!Number.isFinite(amount)||amount<=0)return
    if(amount>Number(state.editing.balance_due))return showError('Payment cannot exceed the outstanding balance.')
    const paymentDate=window.prompt('Payment date (YYYY-MM-DD)',new Date().toISOString().slice(0,10)); if(!paymentDate)return
    const {error}=await supabase.from('payments').insert({organization_id:state.member.organization_id,invoice_id:state.editing.id,amount,currency:state.editing.currency,payment_date:paymentDate,created_by:state.session.user.id}); if(error)return showError(error.message)
    await supabase.from('invoice_events').insert({organization_id:state.member.organization_id,invoice_id:state.editing.id,event_type:'payment_recorded',details:{amount,currency:state.editing.currency},actor_id:state.session.user.id})
    await loadInvoices();state.editing=null;state.items=[];state.page='invoices';renderApp()
  }},'Record payment'))
  if (state.editing) actions.push(el('button',{class:'btn',onclick:async()=>{const pdf=await buildPdf(invoice,state.items);pdf.output('dataurlnewwindow')}},'Preview PDF'), el('button',{class:'btn',onclick:async()=>{const pdf=await buildPdf(invoice,state.items);pdf.save(`${invoice.invoice_number||'draft'}.pdf`)}},'Download PDF'))
  const locked = state.editing && state.editing.status !== 'draft'
  const form = el('form',{class:'card',onsubmit:(event)=>{event.preventDefault();if(!locked)save('draft')}},[el('div',{class:'form-grid'},[field('Client company',company),field('Contact',contact),field('Email',email),field('Address',address),field('Issue date',issueDate),field('Due date',dueDate),field('Currency',currency),field('VAT treatment',vatMode),field('VAT rate (%)',vatRate),field('Notes',notes,'span-2')]),el('h2',{},'Service items'),itemsBox,...(locked?[]:[el('button',{type:'button',class:'btn',onclick:()=>{addItem();updateTotals()}},'Add item')]),totalsBox])
  if (locked) form.querySelectorAll('input,select,textarea').forEach((control)=>control.disabled=true)
  shell(form,invoice.invoice_number||'New invoice',actions)
}

function renderClients() {
  const tbody = el('tbody'); state.clients.forEach((client)=>tbody.append(el('tr',{},[el('td',{},client.company_name),el('td',{},client.contact_name),el('td',{},client.email),el('td',{},client.phone)])))
  shell(el('section',{class:'card'}, state.clients.length ? el('div',{class:'table-wrap'},el('table',{},[el('thead',{},el('tr',{},['Company','Contact','Email','Phone'].map(x=>el('th',{},x)))),tbody])) : el('div',{class:'empty'},'No clients yet. Clients can be added during migration or through the database.')), 'Clients')
}

function renderSettings() {
  const settings = state.settings || {}; const names = [['company_name','Company name'],['address','Address'],['email','Email'],['phone','Phone'],['bank_name','Bank'],['bank_address','Bank address'],['account_name','Account name'],['account_number','Account number'],['swift_code','SWIFT'],['paypal','PayPal']]
  const inputs = Object.fromEntries(names.map(([name])=>[name,el('input',{value:settings[name]||''})])); const form = el('form',{class:'card',onsubmit:async(event)=>{event.preventDefault();const payload={organization_id:state.member.organization_id,...Object.fromEntries(names.map(([name])=>[name,inputs[name].value.trim()]))};const {error}=await supabase.from('company_settings').upsert(payload);if(error)return showError(error.message);await loadSettings();renderApp()}},[el('div',{class:'form-grid'},names.map(([name,label])=>field(label,inputs[name]))),el('button',{class:'btn primary',type:'submit'},'Save settings')])
  shell(form,'Company settings')
}

function stat(label, value) { return el('div',{class:'card'},[el('div',{class:'muted'},label),el('div',{class:'stat-value'},value)]) }
function renderApp() { ({dashboard:renderDashboard,invoices:renderInvoices,editor:renderEditor,clients:renderClients,settings:renderSettings}[state.page] || renderDashboard)() }

async function start() {
  if (!configured) return configScreen()
  const { data } = await supabase.auth.getSession(); state.session = data.session
  supabase.auth.onAuthStateChange(async (_event, session) => { state.session = session; if (!session) return loginScreen(); try { await loadContext(); renderApp() } catch (error) { loginScreen(error.message) } })
  if (!state.session) return loginScreen()
  try { await loadContext(); renderApp() } catch (error) { loginScreen(error.message) }
}

start()

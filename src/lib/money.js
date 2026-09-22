export function asMoney(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

export function calculateTotals(items, vatMode = 'exclusive', vatRate = 10) {
  const subtotal = asMoney(items.reduce((sum, item) => sum + asMoney(item.amount), 0))
  const rate = Math.max(0, asMoney(vatRate))
  const vatAmount = vatMode === 'exclusive' ? asMoney(subtotal * rate / 100) : 0
  return { subtotal, vatAmount, total: asMoney(subtotal + vatAmount) }
}

export function formatMoney(value, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(asMoney(value))
}

export function balanceDue(total, payments = []) {
  return asMoney(asMoney(total) - payments.reduce((sum, payment) => sum + asMoney(payment.amount), 0))
}

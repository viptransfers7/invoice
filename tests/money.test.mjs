import test from 'node:test'
import assert from 'node:assert/strict'
import { balanceDue, calculateTotals } from '../src/lib/money.js'

test('calculates exclusive VAT', () => {
  assert.deepEqual(calculateTotals([{ amount: 100 }, { amount: 50 }], 'exclusive', 10), {
    subtotal: 150,
    vatAmount: 15,
    total: 165,
  })
})

test('keeps VAT-inclusive total unchanged', () => {
  assert.deepEqual(calculateTotals([{ amount: 110 }], 'inclusive', 10), {
    subtotal: 110,
    vatAmount: 0,
    total: 110,
  })
})

test('calculates partial-payment balance', () => {
  assert.equal(balanceDue(1000, [{ amount: 200 }, { amount: 350 }]), 450)
})

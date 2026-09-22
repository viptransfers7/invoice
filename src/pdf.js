import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { formatMoney } from './lib/money.js'

export function createInvoicePdf(invoice, items, settings = {}) {
  const hasKorean = /[\u3131-\u318E\uAC00-\uD7A3]/.test(JSON.stringify({ invoice, items, settings }))
  if (hasKorean && !window.NOTO_REGULAR_B64) {
    throw new Error('한글 PDF 폰트를 불러오지 못했습니다. 페이지를 새로고침한 뒤 다시 시도해 주세요.')
  }

  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  if (window.NOTO_REGULAR_B64) {
    doc.addFileToVFS('NotoSansKR-Regular.ttf', window.NOTO_REGULAR_B64)
    doc.addFont('NotoSansKR-Regular.ttf', 'NotoSansKR', 'normal')
    const boldFont = window.NOTO_BOLD_B64 || window.NOTO_REGULAR_B64
    doc.addFileToVFS('NotoSansKR-Bold.ttf', boldFont)
    doc.addFont('NotoSansKR-Bold.ttf', 'NotoSansKR', 'bold')
    doc.setFont('NotoSansKR')
  }
  doc.setFillColor(16, 26, 45)
  doc.rect(0, 0, 210, 42, 'F')
  doc.setTextColor(207, 169, 81)
  doc.setFontSize(22)
  doc.text('INVOICE', 16, 22)
  doc.setFontSize(10)
  doc.setTextColor(255, 255, 255)
  doc.text(settings.company_name || 'VIP Transfers Korea', 194, 17, { align: 'right' })
  doc.text(invoice.invoice_number || 'DRAFT', 194, 24, { align: 'right' })

  doc.setTextColor(35, 42, 58)
  doc.setFontSize(9)
  doc.text(`Bill to: ${invoice.bill_to_name || ''}`, 16, 54)
  doc.text(invoice.bill_to_contact || '', 16, 60)
  doc.text(invoice.bill_to_email || '', 16, 66)
  doc.text(`Issue: ${invoice.issue_date || '-'}`, 194, 54, { align: 'right' })
  doc.text(`Due: ${invoice.due_date || '-'}`, 194, 60, { align: 'right' })

  autoTable(doc, {
    startY: 76,
    head: [['Date', 'Vehicle', 'Description', 'Amount']],
    body: items.map((item) => [item.service_date || '', item.vehicle || '', item.description || '', formatMoney(item.amount, invoice.currency)]),
    theme: 'grid',
    headStyles: { fillColor: [16, 26, 45], textColor: [255, 255, 255] },
    styles: { font: window.NOTO_REGULAR_B64 ? 'NotoSansKR' : 'helvetica', fontSize: 8 },
    columnStyles: { 3: { halign: 'right' } },
  })
  const y = doc.lastAutoTable.finalY + 10
  doc.text(`Subtotal  ${formatMoney(invoice.subtotal, invoice.currency)}`, 194, y, { align: 'right' })
  doc.text(`VAT  ${formatMoney(invoice.vat_amount, invoice.currency)}`, 194, y + 7, { align: 'right' })
  doc.setFontSize(13)
  doc.text(`TOTAL  ${formatMoney(invoice.total, invoice.currency)}`, 194, y + 16, { align: 'right' })
  doc.setFontSize(8)
  doc.text(invoice.notes || '', 16, Math.min(y + 30, 270), { maxWidth: 178 })
  return doc
}

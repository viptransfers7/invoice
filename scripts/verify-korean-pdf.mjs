import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fontSource = await fs.readFile(path.join(root, 'font.js'), 'utf8')
const regular = fontSource.match(/window\.NOTO_REGULAR_B64="([^"]+)"/)
const bold = fontSource.match(/window\.NOTO_BOLD_B64="([^"]+)"/)

if (!regular) throw new Error('Noto Sans KR regular font was not found in font.js')

globalThis.window = globalThis
globalThis.NOTO_REGULAR_B64 = regular[1]
globalThis.NOTO_BOLD_B64 = bold?.[1]
const { createInvoicePdf } = await import('../src/pdf.js')
const doc = createInvoicePdf(
  {
    invoice_number: 'INV-KO-FONT-CHECK',
    bill_to_name: '더 리스트 코리아',
    bill_to_contact: '담당자 김민수',
    bill_to_email: 'billing@example.com',
    issue_date: '2026-09-21',
    due_date: '2026-09-30',
    currency: 'KRW',
    subtotal: 550000,
    vat_amount: 55000,
    total: 605000,
    notes: '한글 폰트 출력 확인용 문서입니다.',
  },
  [
    {
      service_date: '2026-09-21',
      vehicle: '스프린터',
      description: '인천공항에서 서울 호텔까지 공항 픽업 서비스',
      amount: 550000,
    },
  ],
  { company_name: 'VIP 트랜스퍼 코리아' },
)

const outputDir = path.join(root, 'output', 'pdf')
await fs.mkdir(outputDir, { recursive: true })
await fs.writeFile(path.join(outputDir, 'korean-font-verification.pdf'), Buffer.from(doc.output('arraybuffer')))

// Payment service. Payments are simulated: a card number ending in 0 is declined.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 4003)
const RESERVATION_URL = process.env.RESERVATION_URL ?? 'http://localhost:4002'

const dataDir = join(import.meta.dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'payment.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, hold_id TEXT, amount INTEGER, status TEXT, created_at TEXT
  );
  -- at most one successful payment per hold
  CREATE UNIQUE INDEX IF NOT EXISTS one_success_per_hold ON payments (hold_id) WHERE status = 'succeeded';
`)

type Payment = { id: string; holdId: string; amount: number; status: 'succeeded' | 'failed' }
const PAYMENT_COLUMNS = 'id, hold_id AS holdId, amount, status'

const callReservation = (path: string, method = 'GET') =>
  fetch(RESERVATION_URL + path, { method, signal: AbortSignal.timeout(2000) })

const app = express()
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  res.set('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  next()
})
app.use(express.json())
app.get('/health', (_req, res) => res.json({ service: 'payment', status: 'ok' }))

app.post('/payments', async (req, res) => {
  const { holdId, holder, cardNumber } = req.body ?? {}
  if (
    typeof holdId !== 'string' || !/^[\w-]{1,64}$/.test(holdId) ||
    typeof holder !== 'string' || typeof cardNumber !== 'string' || !/^\d{16}$/.test(cardNumber)
  ) {
    return res.status(400).json({ error: 'invalid_request' })
  }
  // already paid: return the same payment
  const findPaid = () =>
    db.prepare(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE hold_id = ? AND status = 'succeeded'`).get(holdId) as
      | Payment
      | undefined
  const existing = findPaid()
  if (existing) return res.json(existing)

  try {
    const holdResponse = await callReservation(`/holds/${holdId}`)
    if (holdResponse.status === 404) return res.status(404).json({ error: 'unknown_hold' })
    const hold = (await holdResponse.json()) as { holder: string; price: number }
    if (hold.holder !== holder) return res.status(403).json({ error: 'not_your_hold' })

    const payment: Payment = {
      id: randomUUID(),
      holdId,
      amount: hold.price,
      status: cardNumber.endsWith('0') ? 'failed' : 'succeeded',
    }
    if (payment.status === 'succeeded') {
      // mark the seat as sold before recording the payment
      const sellResponse = await callReservation(`/holds/${holdId}/sell`, 'POST')
      if (sellResponse.status === 404) return res.status(409).json({ error: 'hold_expired' })
      if (!sellResponse.ok) throw new Error('sell failed')
    }
    try {
      db.prepare('INSERT INTO payments VALUES (?, ?, ?, ?, ?)')
        .run(payment.id, holdId, payment.amount, payment.status, new Date().toISOString())
    } catch {
      // a second request for the same hold finished first
      return res.json(findPaid())
    }
    res.status(payment.status === 'succeeded' ? 201 : 402).json(payment)
  } catch {
    res.status(503).json({ error: 'reservation_unavailable' })
  }
})

app.get('/payments/:id', (req, res) => {
  const payment = db.prepare(`SELECT ${PAYMENT_COLUMNS} FROM payments WHERE id = ?`).get(req.params.id)
  if (!payment) return res.status(404).json({ error: 'unknown_payment' })
  res.json(payment)
})

app.use((_req, res) => res.status(404).json({ error: 'not_found' }))
app.use(((error, _req, res, _next) => {
  const status = error.status ?? 500
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' })
}) as express.ErrorRequestHandler)

app.listen(PORT, () => console.log(`payment listening on ${PORT}`))

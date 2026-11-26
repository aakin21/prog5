// Reservation service: seat state. A seat without a row is free.
import express from 'express'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 4002)
const CATALOG_URL = process.env.CATALOG_URL ?? 'http://localhost:4001'
const LIVE_URL = process.env.LIVE_URL ?? 'http://localhost:4004'
const HOLD_SECONDS = Number(process.env.HOLD_SECONDS ?? 120)
const MAX_HOLDS_PER_USER = 4

const dataDir = join(import.meta.dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'reservation.db'))
db.exec(`
  -- copy of the seat plan from Catalog
  CREATE TABLE IF NOT EXISTS match_plans (match_id TEXT PRIMARY KEY, plan TEXT);
  -- one row per taken seat
  CREATE TABLE IF NOT EXISTS seats (
    match_id TEXT, seat_id TEXT, status TEXT, holder TEXT, hold_id TEXT UNIQUE,
    price INTEGER, expires_at INTEGER,
    PRIMARY KEY (match_id, seat_id)
  );
`)

const ID = /^[\w-]{1,64}$/

type Stand = { id: string; rows: number; seatsPerRow: number; price: number }
type SeatRow = {
  match_id: string; seat_id: string; status: 'held' | 'sold'; holder: string
  hold_id: string; price: number; expires_at: number | null
}

// seat plan: local copy first, otherwise ask Catalog
async function getPlan(matchId: string): Promise<Stand[] | 'unknown' | 'unavailable'> {
  if (!ID.test(matchId)) return 'unknown'
  const row = db.prepare('SELECT plan FROM match_plans WHERE match_id = ?').get(matchId) as { plan: string } | undefined
  if (row) return JSON.parse(row.plan)
  try {
    const response = await fetch(`${CATALOG_URL}/matches/${matchId}`, { signal: AbortSignal.timeout(2000) })
    if (response.status === 404) return 'unknown'
    if (!response.ok) return 'unavailable'
    const { stands } = (await response.json()) as { stands: Stand[] }
    db.prepare('INSERT OR REPLACE INTO match_plans VALUES (?, ?)').run(matchId, JSON.stringify(stands))
    return stands
  } catch {
    return 'unavailable'
  }
}

// seat id: stand-row-number, e.g. "N-3-12"
function priceOf(plan: Stand[], seatId: string): number | undefined {
  const [standId, rowNumber, seatNumber] = seatId.split('-')
  const stand = plan.find((s) => s.id === standId)
  const inRange = (value: string, max: number) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= max
  if (!stand || !inRange(rowNumber, stand.rows) || !inRange(seatNumber, stand.seatsPerRow)) return undefined
  // only the canonical spelling, so "N-01-1" cannot be a second "N-1-1"
  if (seatId !== `${stand.id}-${Number(rowNumber)}-${Number(seatNumber)}`) return undefined
  return stand.price
}

// fire and forget: a stopped Live service must not fail the request
// sent one after another, so changes reach Live in the order they happened
let notifications = Promise.resolve()
function notifyLive(seat: { matchId: string; seatId: string; status: 'held' | 'free' | 'sold'; holder?: string; expiresAt?: number }) {
  const body = JSON.stringify({ id: randomUUID(), ...seat })
  notifications = notifications.then(() =>
    fetch(`${LIVE_URL}/seat-changes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(1000),
    }).then(
      () => {},
      () => console.log(`live not reachable, seat change not pushed: ${seat.seatId} ${seat.status}`),
    ),
  )
}

function releaseExpiredHolds() {
  const expired = db
    .prepare("SELECT * FROM seats WHERE status = 'held' AND expires_at <= ?")
    .all(Date.now()) as SeatRow[]
  for (const seat of expired) {
    db.prepare("DELETE FROM seats WHERE hold_id = ? AND status = 'held'").run(seat.hold_id)
    notifyLive({ matchId: seat.match_id, seatId: seat.seat_id, status: 'free' })
  }
}

const findHold = (holdId: string) => db.prepare('SELECT * FROM seats WHERE hold_id = ?').get(holdId) as SeatRow | undefined

const app = express()
app.use(express.json())
app.get('/health', (_req, res) => res.json({ service: 'reservation', status: 'ok' }))

// all taken seats of a match
app.get('/matches/:matchId/seats', async (req, res) => {
  await getPlan(req.params.matchId)
  releaseExpiredHolds()
  const seats = db
    .prepare('SELECT seat_id AS seatId, status, holder, hold_id AS holdId, expires_at AS expiresAt FROM seats WHERE match_id = ?')
    .all(req.params.matchId)
  res.json({ matchId: req.params.matchId, now: Date.now(), seats })
})

app.post('/matches/:matchId/holds', async (req, res) => {
  const { matchId } = req.params
  const { seatId, holder } = req.body ?? {}
  if (typeof seatId !== 'string' || typeof holder !== 'string' || !holder.trim() || holder.length > 40) {
    return res.status(400).json({ error: 'invalid_request' })
  }
  const plan = await getPlan(matchId)
  if (plan === 'unavailable') return res.status(503).json({ error: 'catalog_unavailable' })
  const price = plan === 'unknown' ? undefined : priceOf(plan, seatId)
  if (price === undefined) return res.status(404).json({ error: 'unknown_seat' })

  releaseExpiredHolds()
  const { count } = db
    .prepare("SELECT COUNT(*) AS count FROM seats WHERE match_id = ? AND holder = ? AND status = 'held'")
    .get(matchId, holder) as { count: number }
  if (count >= MAX_HOLDS_PER_USER) return res.status(409).json({ error: 'too_many_holds' })

  const holdId = randomUUID()
  const expiresAt = Date.now() + HOLD_SECONDS * 1000
  try {
    db.prepare("INSERT INTO seats VALUES (?, ?, 'held', ?, ?, ?, ?)").run(matchId, seatId, holder, holdId, price, expiresAt)
  } catch {
    // seat already taken
    return res.status(409).json({ error: 'seat_taken' })
  }
  notifyLive({ matchId, seatId, status: 'held', holder, expiresAt })
  res.status(201).json({ holdId, matchId, seatId, price, expiresAt })
})

app.get('/holds/:holdId', (req, res) => {
  releaseExpiredHolds()
  const seat = findHold(req.params.holdId)
  if (!seat) return res.status(404).json({ error: 'unknown_hold' })
  res.json({ holdId: seat.hold_id, matchId: seat.match_id, seatId: seat.seat_id, holder: seat.holder, price: seat.price, status: seat.status })
})

// safe to call twice
app.post('/holds/:holdId/sell', (req, res) => {
  releaseExpiredHolds()
  const seat = findHold(req.params.holdId)
  if (!seat) return res.status(404).json({ error: 'unknown_hold' })
  if (seat.status === 'held') {
    db.prepare("UPDATE seats SET status = 'sold', expires_at = NULL WHERE hold_id = ?").run(seat.hold_id)
    notifyLive({ matchId: seat.match_id, seatId: seat.seat_id, status: 'sold', holder: seat.holder })
  }
  res.json({ holdId: seat.hold_id, status: 'sold' })
})

app.delete('/holds/:holdId', (req, res) => {
  const seat = findHold(req.params.holdId)
  if (!seat || seat.status !== 'held' || seat.holder !== String(req.query.holder ?? '')) {
    return res.status(404).json({ error: 'unknown_hold' })
  }
  db.prepare('DELETE FROM seats WHERE hold_id = ?').run(seat.hold_id)
  notifyLive({ matchId: seat.match_id, seatId: seat.seat_id, status: 'free' })
  res.status(204).end()
})

app.use((_req, res) => res.status(404).json({ error: 'not_found' }))
app.use(((error, _req, res, _next) => {
  const status = error.status ?? 500
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' })
}) as express.ErrorRequestHandler)

app.listen(PORT, () => console.log(`reservation listening on ${PORT}`))

setInterval(releaseExpiredHolds, 1000)

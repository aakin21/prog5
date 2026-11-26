// Catalog service: matches, stands and prices.
import express from 'express'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const PORT = Number(process.env.PORT ?? 4001)

const dataDir = join(import.meta.dirname, '..', 'data')
mkdirSync(dataDir, { recursive: true })
const db = new DatabaseSync(join(dataDir, 'catalog.db'))
db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id TEXT PRIMARY KEY, home TEXT, away TEXT, kickoff TEXT, stadium TEXT
  );
  CREATE TABLE IF NOT EXISTS stands (
    match_id TEXT, id TEXT, name TEXT, rows INTEGER, seats_per_row INTEGER, price INTEGER,
    PRIMARY KEY (match_id, id)
  );
`)

function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM matches').get() as { count: number }
  if (count > 0) return
  const matches = [
    ['m1', 'Ferencváros', 'Újpest', '2026-12-05T18:00:00Z', 'Groupama Aréna'],
    ['m2', 'Debrecen', 'Paks', '2026-12-12T16:30:00Z', 'Nagyerdei Stadion'],
    ['m3', 'Puskás Akadémia', 'MTK Budapest', '2026-12-19T19:00:00Z', 'Pancho Aréna'],
  ]
  const stands = [
    ['N', 'North Stand', 4, 12, 20],
    ['S', 'South Stand', 4, 12, 20],
    ['W', 'West Stand', 5, 10, 35],
    ['E', 'East Stand', 5, 10, 30],
  ]
  const insertMatch = db.prepare('INSERT INTO matches VALUES (?, ?, ?, ?, ?)')
  const insertStand = db.prepare('INSERT INTO stands VALUES (?, ?, ?, ?, ?, ?)')
  for (const match of matches) {
    insertMatch.run(...match)
    for (const stand of stands) insertStand.run(match[0], ...stand)
  }
}

function listMatches() {
  return db
    .prepare(`SELECT id, home, away, kickoff, stadium,
      (SELECT MIN(price) FROM stands WHERE match_id = matches.id) AS minPrice
      FROM matches ORDER BY kickoff`)
    .all()
}

function getMatch(id: string) {
  const match = db.prepare('SELECT id, home, away, kickoff, stadium FROM matches WHERE id = ?').get(id)
  if (!match) return undefined
  const stands = db
    .prepare('SELECT id, name, rows, seats_per_row AS seatsPerRow, price FROM stands WHERE match_id = ? ORDER BY id')
    .all(id)
  return { ...match, stands }
}

seed()

const app = express()
app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*')
  next()
})
app.get('/health', (_req, res) => res.json({ service: 'catalog', status: 'ok' }))
app.get('/matches', (_req, res) => res.json(listMatches()))
app.get('/matches/:id', (req, res) => {
  const match = getMatch(req.params.id)
  if (!match) return res.status(404).json({ error: 'unknown_match' })
  res.json(match)
})
app.use((_req, res) => res.status(404).json({ error: 'not_found' }))
app.use(((error, _req, res, _next) => {
  const status = error.status ?? 500
  res.status(status).json({ error: status === 500 ? 'internal_error' : 'invalid_request' })
}) as express.ErrorRequestHandler)

app.listen(PORT, () => console.log(`catalog listening on ${PORT}`))

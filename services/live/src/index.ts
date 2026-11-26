// Live service: WebSocket connections to the browsers.
import { createServer } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'

const PORT = Number(process.env.PORT ?? 4004)
const RESERVATION_URL = process.env.RESERVATION_URL ?? 'http://localhost:4002'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'http://localhost:5173'

type Client = { holder?: string; matchId?: string; alive: boolean }
const clients = new Map<WebSocket, Client>()

const ID = /^[\w-]{1,64}$/
const send = (socket: WebSocket, message: object) => socket.send(JSON.stringify(message))

async function callReservation(path: string, init?: RequestInit) {
  const response = await fetch(RESERVATION_URL + path, { ...init, signal: AbortSignal.timeout(2000) })
  return { status: response.status, body: response.status === 204 ? {} : await response.json() }
}

async function onMessage(socket: WebSocket, client: Client, message: any) {
  const { type, requestId } = message
  const reply = (ok: boolean, rest: object = {}) => send(socket, { type: 'result', requestId, ok, ...rest })
  try {
    if (type === 'subscribe') {
      const { holder, matchId } = message
      if (typeof holder !== 'string' || !holder.trim() || holder.length > 40 || typeof matchId !== 'string' || !ID.test(matchId)) {
        return reply(false, { error: 'invalid_message' })
      }
      const { body } = await callReservation(`/matches/${matchId}/seats`)
      client.holder = holder
      client.matchId = matchId
      // only the owner gets the hold id
      const seats = body.seats.map((seat: any) => ({
        ...seat,
        holdId: seat.holder === client.holder ? seat.holdId : undefined,
      }))
      return send(socket, { type: 'snapshot', requestId, matchId: client.matchId, now: body.now, seats })
    }
    if (!client.holder || !client.matchId) return reply(false, { error: 'not_subscribed' })

    if (type === 'hold') {
      if (typeof message.seatId !== 'string') return reply(false, { error: 'invalid_message' })
      const { status, body } = await callReservation(`/matches/${client.matchId}/holds`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatId: message.seatId, holder: client.holder }),
      })
      return status === 201 ? reply(true, { hold: body }) : reply(false, { error: body.error })
    }
    if (type === 'release') {
      if (typeof message.holdId !== 'string' || !ID.test(message.holdId)) return reply(false, { error: 'unknown_hold' })
      const { status, body } = await callReservation(
        `/holds/${message.holdId}?holder=${encodeURIComponent(client.holder)}`,
        { method: 'DELETE' },
      )
      return status === 204 ? reply(true) : reply(false, { error: body.error })
    }
    reply(false, { error: 'unknown_type' })
  } catch {
    reply(false, { error: 'reservation_unavailable' })
  }
}

function broadcast(change: { id: string; matchId: string; seatId: string; status: string; holder?: string; expiresAt?: number }) {
  const { id, matchId, seatId, status, holder, expiresAt } = change
  const message = JSON.stringify({ type: 'seat', eventId: id, matchId, seatId, status, holder, expiresAt })
  for (const [socket, client] of clients) {
    if (client.matchId === matchId) socket.send(message)
  }
}

const httpServer = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/seat-changes') {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
      if (body.length > 2000) req.destroy()
    })
    req.on('end', () => {
      try {
        const change = JSON.parse(body)
        const valid =
          typeof change.id === 'string' && typeof change.matchId === 'string' && typeof change.seatId === 'string' &&
          ['held', 'free', 'sold'].includes(change.status)
        if (valid) broadcast(change)
        res.writeHead(valid ? 204 : 400).end()
      } catch {
        res.writeHead(400).end()
      }
    })
    return
  }
  if (req.url === '/health') {
    return res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"service":"live","status":"ok"}')
  }
  res.writeHead(404).end()
})

const server = new WebSocketServer({
  server: httpServer,
  // only our own web client may connect
  verifyClient: ({ origin }: { origin?: string }) => !origin || origin === ALLOWED_ORIGIN,
})

server.on('connection', (socket) => {
  const client: Client = { alive: true }
  clients.set(socket, client)
  socket.on('pong', () => (client.alive = true))
  socket.on('close', () => clients.delete(socket))
  socket.on('error', () => socket.terminate())
  socket.on('message', (raw) => {
    let message: unknown
    try {
      message = JSON.parse(raw.toString())
    } catch {}
    if (typeof message !== 'object' || message === null) {
      return send(socket, { type: 'result', ok: false, error: 'invalid_message' })
    }
    onMessage(socket, client, message)
  })
})

setInterval(() => {
  for (const [socket, client] of clients) {
    if (!client.alive) {
      socket.terminate()
      continue
    }
    client.alive = false
    socket.ping()
  }
}, 15000)

httpServer.listen(PORT, () => console.log(`live listening on ${PORT}`))

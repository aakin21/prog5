// WebSocket connection to the Live service for one match, with reconnect.
import { useEffect, useRef, useState } from 'react'
import { LIVE_URL } from './config.ts'

export type Seat = {
  status: 'held' | 'sold'
  holder: string
  holdId?: string // only known for our own holds
  expiresAt?: number | null
}
export type Connection = 'connecting' | 'live' | 'reconnecting'
type Result = { ok: boolean; error?: string; hold?: { holdId: string; seatId: string; expiresAt: number } }

export function useLive(matchId: string, holder: string) {
  const [seats, setSeats] = useState<Record<string, Seat>>({})
  const [connection, setConnection] = useState<Connection>('connecting')
  // server clock minus ours
  const [clockOffset, setClockOffset] = useState(0)
  const socketRef = useRef<WebSocket | null>(null)
  const waiting = useRef(new Map<string, (result: Result) => void>())

  useEffect(() => {
    let closed = false
    let attempt = 0
    let timer: number | undefined

    function connect() {
      const socket = new WebSocket(LIVE_URL)
      socketRef.current = socket
      // events that arrive before the snapshot
      let buffered: any[] | null = []

      const applySeat = (message: any) =>
        setSeats((current) => {
          const next = { ...current }
          if (message.status === 'free') {
            delete next[message.seatId]
          } else {
            const previous = current[message.seatId]
            next[message.seatId] = {
              status: message.status,
              holder: message.holder,
              expiresAt: message.expiresAt,
              holdId: previous?.holder === message.holder ? previous.holdId : undefined,
            }
          }
          return next
        })

      socket.onopen = () => {
        socket.send(JSON.stringify({ type: 'subscribe', requestId: crypto.randomUUID(), matchId, holder }))
      }
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.type === 'snapshot') {
          // the snapshot replaces the whole seat map
          setSeats(Object.fromEntries(message.seats.map((seat: any) => [seat.seatId, seat])))
          setClockOffset(message.now - Date.now())
          buffered?.forEach(applySeat)
          buffered = null
          attempt = 0
          setConnection('live')
        } else if (message.type === 'seat') {
          if (buffered) buffered.push(message)
          else applySeat(message)
        } else if (message.type === 'result') {
          if (!message.ok && buffered) socket.close() // subscribing failed: retry
          waiting.current.get(message.requestId)?.(message)
          waiting.current.delete(message.requestId)
        }
      }
      socket.onclose = () => {
        if (closed) return
        waiting.current.forEach((resolve) => resolve({ ok: false, error: 'connection_lost' }))
        waiting.current.clear()
        setConnection('reconnecting')
        // backoff with jitter, max 10 s
        const delay = Math.min(10000, 500 * 2 ** attempt++) * (0.5 + Math.random() / 2)
        timer = window.setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      closed = true
      window.clearTimeout(timer)
      socketRef.current?.close()
    }
  }, [matchId, holder])

  function request(message: object): Promise<Result> {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.resolve({ ok: false, error: 'connection_lost' })
    }
    const requestId = crypto.randomUUID()
    return new Promise((resolve) => {
      waiting.current.set(requestId, resolve)
      socket.send(JSON.stringify({ ...message, requestId }))
    })
  }

  async function hold(seatId: string) {
    const result = await request({ type: 'hold', seatId })
    if (result.ok && result.hold) {
      const { holdId, expiresAt } = result.hold
      setSeats((current) => ({ ...current, [seatId]: { status: 'held', holder, holdId, expiresAt } }))
    }
    return result
  }

  const release = (holdId: string) => request({ type: 'release', holdId })

  return { seats, connection, clockOffset, hold, release }
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CATALOG_URL, PAYMENT_URL } from './config.ts'
import { useLive, type Seat } from './useLive.ts'

type Match = { id: string; home: string; away: string; kickoff: string; stadium: string; minPrice: number }
type Stand = { id: string; name: string; rows: number; seatsPerRow: number; price: number }
type MatchDetail = Match & { stands: Stand[] }

const ERRORS: Record<string, string> = {
  seat_taken: 'Someone else was faster. That seat is no longer free.',
  too_many_holds: 'You can hold at most 4 seats per match.',
  reservation_unavailable: 'The seat service is not responding. Please try again.',
  catalog_unavailable: 'The seat plan could not be checked. Please try again.',
  connection_lost: 'The connection was lost. Please try again in a moment.',
}

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const formatTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const formatCountdown = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`

function useFetch<T>(url: string) {
  const [data, setData] = useState<T>()
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    setFailed(false)
    fetch(url, { signal: AbortSignal.timeout(3000) })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then(setData, () => setFailed(true))
  }, [url, attempt])
  return { data, failed, retry: () => setAttempt((n) => n + 1) }
}

export function App() {
  // per tab, so two tabs are two users
  const [holder, setHolder] = useState(() => sessionStorage.getItem('holder') ?? '')
  const [matchId, setMatchId] = useState<string>()

  function signOut() {
    sessionStorage.removeItem('holder')
    setMatchId(undefined)
    setHolder('')
  }

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          Match Tickets
        </div>
        {holder && (
          <div className="user">
            <span className="user-name">{holder.split('#')[0]}</span>
            <button className="link" onClick={signOut}>
              Switch user
            </button>
          </div>
        )}
      </header>
      <main>
        {!holder ? (
          <NameForm
            onSubmit={(name) => {
              const id = `${name}#${Math.random().toString(36).slice(2, 6)}`
              sessionStorage.setItem('holder', id)
              setHolder(id)
            }}
          />
        ) : matchId ? (
          <MatchView matchId={matchId} holder={holder} onBack={() => setMatchId(undefined)} />
        ) : (
          <MatchList onSelect={setMatchId} />
        )}
      </main>
    </>
  )
}

function NameForm({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) onSubmit(name.trim())
  }
  return (
    <form onSubmit={submit} className="card welcome">
      <h1>Welcome</h1>
      <p className="muted">Choose a nickname to start picking seats.</p>
      <input
        aria-label="Nickname"
        placeholder="Nickname"
        value={name}
        onChange={(event) => setName(event.target.value.replace('#', ''))}
        maxLength={20}
        autoFocus
      />
      <button className="primary">Continue</button>
    </form>
  )
}

function MatchList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data, failed, retry } = useFetch<Match[]>(`${CATALOG_URL}/matches`)
  if (failed) {
    return (
      <p className="notice error">
        The match list could not be loaded. <button onClick={retry}>Try again</button>
      </p>
    )
  }
  if (!data) return <p className="muted">Loading matches…</p>
  return (
    <>
      <h1>Upcoming matches</h1>
      <ul className="matches">
        {data.map((match) => (
          <li key={match.id} className="card match">
            <div className="date">
              <strong>{formatDate(match.kickoff)}</strong>
              <span>{formatTime(match.kickoff)}</span>
            </div>
            <div className="teams">
              <strong>
                {match.home} <span className="versus">vs</span> {match.away}
              </strong>
              <span className="muted">{match.stadium}</span>
            </div>
            <div className="price">
              <span className="muted">from</span> €{match.minPrice}
            </div>
            <button className="primary" onClick={() => onSelect(match.id)}>
              Choose seats
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function MatchView({ matchId, holder, onBack }: { matchId: string; holder: string; onBack: () => void }) {
  const { data: match, failed, retry } = useFetch<MatchDetail>(`${CATALOG_URL}/matches/${matchId}`)
  const { seats, connection, clockOffset, hold, release } = useLive(matchId, holder)
  const [pending, setPending] = useState<string[]>([])
  const [message, setMessage] = useState('')
  const [now, setNow] = useState(Date.now())
  const previousHolds = useRef<string[]>([])
  const releasedByMe = useRef(new Set<string>())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const mine = Object.entries(seats).filter(([, seat]) => seat.holder === holder)
  const myHolds = mine.filter(([, seat]) => seat.status === 'held')
  const myTickets = mine.filter(([, seat]) => seat.status === 'sold')

  const standOf = (seatId: string) => match?.stands.find((stand) => stand.id === seatId.split('-')[0])
  const priceOf = (seatId: string) => standOf(seatId)?.price ?? 0
  const labelOf = (seatId: string) => {
    const [, row, number] = seatId.split('-')
    return `${standOf(seatId)?.name ?? ''}, row ${row}, seat ${number}`
  }
  const secondsLeft = (seat: Seat) => Math.max(0, Math.ceil(((seat.expiresAt ?? 0) - now - clockOffset) / 1000))

  // tell the user when one of their holds ran out
  useEffect(() => {
    const current = Object.entries(seats)
      .filter(([, seat]) => seat.holder === holder && seat.status === 'held')
      .map(([seatId]) => seatId)
    const gone = previousHolds.current.filter((seatId) => !current.includes(seatId) && seats[seatId]?.status !== 'sold')
    const expired = gone.filter((seatId) => !releasedByMe.current.delete(seatId))
    if (expired.length > 0) {
      setMessage(`Your hold on ${expired.map(labelOf).join('; ')} ran out. Select the seat again if it is still free.`)
    }
    previousHolds.current = current
  }, [seats])

  async function onSeatClick(seatId: string) {
    const seat = seats[seatId]
    if (pending.includes(seatId) || (seat && (seat.holder !== holder || seat.status === 'sold'))) return
    setMessage('')
    setPending((list) => [...list, seatId])
    if (seat?.holdId) releasedByMe.current.add(seatId)
    const result = seat?.holdId ? await release(seat.holdId) : await hold(seatId)
    setPending((list) => list.filter((id) => id !== seatId))
    if (!result.ok && result.error !== 'connection_lost') releasedByMe.current.delete(seatId)
    if (!result.ok) setMessage(ERRORS[result.error ?? ''] ?? 'That did not work. Please try again.')
  }

  if (failed) {
    return (
      <p className="notice error">
        The seat plan could not be loaded. <button onClick={retry}>Try again</button>{' '}
        <button onClick={onBack}>Back</button>
      </p>
    )
  }
  if (!match) return <p className="muted">Loading seat plan…</p>

  return (
    <>
      <div className="match-head">
        <button className="link" onClick={onBack}>
          ← All matches
        </button>
        <div>
          <h1>
            {match.home} <span className="versus">vs</span> {match.away}
          </h1>
          <span className="muted">
            {formatDate(match.kickoff)}, {formatTime(match.kickoff)} · {match.stadium}
          </span>
        </div>
        <span className={`status ${connection}`}>
          <span className="dot" />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
        </span>
      </div>

      {connection !== 'live' && (
        <p className="notice">Live updates are paused. The seat plan may be out of date until the connection is back.</p>
      )}
      {message && <p className="notice error">{message}</p>}

      <div className="layout">
        <section className="card">
          <div className="stadium">
            {match.stands.map((stand) => (
              <div key={stand.id} className={`stand stand-${stand.id}`}>
                <div className="stand-name">
                  {stand.name} <span className="chip">€{stand.price}</span>
                </div>
                <div className="rows">
                  {Array.from({ length: stand.rows }, (_, row) => (
                    <div key={row} className="row">
                      {Array.from({ length: stand.seatsPerRow }, (_, number) => {
                        const seatId = `${stand.id}-${row + 1}-${number + 1}`
                        const seat = seats[seatId]
                        const state = pending.includes(seatId)
                          ? 'pending'
                          : !seat
                            ? 'free'
                            : seat.holder === holder
                              ? seat.status === 'sold' ? 'mine-sold' : 'mine'
                              : seat.status
                        return (
                          <button
                            key={seatId}
                            className={`seat ${state}`}
                            title={`${labelOf(seatId)} · €${stand.price}`}
                            aria-label={`${labelOf(seatId)}, ${state}`}
                            disabled={connection !== 'live'}
                            onClick={() => onSeatClick(seatId)}
                          />
                        )
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className="pitch" />
          </div>
          <Legend />
        </section>

        <aside className="card order">
          <h2>Your order</h2>
          {myHolds.length === 0 ? (
            <p className="muted">Click a free seat to hold it for two minutes. Click it again to give it back.</p>
          ) : (
            <>
              <ul className="order-lines">
                {myHolds.map(([seatId, seat]) => (
                  <li key={seatId}>
                    <div>
                      <strong>{labelOf(seatId)}</strong>
                      <span className={`timer ${secondsLeft(seat) <= 30 ? 'low' : ''}`}>
                        {formatCountdown(secondsLeft(seat))} left
                      </span>
                    </div>
                    <span className="amount">€{priceOf(seatId)}</span>
                    <button
                      className="remove"
                      aria-label={`Release ${labelOf(seatId)}`}
                      disabled={connection !== 'live'}
                      onClick={() => onSeatClick(seatId)}
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <div className="total">
                <span>Total</span>
                <strong>€{myHolds.reduce((sum, [seatId]) => sum + priceOf(seatId), 0)}</strong>
              </div>
              <Checkout holder={holder} holds={myHolds.map(([seatId, seat]) => ({ seatId, holdId: seat.holdId }))} />
            </>
          )}
          {myTickets.length > 0 && (
            <>
              <h2>Your tickets</h2>
              <ul className="tickets">
                {myTickets.map(([seatId]) => (
                  <li key={seatId}>{labelOf(seatId)}</li>
                ))}
              </ul>
            </>
          )}
        </aside>
      </div>
    </>
  )
}

function Checkout({ holder, holds }: { holder: string; holds: { seatId: string; holdId?: string }[] }) {
  const [cardNumber, setCardNumber] = useState('4242424242424242')
  const [paying, setPaying] = useState(false)
  const [message, setMessage] = useState('')

  async function pay(event: FormEvent) {
    event.preventDefault()
    setPaying(true)
    setMessage('')
    let paid = 0
    try {
      for (const { holdId } of holds) {
        if (!holdId) continue
        const response = await fetch(`${PAYMENT_URL}/payments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ holdId, holder, cardNumber }),
          signal: AbortSignal.timeout(5000),
        })
        if (response.status === 402) throw new Error('The card was declined.')
        if (response.status === 400) throw new Error('Enter a 16-digit card number.')
        if (response.status === 409 || response.status === 404) throw new Error('A hold ran out before the payment.')
        if (response.status === 503) throw new Error('The seat service is not responding. Please try again.')
        if (!response.ok) throw new Error('The payment could not be completed. Please try again.')
        paid++
      }
    } catch (error) {
      const reason =
        error instanceof Error && error.name === 'Error'
          ? error.message
          : 'The payment service is not responding. Your seats stay held until the timer runs out.'
      setMessage(paid > 0 ? `${reason} ${paid} of ${holds.length} seats were paid before that.` : reason)
    }
    setPaying(false)
  }

  return (
    <form onSubmit={pay} className="checkout">
      <label htmlFor="card">Card number</label>
      <input id="card" value={cardNumber} onChange={(event) => setCardNumber(event.target.value)} inputMode="numeric" />
      <p className="hint">Test mode: any 16 digits work, a number ending in 0 is declined.</p>
      <button className="primary" disabled={paying}>
        {paying ? 'Paying…' : 'Pay now'}
      </button>
      {message && <p className="notice error">{message}</p>}
    </form>
  )
}

function Legend() {
  const items = [
    ['free', 'Free'],
    ['mine', 'Held by you'],
    ['held', 'Held by someone else'],
    ['sold', 'Sold'],
    ['mine-sold', 'Your ticket'],
  ]
  return (
    <ul className="legend">
      {items.map(([state, label]) => (
        <li key={state}>
          <span className={`seat ${state}`} /> {label}
        </li>
      ))}
    </ul>
  )
}

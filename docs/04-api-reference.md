# 4. API Reference

Seat ids have the form `stand-row-number`, for example `N-3-12`. Times are Unix milliseconds.

## Catalog (HTTP, port 4001)

| Request | Response |
|---|---|
| `GET /matches` | `200` list of `{ id, home, away, kickoff, stadium, minPrice }` |
| `GET /matches/:id` | `200` match with `stands: [{ id, name, rows, seatsPerRow, price }]`, or `404 unknown_match` |
| `GET /health` | `200 { service, status }` |

## Reservation (HTTP, port 4002)

Called by the Live and Payment services, not by the browser.

| Request | Response |
|---|---|
| `GET /matches/:matchId/seats` | `200 { matchId, now, seats: [{ seatId, status, holder, holdId, expiresAt }] }`: every seat that is not free |
| `POST /matches/:matchId/holds` with `{ seatId, holder }` | `201 { holdId, matchId, seatId, price, expiresAt }` |
| | `400 invalid_request`: missing or malformed fields |
| | `404 unknown_seat`: no such match or seat |
| | `503 catalog_unavailable`: the seat plan of a match used for the first time could not be fetched |
| | `409 seat_taken`: held or sold already |
| | `409 too_many_holds`: the user already holds four seats for this match |
| `GET /holds/:holdId` | `200 { holdId, matchId, seatId, holder, price, status }`, or `404 unknown_hold` |
| `POST /holds/:holdId/sell` | `200 { holdId, status: "sold" }`, also when it was sold already; `404 unknown_hold` if the hold expired |
| `DELETE /holds/:holdId?holder=…` | `204`, or `404 unknown_hold` |
| `GET /health` | `200 { service, status }` |

## Payment (HTTP, port 4003)

| Request | Response |
|---|---|
| `POST /payments` with `{ holdId, holder, cardNumber }` | `201 { id, holdId, amount, status: "succeeded" }` |
| | `200` with the earlier payment if this hold was already paid: paying twice never charges twice |
| | `402 { …, status: "failed" }`: card declined (number ends in 0) |
| | `409 hold_expired`: the hold ended before the seat could be confirmed; nothing is charged |
| | `503 reservation_unavailable`: nothing was recorded, the request can be repeated |
| | `400 invalid_request`, `403 not_your_hold`, `404 unknown_hold` (also when the hold has already expired) |
| `GET /payments/:id` | `200 { id, holdId, amount, status }`; status is `succeeded` or `failed` |
| `GET /health` | `200 { service, status }` |

## Live (WebSocket and HTTP, port 4004)

Every message is a JSON object with a `type`. Requests from the client carry a `requestId` chosen by
the client; the answer repeats it, so the client can match answers to requests.

### Client to server

| Message | Meaning |
|---|---|
| `{ type: "subscribe", requestId, matchId, holder }` | Start watching a match. Answered with a `snapshot` |
| `{ type: "hold", requestId, seatId }` | Hold a seat in the subscribed match |
| `{ type: "release", requestId, holdId }` | Give a held seat back |

### Server to client

| Message | Meaning |
|---|---|
| `{ type: "snapshot", requestId, matchId, now, seats }` | Every seat that is not free. `holdId` is included only for the user's own holds |
| `{ type: "result", requestId, ok: true, hold? }` | The command was carried out; for `hold` it contains `{ holdId, seatId, price, expiresAt }` |
| `{ type: "result", requestId, ok: false, error }` | The command was refused. Errors: `seat_taken`, `too_many_holds`, `unknown_seat`, `unknown_hold`, `not_subscribed`, `catalog_unavailable`, `reservation_unavailable`, `invalid_request`, `invalid_message`, `unknown_type` |
| `{ type: "seat", eventId, matchId, seatId, status, holder?, expiresAt? }` | A seat changed; `status` is `held`, `free` or `sold`. Sent to everyone watching the match |

The server sends a protocol-level ping every 15 seconds and closes connections that do not answer.
Connections from a browser are accepted only from the client's own origin.

### HTTP, called by Reservation

| Request | Response |
|---|---|
| `POST /seat-changes` with `{ id, matchId, seatId, status, holder?, expiresAt? }` | `204`; the change is sent to everyone watching the match; `400` for a malformed body |
| `GET /health` | `200 { service, status }` |

Previous: [Sequence diagrams](03-sequence-diagrams.md) · Next: [Running the project](05-running-the-project.md)

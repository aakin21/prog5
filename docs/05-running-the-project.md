# 5. Running the Project

## Requirements

- Node.js 24 or newer (developed on Node.js 26)

## Start

```bash
npm install
npm run services    # terminal 1: starts the four services
npm run client      # terminal 2: starts the web client
```

Open <http://localhost:5173>.

| Part | Address |
|---|---|
| Client | <http://localhost:5173> |
| Catalog | <http://localhost:4001> |
| Reservation | <http://localhost:4002> |
| Payment | <http://localhost:4003> |
| Live | `ws://localhost:4004` |

A single service can be started on its own with `npm start -w catalog` (or `reservation`,
`payment`, `live`).

## Things to try

1. **Live seat plan.** Open the client in two browser tabs, enter two nicknames and open the same
   match. Click a seat in one tab: it turns orange in the other tab at once.
2. **Same seat, two users.** The seat held in one tab cannot be clicked in the other.
3. **Expiry.** Leave a held seat alone: after two minutes it becomes free in both tabs. For a
   quicker demonstration start Reservation with a shorter hold:
   `HOLD_SECONDS=15 npm start -w reservation`.
4. **Payment.** Pay with the pre-filled card number: the seat turns blue for the buyer and red for
   everyone else. A card number ending in 0 is declined and the seat stays held.
5. **Payment stopped.** Stop the Payment service. Holding and releasing seats still works; paying
   reports that the payment service is not responding and the seats stay held.
6. **Catalog stopped.** Open a match, then stop the Catalog service. Seats on the open page can
   still be held and paid for.
7. **Reservation stopped.** Stop the Reservation service and click a seat: the client reports that
   the seat service is not responding instead of freezing.
8. **Connection lost.** Stop the Live service: the client shows "Reconnecting…". Start it again:
   the client reconnects on its own and reloads the seat plan, including the user's own holds.

## Resetting the data

Each service stores its SQLite file in its own `data/` folder. Stop the services and delete
`services/*/data` to start from an empty state; Catalog seeds its matches again on start.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `EADDRINUSE` on start | Another process uses the port; stop it or set `PORT` for that service |
| The client stays on "Connecting…" or "Reconnecting…" | The Live service is not running, or the client is not opened from `http://localhost:5173` |

Previous: [API reference](04-api-reference.md)

# 1. Overview

## What the system does

Users buy numbered seats for a football match. The important property is that **everyone sees the
same seat plan at the same moment, and a seat can never be given to two people**:

- Clicking a free seat holds it for two minutes. It changes colour on every open screen at once.
- A hold that is not paid for expires on its own and the seat becomes free again.
- A successful payment turns the hold into a sold seat.

## Users

There is one kind of user: a fan who picks a match, holds up to four seats and pays for them.
There is no login; the user types a nickname, and each browser tab acts as a separate user.

## Technology

| Part | Choice | Reason |
|---|---|---|
| Services | Node.js 24+ running TypeScript directly | No build step; one language everywhere |
| HTTP | Express | Small and well known |
| WebSocket | `ws` | The plain protocol, without an extra layer such as Socket.IO |
| Data | One SQLite file per service (`node:sqlite`) | No database server to install; each service visibly owns its file |
| Between services | HTTP calls with a time limit | Simple to run and to follow |
| Client | React with Vite | Single page with a live seat plan |

## Simplifications and known limitations

- **No login.** A nickname identifies the user. Anyone who knew another user's hold id could
  release or pay for that hold.
- **Simulated payment.** No real card processing: a 16-digit number ending in 0 is declined.
- **Seat change notifications can be lost.** When Reservation tells Live that a seat changed and
  Live is down, that notification is not sent again. Clients recover because they
  reload the whole seat plan when they reconnect.
- **No replay of missed WebSocket events.** After a reconnect the client receives a full snapshot of
  the seat plan instead of the events it missed.
- **Two steps that are not one transaction.** Payment first asks Reservation to mark the seat as
  sold and then stores the payment. If Payment crashes between the two, the seat is sold without a
  payment record. Paying again for the same hold repairs it.
- **One Live instance.** Seat changes are sent to a single Live address.
- **Fixed catalogue.** Matches and the stadium plan are seeded; there is no screen to edit them.

Next: [Architecture](02-architecture.md)

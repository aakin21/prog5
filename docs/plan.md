# Implementation Plan

The project was built in the steps below. Each step ends with something that can be run and shown.
The design itself is described in [Architecture](02-architecture.md).

| # | Step | Verifiable result |
|---|---|---|
| 1 | Repository skeleton: README and this plan | The repository opens with a readable README and rendered diagrams |
| 2 | Infrastructure: one workspace, one command to start all services | Empty services start |
| 3 | Catalog: seeded matches and one stadium plan, HTTP endpoints | Match and seat lists are returned over HTTP |
| 4 | Reservation: hold, release, expiry; one winner when two requests hit the same seat | Holds work over HTTP and expire on their own |
| 5 | Live: WebSocket, subscribe to a match, forward commands, broadcast seat changes | Two WebSocket connections see each other's holds |
| 6 | Payment: simulated payment; a paid seat becomes sold | A seat can be bought end to end |
| 7 | Client: match list, seat plan, live colours, countdown, checkout | Two browser tabs show the same seat plan changing live |
| 8 | Resilience: reconnect and reload the seat plan; one service stopped, the others keep working | Seat selection still works while Payment is stopped |
| 9 | Documentation: architecture, diagrams, API reference, how to run | The pages in `docs/` |

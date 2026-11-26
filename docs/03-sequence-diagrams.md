# 3. Sequence and State Diagrams

## Figure 2: Two users click the same seat

Sequence view of one operation: holding a seat.

```mermaid
sequenceDiagram
    participant A as Client A
    participant B as Client B
    participant L as Live
    participant R as Reservation

    A->>L: hold N-1-1 (WebSocket)
    B->>L: hold N-1-1 (WebSocket)
    L->>R: POST /matches/m1/holds for A
    L->>R: POST /matches/m1/holds for B
    R-->>L: 201 held until 14:02
    R-->>L: 409 seat_taken
    L-->>A: result ok, hold id
    L-->>B: result failed: seat_taken
    R-)L: POST /seat-changes (N-1-1 held)
    L-->>A: seat N-1-1 held
    L-->>B: seat N-1-1 held
```

## Figure 3: Paying for a held seat

```mermaid
sequenceDiagram
    participant C as Client
    participant P as Payment
    participant R as Reservation
    participant L as Live

    C->>P: POST /payments (hold id, card)
    P->>R: GET hold
    R-->>P: holder and price
    alt card accepted
        P->>R: POST sell hold
        alt hold still active
            R-->>P: 200 sold
            R-)L: POST /seat-changes (sold)
            L-->>C: seat sold (to every viewer)
            P-->>C: 201 succeeded
        else hold already expired
            R-->>P: 404 unknown_hold
            P-->>C: 409 hold_expired, nothing charged
        end
    else card declined
        P-->>C: 402 failed
        Note over C: the hold stays, the user can retry
    end
```

The seat is marked as sold before the payment is recorded, so a user never pays for a seat that
went to somebody else. Marking a seat as sold twice changes nothing, which makes a retry after a
timeout safe.

## Figure 4: Connection lost and restored

```mermaid
sequenceDiagram
    participant C as Client
    participant L as Live
    participant R as Reservation

    Note over C,L: connection drops
    C->>C: show "Reconnecting…", disable the seat plan
    loop growing delay with random jitter, at most 10 s
        C->>L: open WebSocket
    end
    C->>L: subscribe (match, user)
    L->>R: GET /matches/m1/seats
    R-->>L: all seats that are not free
    L-->>C: snapshot
    C->>C: replace the seat plan, show "Live"
```

Reconnecting restores the connection, not the state. The client therefore throws away what it knew
and takes the snapshot as the truth. Its own holds are still there, because they live in
Reservation, not in the connection.

## Figure 5: Lifecycle of a seat

State view of one seat for one match.

```mermaid
stateDiagram-v2
    [*] --> Free
    Free --> Held: user holds the seat
    Held --> Free: user releases it
    Held --> Free: two minutes pass
    Held --> Sold: payment succeeded
    Sold --> [*]
```

A declined payment does not change the state: the seat stays held and the user can try again until
the hold expires.

Previous: [Architecture](02-architecture.md) · Next: [API reference](04-api-reference.md)

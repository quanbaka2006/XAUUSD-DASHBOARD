# Phase 0-1 Scalping Signal Ledger Results

Date: 2026-07-14

Scope excludes Auto Trade, MT5 execution, Telegram execution, and VPS Farm.

## Phase 0 - Frozen contract

- Added the authoritative `scalping-signal-contract.md`.
- Simplified the decision model so higher-timeframe context remains visible but
  does not block a valid selected-timeframe trigger.
- Added independent M1/M5/M15/H1 lifecycles and progressively longer reward
  profiles, from 0.5R/0.75R on M1 to 1.5R/2R on H1.
- Defined open, terminal, reversal, expiry, invalidation, and ambiguous states.
- Defined monotonic state transitions and one open XAUUSD signal per timeframe.
- Defined deterministic signal identity, data-quality warnings, and collision policy.
- Converted the contract examples into executable unit tests.

## Phase 1 - MongoDB Signal Ledger

- Added the `scalping_signals` MongoDB collection.
- Added a unique `signalId` index.
- Added a partial unique index that permits at most one open signal per
  symbol/timeframe pair and migrates away from the earlier symbol-only index.
- Added newest-first history indexing and bounded history queries.
- Added optimistic concurrency through a revision field.
- Added idempotent publishing: the same signal identity returns the stored record.
- Added fail-closed conflict handling when another signal is already open.
- Added persistent transition and reconfirmation events.
- Startup initialization restores an active signal and its non-secret health state.
- MongoDB remains the only persistence requirement; no Render disk is needed.

## API and realtime integration

Authenticated endpoints:

- `GET /api/scalping/signals?symbol=XAUUSD&timeframe=M1&limit=20`
- `GET /api/scalping/signals/active?symbol=XAUUSD&timeframe=M1`
- `GET /api/scalping/signals/history?symbol=XAUUSD&timeframe=M1&limit=20`

Socket.IO events:

- `scalping_signals_snapshot` on connection and after ledger initialization;
- `scalping_signal_update` after future internal create, transition, or
  reconfirmation calls.

The transitional frontend now retains an ACTIVE, TP1_HIT, or FINISHED signal
per timeframe. Scanner `WAIT` cannot erase it; a FINISHED card remains until a
newer trigger arrives and prior state is cached locally until the Phase 2 engine
becomes the backend authority.

The public `/api/health` payload includes a non-secret `signalLedger` section.

## Verification

- Contract tests cover BUY/SELL geometry, 0.5R/0.75R, data quality, state
  monotonicity, terminal immutability, and reconfirmation.
- Store tests cover indexes, restoration, bounded history, and optimistic writes.
- Ledger tests cover restart restoration, idempotency, open-signal conflicts,
  lifecycle persistence, reconfirmation, and concurrent updates.

## Intentional Phase 1 limitation

Phase 1 is persistence infrastructure. Frontend algorithm 3.4.0 emits only a
native indicator event and retains lifecycle state locally per
symbol/timeframe/indicator. On cold start it restores the latest native event,
replays later real candles to recover its lifecycle, and suppresses duplicate
new-signal notifications. Phase 2 will move that strategy generation to the
backend and publish contract-valid timeframe signals into the ledger so every
client shares one authoritative history.

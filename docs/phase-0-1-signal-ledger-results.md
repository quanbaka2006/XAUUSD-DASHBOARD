# Phase 0-1 Scalping Signal Ledger Results

Date: 2026-07-14

Scope excludes Auto Trade, MT5 execution, Telegram execution, and VPS Farm.

## Phase 0 - Frozen contract

- Added the authoritative `scalping-signal-contract.md`.
- Frozen the pipeline as H1 bias -> M15 setup -> M5 confirmation -> M1 entry.
- Frozen M1 targets at TP1 0.5R and TP2 0.75R with a 50/50 reference allocation.
- Defined open, terminal, reversal, expiry, invalidation, and ambiguous states.
- Defined monotonic state transitions and the one-open-XAUUSD rule.
- Defined deterministic signal identity, data-quality rules, and collision policy.
- Converted the contract examples into executable unit tests.

## Phase 1 - MongoDB Signal Ledger

- Added the `scalping_signals` MongoDB collection.
- Added a unique `signalId` index.
- Added a partial unique index that permits at most one open signal per symbol.
- Added newest-first history indexing and bounded history queries.
- Added optimistic concurrency through a revision field.
- Added idempotent publishing: the same signal identity returns the stored record.
- Added fail-closed conflict handling when another signal is already open.
- Added persistent transition and reconfirmation events.
- Startup initialization restores an active signal and its non-secret health state.
- MongoDB remains the only persistence requirement; no Render disk is needed.

## API and realtime integration

Authenticated endpoints:

- `GET /api/scalping/signals?symbol=XAUUSD&limit=20`
- `GET /api/scalping/signals/active?symbol=XAUUSD`
- `GET /api/scalping/signals/history?symbol=XAUUSD&limit=20`

Socket.IO events:

- `scalping_signals_snapshot` on connection and after ledger initialization;
- `scalping_signal_update` after future internal create, transition, or
  reconfirmation calls.

The public `/api/health` payload includes a non-secret `signalLedger` section.

## Verification

- Contract tests cover BUY/SELL geometry, 0.5R/0.75R, data quality, state
  monotonicity, terminal immutability, and reconfirmation.
- Store tests cover indexes, restoration, bounded history, and optimistic writes.
- Ledger tests cover restart restoration, idempotency, open-signal conflicts,
  lifecycle persistence, reconfirmation, and concurrent updates.

## Intentional Phase 1 limitation

Phase 1 is persistence infrastructure. It does not yet generate a scalping
signal or replace the current frontend signal card. Phase 2 will move strategy
generation to the backend and publish contract-valid M1 signals into this
ledger. This separation avoids implementing lifecycle state in the frontend and
then rewriting it later.

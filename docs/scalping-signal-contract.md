# XAUUSD Scalping Signal Contract

Status: Phase 0 frozen contract

Schema version: `1.0.0`

Strategy identity: `xauusd-scalp`
Date: 2026-07-14

## Scope

This contract covers reference signals for manual XAUUSD scalping. Auto Trade,
MT5 execution, Telegram execution, and VPS Farm are explicitly out of scope.

The canonical market is OANDA spot `XAU_USD`. Signal results are reference
results against the dashboard feed; a user's broker spread and execution can
differ.

## Decision chain

The target strategy pipeline is:

1. H1 provides market bias.
2. M15 provides the setup direction.
3. M5 confirms the setup.
4. M1 supplies the real completed trigger candle, entry, and confirmed swing.

Phase 1 implements the persistent ledger and lifecycle contract. Automatic
generation from this decision chain is Phase 2 work.

## M1 price and risk rules

- Signals are `buy` or `sell` on `XAUUSD` / `M1`.
- Stop loss is derived from a confirmed real M1 swing, not ATR.
- BUY requires `SL < entry < TP1 < TP2` and a swing low.
- SELL requires `SL > entry > TP1 > TP2` and a swing high.
- `riskDistance = abs(entry - SL)`.
- `TP1 = 0.5R`; `TP2 = 0.75R`.
- The reference allocation is 50% at TP1 and 50% at TP2.
- When TP1 is reached, a later phase may publish `managedSl = entry`; the
  original SL remains immutable for audit.

Example BUY: entry 10, SL 0, TP1 15, TP2 17.5. The true displayed ratios are
`1:0.5` and `1:0.75`.

## Data-quality rules

- The trigger candle must be real and completed.
- Synthetic warm-up candles may initialize indicator state but cannot trigger a
  signal, define a swing, or count as a TP/SL hit.
- Gap-fill candles are display-only and cannot trigger a signal, define a swing,
  or count as a TP/SL hit.
- A confirmed swing uses five real, contiguous timeframe candles: two candles on
  each side of the pivot.
- A stale feed cannot publish or advance a signal.
- `signalStrength` remains a stable display integer from 90 to 98 and is not a
  calibrated win probability.

## Lifecycle states

Open states:

- `PENDING_ENTRY`
- `ACTIVE`
- `TP1_HIT`

Terminal states:

- `TP2_HIT`
- `SL_HIT`
- `EXPIRED`
- `INVALIDATED`
- `CLOSED_BY_REVERSAL`
- `AMBIGUOUS`

Allowed transitions:

| From | To |
|---|---|
| PENDING_ENTRY | ACTIVE, EXPIRED, INVALIDATED, CLOSED_BY_REVERSAL |
| ACTIVE | TP1_HIT, TP2_HIT, SL_HIT, INVALIDATED, CLOSED_BY_REVERSAL, AMBIGUOUS |
| TP1_HIT | TP2_HIT, SL_HIT, CLOSED_BY_REVERSAL, AMBIGUOUS |

Terminal signals cannot transition again. Status is monotonic: the dashboard
must never turn `TP1_HIT` back into `ACTIVE` or erase a closed result.

## New-signal collision policy

Only one open XAUUSD signal is allowed.

| Existing signal | Candidate | Contract action |
|---|---|---|
| Open, same identity | Any | Idempotent; return the existing signal |
| Open, same direction | Confirmed again | Reconfirm the existing signal; do not stack |
| PENDING_ENTRY | Fully confirmed opposite | Close old as INVALIDATED/REVERSAL, then create new |
| ACTIVE before TP1 | M1-only opposite | Ignore as noise |
| ACTIVE before TP1 | M15/M5-confirmed opposite | CLOSED_BY_REVERSAL, then create new |
| TP1_HIT | Fully confirmed opposite | Close the remainder, then create new |
| Terminal | New valid signal | Create normally |

Phase 1 fails closed with `ACTIVE_SIGNAL_EXISTS` until the later strategy engine
explicitly applies the collision policy.

## Persistent document requirements

Every signal stores:

- deterministic `signalId`;
- schema, strategy, and strategy version;
- symbol, timeframe, action, status, and `isOpen`;
- source candle time, entry, original SL, managed SL, TP1, and TP2;
- risk distance and actual R:R;
- confirmed swing and data-quality snapshot;
- H1/M15/M5 confluence snapshot when available;
- immutable ordered status events;
- created, updated, activated, hit, and closed timestamps;
- result in R and replacement identity when terminal;
- optimistic-concurrency revision.

MongoDB enforces a unique signal identity and at most one open signal per symbol.
Reloading a browser or replacing a Render instance must not lose the active
signal or its history.

## Phase 1 API and realtime contract

Authenticated REST endpoints:

- `GET /api/scalping/signals?symbol=XAUUSD&limit=20`
- `GET /api/scalping/signals/active?symbol=XAUUSD`
- `GET /api/scalping/signals/history?symbol=XAUUSD&limit=20`

Socket.IO events:

- `scalping_signals_snapshot` after an authenticated connection;
- `scalping_signal_update` after a ledger create, transition, or reconfirmation.

The public health response exposes only ledger readiness, persistence backend,
active signal identity, and non-secret error state.

## Acceptance test vectors

1. BUY entry 10 / SL 0 / TP1 15 / TP2 17.5 is accepted.
2. BUY with TP1 at 1R is rejected.
3. SELL geometry is the exact inverse of BUY.
4. Synthetic trigger, synthetic swing, and recent gap-fill are rejected.
5. The same identity is idempotent.
6. A second open identity is rejected.
7. TP1 can advance to TP2 but cannot return to ACTIVE.
8. Terminal state is immutable.
9. Restart initialization restores the MongoDB active signal.
10. History is returned newest first with a bounded limit.

# XAU/USD Market Data Contract

Status: Market data plus scalping Signal Ledger schema 1.1.0

## Scope

This contract covers dashboard market data, indicators, signals, and paper
simulation. Auto Trade and MT5 VPS Farm are explicitly out of scope.

## Canonical instrument

- Internal symbol: `XAUUSD`
- External instrument: OANDA spot `XAU_USD`
- Quote currency: USD
- The application must not substitute gold futures (`GC=F`) or tokenized gold
  (`PAXGUSDT`) for this instrument.

## Canonical price

- Historical candles use OANDA midpoint candles (`price=M`).
- Direct OANDA realtime pricing uses the midpoint of the best bid and best ask.
- An upstream adapter must label every price with `source`, `sourceTime`, and
  `receivedAt`.
- Prices from different instruments must never be stitched into the same candle
  series.

## Candle rules

- `M1` is the canonical stored timeframe.
- OANDA candles must be requested with `smooth=false`.
- Only completed M1 candles may enter indicator and signal calculations.
- M5, M15, and H1 are aggregated from M1 using UTC epoch boundaries:
  - M5: `floor(epoch / 300) * 300`
  - M15: `floor(epoch / 900) * 900`
  - H1: `floor(epoch / 3600) * 3600`
- A missing M1 candle is a data gap. It must not be synthesized, forward-filled,
  or persisted as real market data.
- The history API may add deterministic `warmup-backfill` candles before the
  first real candle and `gap-fill` candles inside a missing range for chart
  continuity only. Both types must carry `synthetic=true` and a
  `syntheticReason`, and neither type may be written to MongoDB.
- `gap-fill` candles are excluded from signal calculations. A signal near a
  recent gap must fail closed, and a confirmed swing must contain five real,
  contiguous candles at the requested timeframe.
- OHLC invariants must hold for every candle:
  - `high >= max(open, close)`
  - `low <= min(open, close)`
  - `high >= low`
- Timestamps are stored as UTC Unix seconds. Display timezone is a UI concern.

## Readiness and staleness

- At least 500 completed M1 candles are required before the signal engine is
  considered ready.
- During an open market session, realtime data is stale when no price or heartbeat
  has been received for 15 seconds.
- On stale data, the last price may remain visible but must be marked stale and no
  new candle-close signal may be emitted.
- Session state should be inferred from the provider/instrument status and observed
  candle stream. The application must not manufacture weekend or holiday prices.

## Signal contract

- Signals are evaluated only after a completed candle is accepted.
- The active candle may update UI price/OHLC but cannot create a confirmed signal.
- Identical input candles and parameters must produce identical output.
- A signal must contain its source candle time, symbol, timeframe, indicator name,
  parameter set, and algorithm version.
- A BUY/SELL trigger must be on a real completed candle. Synthetic warm-up data
  may initialize indicator state but cannot become a trigger, confirmed swing,
  or TP/SL hit.
- The persistent scalping contract supports independent M1, M5, M15, and H1
  signals. Higher-timeframe context is informational rather than a hard gate.
- Stop loss uses a confirmed real swing on the signal timeframe plus an
  instrument-specific buffer. TP1/TP2 profiles extend from 0.5R/0.75R on M1 to
  1.5R/2R on H1.
- The existing frontend algorithm 3.1.0 remains transitional until the Phase 2
  strategy engine begins publishing the new backend contract.
- `signalStrength` is a stable display score between 90 and 98, derived from the
  signal identity. It is not a calibrated win probability.

## Phase 1A acceptance gate

A candidate provider is acceptable only if the probe confirms:

1. It represents OANDA spot `XAU_USD`.
2. It supplies at least 500 completed M1 midpoint candles.
3. Candle timestamps are ordered and unique.
4. OHLC invariants pass.
5. The latest candle is reasonably current when the market is open.
6. Realtime pricing can be obtained from the same instrument without using
   `GC=F` or `PAXGUSDT`.

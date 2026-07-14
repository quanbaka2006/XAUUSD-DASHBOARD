'use strict';

const crypto = require('crypto');

const SIGNAL_SCHEMA_VERSION = '1.1.0';
const STRATEGY_ID = 'xauusd-scalp';
const STRATEGY_VERSION = '1.1.0-contract';
const SUPPORTED_TIMEFRAMES = Object.freeze(['M1', 'M5', 'M15', 'H1']);

const SIGNAL_STATUS = Object.freeze({
  PENDING_ENTRY: 'PENDING_ENTRY',
  ACTIVE: 'ACTIVE',
  TP1_HIT: 'TP1_HIT',
  TP2_HIT: 'TP2_HIT',
  SL_HIT: 'SL_HIT',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  CLOSED_BY_REVERSAL: 'CLOSED_BY_REVERSAL',
  AMBIGUOUS: 'AMBIGUOUS'
});

const OPEN_STATUSES = Object.freeze([
  SIGNAL_STATUS.PENDING_ENTRY,
  SIGNAL_STATUS.ACTIVE,
  SIGNAL_STATUS.TP1_HIT
]);

const TERMINAL_STATUSES = Object.freeze([
  SIGNAL_STATUS.TP2_HIT,
  SIGNAL_STATUS.SL_HIT,
  SIGNAL_STATUS.EXPIRED,
  SIGNAL_STATUS.INVALIDATED,
  SIGNAL_STATUS.CLOSED_BY_REVERSAL,
  SIGNAL_STATUS.AMBIGUOUS
]);

const ALLOWED_TRANSITIONS = Object.freeze({
  [SIGNAL_STATUS.PENDING_ENTRY]: Object.freeze([
    SIGNAL_STATUS.ACTIVE,
    SIGNAL_STATUS.EXPIRED,
    SIGNAL_STATUS.INVALIDATED,
    SIGNAL_STATUS.CLOSED_BY_REVERSAL
  ]),
  [SIGNAL_STATUS.ACTIVE]: Object.freeze([
    SIGNAL_STATUS.TP1_HIT,
    SIGNAL_STATUS.TP2_HIT,
    SIGNAL_STATUS.SL_HIT,
    SIGNAL_STATUS.INVALIDATED,
    SIGNAL_STATUS.CLOSED_BY_REVERSAL,
    SIGNAL_STATUS.AMBIGUOUS
  ]),
  [SIGNAL_STATUS.TP1_HIT]: Object.freeze([
    SIGNAL_STATUS.TP2_HIT,
    SIGNAL_STATUS.SL_HIT,
    SIGNAL_STATUS.CLOSED_BY_REVERSAL,
    SIGNAL_STATUS.AMBIGUOUS
  ])
});

const TIMEFRAME_RISK_REWARD = Object.freeze({
  M1: Object.freeze({ tp1: 0.5, tp2: 0.75 }),
  M5: Object.freeze({ tp1: 0.75, tp2: 1.25 }),
  M15: Object.freeze({ tp1: 1, tp2: 1.5 }),
  H1: Object.freeze({ tp1: 1.5, tp2: 2 })
});

class SignalContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SignalContractError';
    this.code = code;
  }
}

function contractError(code, message) {
  throw new SignalContractError(code, message);
}

function normalizeDate(value, fieldName) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime())) contractError('INVALID_DATE', `${fieldName} must be a valid date`);
  return date;
}

function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    contractError('INVALID_PRICE', `${fieldName} must be a positive finite number`);
  }
  return number;
}

function nonNegativeNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    contractError('INVALID_PRICE', `${fieldName} must be a non-negative finite number`);
  }
  return number;
}

function isOpenStatus(status) {
  return OPEN_STATUSES.includes(status);
}

function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

function validatePriceGeometry({ action, entry, sl, tp1, tp2 }) {
  if (action === 'buy' && !(sl < entry && entry < tp1 && tp1 < tp2)) {
    contractError('INVALID_PRICE_GEOMETRY', 'BUY requires SL < entry < TP1 < TP2');
  }
  if (action === 'sell' && !(sl > entry && entry > tp1 && tp1 > tp2)) {
    contractError('INVALID_PRICE_GEOMETRY', 'SELL requires SL > entry > TP1 > TP2');
  }
}

function calculateRiskReward({ action, entry, sl, tp1, tp2 }) {
  validatePriceGeometry({ action, entry, sl, tp1, tp2 });
  const riskDistance = Math.abs(entry - sl);
  return {
    riskDistance,
    tp1: Math.abs(tp1 - entry) / riskDistance,
    tp2: Math.abs(tp2 - entry) / riskDistance
  };
}

function assertTimeframeRiskReward(timeframe, riskReward, tolerance = 0.001) {
  const profile = TIMEFRAME_RISK_REWARD[timeframe];
  if (!profile) contractError('UNSUPPORTED_TIMEFRAME', `Unsupported signal timeframe: ${timeframe}`);
  if (Math.abs(riskReward.tp1 - profile.tp1) > tolerance ||
      Math.abs(riskReward.tp2 - profile.tp2) > tolerance) {
    contractError(
      'INVALID_TIMEFRAME_RISK_REWARD',
      `${timeframe} requires TP1=${profile.tp1}R and TP2=${profile.tp2}R`
    );
  }
}

function buildSignalId({
  symbol,
  timeframe,
  sourceCandleTime,
  action,
  strategyId = STRATEGY_ID,
  strategyVersion = STRATEGY_VERSION
}) {
  const identity = `${strategyId}:${strategyVersion}:${symbol}:${timeframe}:${sourceCandleTime}:${action}`;
  const digest = crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12);
  return `SIG-${symbol}-${timeframe}-${sourceCandleTime}-${action.toUpperCase()}-${digest}`;
}

function createSignalDocument(input, now = new Date()) {
  if (!input || typeof input !== 'object') contractError('INVALID_INPUT', 'Signal input is required');
  const symbol = String(input.symbol || '').toUpperCase();
  const timeframe = String(input.timeframe || '').toUpperCase();
  const action = String(input.action || '').toLowerCase();
  if (symbol !== 'XAUUSD') contractError('UNSUPPORTED_SYMBOL', 'Phase 1 Signal Ledger supports XAUUSD only');
  if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) {
    contractError('UNSUPPORTED_TIMEFRAME', 'Timeframe must be M1, M5, M15, or H1');
  }
  if (!['buy', 'sell'].includes(action)) contractError('INVALID_ACTION', 'Action must be buy or sell');

  const sourceCandleTime = Number(input.sourceCandleTime);
  if (!Number.isInteger(sourceCandleTime) || sourceCandleTime <= 0) {
    contractError('INVALID_SOURCE_TIME', 'sourceCandleTime must be a positive Unix timestamp in seconds');
  }

  const entry = positiveNumber(input.entry, 'entry');
  const sl = nonNegativeNumber(input.sl, 'sl');
  const tp1 = positiveNumber(input.tp1, 'tp1');
  const tp2 = positiveNumber(input.tp2, 'tp2');
  const riskReward = calculateRiskReward({ action, entry, sl, tp1, tp2 });
  assertTimeframeRiskReward(timeframe, riskReward);

  const swing = input.swing;
  if (!swing || !['low', 'high'].includes(swing.type) || !Number.isFinite(Number(swing.price)) ||
      !Number.isInteger(Number(swing.time))) {
    contractError('INVALID_SWING', 'A confirmed swing with type, price, and Unix time is required');
  }
  if ((action === 'buy' && swing.type !== 'low') || (action === 'sell' && swing.type !== 'high')) {
    contractError('INVALID_SWING_DIRECTION', 'BUY requires swing low and SELL requires swing high');
  }
  if (swing.synthetic === true) contractError('SYNTHETIC_SWING', 'Synthetic candles cannot define a swing');
  if (Number(swing.time) <= 0 || Number(swing.time) >= sourceCandleTime) {
    contractError('INVALID_SWING_TIME', 'Confirmed swing must be earlier than the trigger candle');
  }
  if ((action === 'buy' && !(sl < Number(swing.price) && Number(swing.price) < entry)) ||
      (action === 'sell' && !(sl > Number(swing.price) && Number(swing.price) > entry))) {
    contractError('INVALID_SWING_PRICE', 'Confirmed swing must sit between entry and buffered stop loss');
  }
  const swingStrength = swing.strength === undefined ? 2 : Number(swing.strength);
  if (swingStrength !== 2) {
    contractError('INVALID_SWING_STRENGTH', 'A confirmed swing requires two candles on each side');
  }

  const dataQuality = input.dataQuality || {};
  if (dataQuality.trigger !== 'real' || dataQuality.recentGapFill !== false) {
    contractError('INVALID_DATA_QUALITY', 'Signal trigger must be real and cannot be near a gap-fill');
  }

  const signalStrength = Number(input.signalStrength);
  if (!Number.isInteger(signalStrength) || signalStrength < 90 || signalStrength > 98) {
    contractError('INVALID_SIGNAL_STRENGTH', 'signalStrength must be an integer from 90 to 98');
  }

  const status = input.status || SIGNAL_STATUS.ACTIVE;
  if (![SIGNAL_STATUS.PENDING_ENTRY, SIGNAL_STATUS.ACTIVE].includes(status)) {
    contractError('INVALID_INITIAL_STATUS', 'A new signal must start as PENDING_ENTRY or ACTIVE');
  }

  const timestamp = normalizeDate(now, 'now');
  const strategyId = input.strategyId || STRATEGY_ID;
  const strategyVersion = input.strategyVersion || STRATEGY_VERSION;
  const signalId = buildSignalId({ symbol, timeframe, sourceCandleTime, action, strategyId, strategyVersion });

  return {
    schemaVersion: SIGNAL_SCHEMA_VERSION,
    signalId,
    strategyId,
    strategyVersion,
    symbol,
    timeframe,
    action,
    status,
    isOpen: true,
    sourceCandleTime,
    entry,
    originalSl: sl,
    managedSl: null,
    tp1,
    tp2,
    riskDistance: riskReward.riskDistance,
    riskReward: { tp1: riskReward.tp1, tp2: riskReward.tp2 },
    allocation: { tp1Percent: 50, tp2Percent: 50 },
    swing: {
      type: swing.type,
      price: Number(swing.price),
      time: Number(swing.time),
      strength: swingStrength
    },
    confluence: input.confluence || null,
    dataQuality: {
      trigger: 'real',
      recentGapFill: false,
      source: dataQuality.source || 'finnhub-oanda-spot'
    },
    signalStrength,
    reconfirmationCount: 0,
    statusEvents: [{
      sequence: 1,
      from: null,
      to: status,
      at: timestamp,
      price: entry,
      reason: 'signal-created'
    }],
    activatedAt: status === SIGNAL_STATUS.ACTIVE ? timestamp : null,
    tp1HitAt: null,
    tp2HitAt: null,
    slHitAt: null,
    closedAt: null,
    resultR: null,
    replacedBySignalId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 1
  };
}

function assertStatusTransition(fromStatus, toStatus) {
  if (!Object.values(SIGNAL_STATUS).includes(toStatus)) {
    contractError('INVALID_STATUS', `Unknown signal status: ${toStatus}`);
  }
  if (isTerminalStatus(fromStatus)) contractError('TERMINAL_SIGNAL', `Signal is already terminal: ${fromStatus}`);
  if (!(ALLOWED_TRANSITIONS[fromStatus] || []).includes(toStatus)) {
    contractError('INVALID_TRANSITION', `Cannot transition signal from ${fromStatus} to ${toStatus}`);
  }
}

function transitionSignal(signal, toStatus, metadata = {}, now = new Date()) {
  if (!signal || typeof signal !== 'object') contractError('INVALID_SIGNAL', 'Signal document is required');
  assertStatusTransition(signal.status, toStatus);
  const timestamp = normalizeDate(now, 'now');
  const previousTimestamp = normalizeDate(signal.updatedAt || signal.createdAt, 'signal.updatedAt');
  if (timestamp.getTime() < previousTimestamp.getTime()) {
    contractError('NON_MONOTONIC_EVENT_TIME', 'Signal event time cannot move backwards');
  }
  const price = metadata.price === undefined || metadata.price === null
    ? null
    : nonNegativeNumber(metadata.price, 'transition price');
  const next = {
    ...signal,
    status: toStatus,
    isOpen: isOpenStatus(toStatus),
    updatedAt: timestamp,
    revision: Number(signal.revision || 0) + 1,
    statusEvents: [
      ...(signal.statusEvents || []),
      {
        sequence: (signal.statusEvents || []).length + 1,
        from: signal.status,
        to: toStatus,
        at: timestamp,
        price,
        reason: metadata.reason || null
      }
    ]
  };

  if (toStatus === SIGNAL_STATUS.ACTIVE) next.activatedAt = timestamp;
  if (toStatus === SIGNAL_STATUS.TP1_HIT) {
    next.tp1HitAt = timestamp;
    if (metadata.managedSl !== undefined) next.managedSl = positiveNumber(metadata.managedSl, 'managedSl');
  }
  if (toStatus === SIGNAL_STATUS.TP2_HIT) {
    next.tp1HitAt = next.tp1HitAt || timestamp;
    next.tp2HitAt = timestamp;
  }
  if (toStatus === SIGNAL_STATUS.SL_HIT) next.slHitAt = timestamp;
  if (!next.isOpen) {
    next.closedAt = timestamp;
    if (metadata.resultR !== undefined) {
      const resultR = Number(metadata.resultR);
      if (!Number.isFinite(resultR)) contractError('INVALID_RESULT_R', 'resultR must be finite');
      next.resultR = resultR;
    }
    if (metadata.replacedBySignalId) next.replacedBySignalId = String(metadata.replacedBySignalId);
  }
  return next;
}

function reconfirmSignal(signal, metadata = {}, now = new Date()) {
  if (!signal || !isOpenStatus(signal.status)) contractError('SIGNAL_NOT_OPEN', 'Only an open signal can be reconfirmed');
  const timestamp = normalizeDate(now, 'now');
  const previousTimestamp = normalizeDate(signal.updatedAt || signal.createdAt, 'signal.updatedAt');
  if (timestamp.getTime() < previousTimestamp.getTime()) {
    contractError('NON_MONOTONIC_EVENT_TIME', 'Signal event time cannot move backwards');
  }
  return {
    ...signal,
    reconfirmationCount: Number(signal.reconfirmationCount || 0) + 1,
    updatedAt: timestamp,
    revision: Number(signal.revision || 0) + 1,
    statusEvents: [
      ...(signal.statusEvents || []),
      {
        sequence: (signal.statusEvents || []).length + 1,
        from: signal.status,
        to: signal.status,
        at: timestamp,
        price: metadata.price === undefined ? null : nonNegativeNumber(metadata.price, 'reconfirmation price'),
        reason: metadata.reason || 'same-direction-reconfirmation'
      }
    ]
  };
}

module.exports = {
  SIGNAL_SCHEMA_VERSION,
  STRATEGY_ID,
  STRATEGY_VERSION,
  SUPPORTED_TIMEFRAMES,
  SIGNAL_STATUS,
  OPEN_STATUSES,
  TERMINAL_STATUSES,
  ALLOWED_TRANSITIONS,
  TIMEFRAME_RISK_REWARD,
  SignalContractError,
  isOpenStatus,
  isTerminalStatus,
  calculateRiskReward,
  assertTimeframeRiskReward,
  buildSignalId,
  createSignalDocument,
  assertStatusTransition,
  transitionSignal,
  reconfirmSignal
};

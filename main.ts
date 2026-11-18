// Drift-and-dip ladder bot for btc-race-24h-20261118-1444.
//
// Long-only cbBTC/USDC on 1-minute bars, $1,000 of paper money. The bot buys
// a pullback from the trailing 90-bar high once the price recovers from its
// 8-bar low, adds once at a deeper pullback, and exits on a take-profit, a
// hard stop, or a trailing stop that arms once the trade is in profit. A
// portfolio drawdown circuit breaker halts new entries. No network, no wall
// clock, no environment input, no randomness: every decision comes from the
// bars and the account the harness sends, so two runs on the same data give
// the same orders.
//
// Tuning notes (from the frozen dev window in this kit, 1,440 bars):
// the window fell 2.8% overall but ranged between roughly $63.7k and $64.9k,
// so the edge is buying pullbacks and selling the bounce, not holding the
// trend. A dip of 90 bps with a 10 bps recovery from the 8-bar low, sized
// at 55% of equity with one 30% add at a 200 bps pullback, made about
// +$14.70 on the dev window over 6 filled orders with a 0.70% maximum
// drawdown; the same settings at double fees still made about +$13.30.
// Neighbouring sizes (50-60% first buy, 25-35% add) and dip thresholds
// (80-100 bps) all stayed profitable, while a 70 bps dip threshold lost
// money and a range-bounce entry lost money, so both were left out. A
// trend-following sleeve was tried and dropped: it lost money on this
// window. The 250 bps 60-bar filter keeps the bot out of steep slides;
// the 24-bar cooldown after an exit stops it re-entering the same dip.

const SYMBOL = "CBBTC";
const TOTAL_BARS = 1440;
const BPS = 10000n;
const QTY_PRICE_SCALE = 10000000n; // 10^(qty_scale + price_scale - quote_scale)

const HI_LB = 90;
const DIP1_BPS = 90n;
const REC_BPS = 10n;
const SIZE1_PCT = 55n;
const DIP2_BPS = 200n;
const SIZE2_PCT = 30n;
const TP_BPS = 100n;
const STOP_BPS = 100n;
const TRAIL_ARM_BPS = 60n;
const TRAIL_BPS = 45n;
const COOLDOWN_BARS = 24;
const MAX_DD_BPS = 1200n;
const NO_ENTRY_TAIL = 90;
const RET60_MIN_BPS = 250n;
const MAX_SLIP_BPS = 200;
const MIN_NOTIONAL = 1000000n;

let warmupBars = 0;
const closes: bigint[] = [];
let cash = 0n;
let equity = 0n;
let positionQty = 0n;
let costSpent = 0n;
let peakEquity = 0n;
let cooldown = 0;
let added = false;
let trailPeak = 0n;
let armed = false;
let orderCounter = 0;

function maxOf(values: bigint[]): bigint {
  let m = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] > m) m = values[i];
  }
  return m;
}

function minOf(values: bigint[]): bigint {
  let m = values[0];
  for (let i = 1; i < values.length; i++) {
    if (values[i] < m) m = values[i];
  }
  return m;
}

function costPrice(): bigint {
  if (positionQty === 0n) return 0n;
  return (costSpent * QTY_PRICE_SCALE) / positionQty;
}

function pnlBps(close: bigint): bigint {
  const c = costPrice();
  if (c === 0n) return 0n;
  return ((close - c) * BPS) / c;
}

function trailBps(): bigint {
  const c = costPrice();
  if (c === 0n || trailPeak === 0n) return 0n;
  return ((trailPeak - c) * BPS) / c;
}

function givebackBps(close: bigint): bigint {
  if (trailPeak === 0n || close === 0n) return 0n;
  return ((trailPeak - close) * BPS) / close;
}

function drawdownBps(): bigint {
  if (peakEquity === 0n) return 0n;
  return ((peakEquity - equity) * BPS) / peakEquity;
}

function buyOrder(notional: bigint): Record<string, unknown> {
  orderCounter++;
  return {
    side: "buy",
    client_id: `b${orderCounter}`,
    symbol: SYMBOL,
    notional_quote_units: notional.toString(),
    max_slippage_bps: MAX_SLIP_BPS,
  };
}

function sellOrder(): Record<string, unknown> {
  orderCounter++;
  return {
    side: "sell",
    client_id: `s${orderCounter}`,
    symbol: SYMBOL,
    qty: positionQty.toString(),
    max_slippage_bps: MAX_SLIP_BPS,
  };
}

function processBatch(batch: any): { type: string; seq: number; orders: unknown[] } {
  const orders: unknown[] = [];
  const bars = Array.isArray(batch.bars) ? batch.bars : [];
  let bar: any = null;
  for (const b of bars) {
    if (b.symbol === SYMBOL) {
      bar = b;
      break;
    }
  }

  const account = batch.account ?? {};
  cash = BigInt(account.cash_quote_units ?? "0");
  equity = BigInt(account.equity_quote_units ?? "0");
  let qty = 0n;
  const positions = Array.isArray(account.positions) ? account.positions : [];
  for (const p of positions) {
    if (p.symbol === SYMBOL) qty = BigInt(p.qty ?? "0");
  }
  positionQty = qty;

  const fills = Array.isArray(batch.fills) ? batch.fills : [];
  for (const f of fills) {
    if (f.symbol !== SYMBOL || f.status !== "filled") continue;
    if (f.side === "buy") {
      costSpent += BigInt(f.notional_quote_units ?? "0") - BigInt(f.fee_quote_units ?? "0");
    } else if (f.side === "sell" && positionQty === 0n) {
      cooldown = COOLDOWN_BARS;
    }
  }
  if (positionQty === 0n) {
    costSpent = 0n;
    added = false;
    armed = false;
    trailPeak = 0n;
  }

  if (bar === null) {
    return { type: "reply", seq: batch.seq, orders };
  }
  const close = BigInt(bar.c);
  closes.push(close);

  if (equity > peakEquity) peakEquity = equity;

  let exiting = false;
  if (positionQty > 0n && costPrice() > 0n) {
    if (close > trailPeak) trailPeak = close;
    const pb = pnlBps(close);
    if (trailBps() >= TRAIL_ARM_BPS) armed = true;
    const gb = givebackBps(close);
    if (drawdownBps() >= MAX_DD_BPS) {
      orders.push(sellOrder());
      exiting = true;
    } else if (pb >= TP_BPS) {
      orders.push(sellOrder());
      exiting = true;
    } else if (pb <= -STOP_BPS) {
      orders.push(sellOrder());
      exiting = true;
    } else if (armed && gb >= TRAIL_BPS) {
      orders.push(sellOrder());
      exiting = true;
    }
  }

  if (cooldown > 0) {
    cooldown--;
  } else if (
    closes.length <= TOTAL_BARS - NO_ENTRY_TAIL &&
    closes.length > warmupBars &&
    drawdownBps() < MAX_DD_BPS &&
    !exiting
  ) {
    const hi = maxOf(closes.slice(-HI_LB));
    const lo8 = minOf(closes.slice(-8));
    const drop = ((hi - close) * BPS) / hi;
    if (positionQty === 0n) {
      const rec = ((close - lo8) * BPS) / lo8;
      const prev60 = closes.length > 60 ? closes[closes.length - 61] : close;
      const ret60 = ((close - prev60) * BPS) / prev60;
      if (drop >= DIP1_BPS && rec >= REC_BPS && ret60 >= -RET60_MIN_BPS) {
        let size = (equity * SIZE1_PCT) / 100n;
        if (size > cash) size = cash;
        if (size >= MIN_NOTIONAL) orders.push(buyOrder(size));
      }
    } else if (!added && drop >= DIP2_BPS) {
      let size = (equity * SIZE2_PCT) / 100n;
      if (size > cash) size = cash;
      if (size >= MIN_NOTIONAL) {
        orders.push(buyOrder(size));
        added = true;
      }
    }
  }

  return { type: "reply", seq: batch.seq, orders };
}

function handleLine(line: string): boolean {
  let msg: any;
  try {
    msg = JSON.parse(line);
  } catch {
    return false;
  }
  if (msg.type === "hello") {
    if (typeof msg.warmup_bars === "number") warmupBars = msg.warmup_bars;
    return false;
  }
  if (msg.type === "done") {
    return true;
  }
  if (msg.type === "batch") {
    const reply = processBatch(msg);
    process.stdout.write(JSON.stringify(reply) + "\n");
    return false;
  }
  return false;
}

async function main(): Promise<void> {
  let buffer = "";
  for await (const chunk of process.stdin) {
    buffer += chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.length > 0 && handleLine(line)) {
        process.exit(0);
      }
      nl = buffer.indexOf("\n");
    }
  }
}

main();

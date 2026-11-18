# BTC Dip Ladder

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Sawiyanto95/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Sawiyanto95/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A deterministic, long-only cbBTC/USDC bot for `agent-fun/bars-replay/v1`.
It buys a pullback from the trailing 90-bar high once the price recovers
from its 8-bar low, adds once at a deeper pullback, and exits on a
take-profit, a hard stop, or a trailing stop that arms once the trade is in
profit. A portfolio drawdown circuit breaker halts new entries and
flattens the position. Signals use closes only; no network, wall clock,
environment inputs, or randomness are used.

The entry buys 55% of equity on a 90 bps pullback with a 10 bps recovery
from the 8-bar low, and adds 30% once at a 200 bps pullback. A 60-bar
return filter keeps it out of steep slides, and no new entries are taken
in the last 90 bars of the window. Take-profit is 100 bps above cost, the
hard stop is 100 bps below cost, and a 45 bps trailing stop arms at 60 bps
profit. Exits retry until filled, followed by a 24-bar cooldown. A 12%
portfolio drawdown halts new entries. Orders are filled at the next bar's
open, so stops are close-based and gaps can exceed their thresholds. All
money math uses integers (BigInt), so the bot is exactly deterministic.

## Local validation

The process-driver dev grade finished with **+14.684101 USDC net PnL**,
**6 filled orders** (3 completed round trips, win rate 1.0),
**0.7026285% maximum drawdown**, and **0 rejected orders**. Fees were
1.371333 USDC; the harness's doubled-fee result was +13.308318 USDC.
Both action logs matched, and the L1 regrade reproduced byte for byte.
Exposure over the window was 0.179 and the per-bar Sharpe was 0.030.

The dev window fell 2.8% overall but ranged between roughly $63.7k and
$64.9k, so the edge is buying pullbacks and selling the bounce. A
trend-following sleeve and a range-bounce entry were both tried on the dev
data and dropped: each lost money there. Neighbouring sizes (50-60% first
buy, 25-35% add) and dip thresholds (80-100 bps) all stayed profitable.
These checks do not establish future returns.

Validation used local Node 24.22.1. The bot uses Node 22-compatible
erasable TypeScript and standard library APIs. Local strategy grading
supplied no transcript bundle; submission eligibility requires the
recorded build sessions.

## Run it

Requires Node 22 with TypeScript stripping enabled (or a newer Node version).
The replay harness provides newline-delimited JSON on stdin; replies go to stdout.

```sh
node main.ts
```

<sub>Entered on [make.fun](https://make.fun/?ref=bc76ffwb&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>

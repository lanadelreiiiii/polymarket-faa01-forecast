// polymarket-faa-attribution-01 entry (Node 22, standard library only).
//
// Per-market quantile forecaster for Polymarket Yes prices. The practice data
// (128 market-cases) showed prices are step functions: ~85% of minutes have
// zero return, moves come as isolated jumps that mostly revert. So a
// random-walk spread (sigma*sqrt(h)) is far too wide: future dispersion grows
// like h^0.4, not h^0.5. Volatility is wildly heterogeneous across markets,
// so sigma is calibrated per market from the last 240 minutes and scaled by
// 0.5. Short-term drift reverses (corr ~ -0.37), so the median is pulled back
// against the last hour's drift, fading in over ~240 minutes. Jump risk is
// heavy-tailed: markets with a history of >0.005 jumps keep a volatility
// floor, and the outer quantiles sit at +-2.2 sigma, not +-1.645.
//
// Model, for a market with last price x, 1-min returns r, drift60 = x - price
// 60 minutes ago, jumpFrac5 = share of the last 720 returns with |r| > 0.005:
//   sigma  = max(0.5 * std(r[-240:]), jumpFrac5 * 0.0125), capped at 0.05
//   center(h) = x - 0.25 * (1 - exp(-h/240)) * drift60
//   q_tau(h)  = clamp(center(h) + z_tau * sigma * h^0.4, 0, 1), rounded to 6 dp
//   z = [-2.2, -0.67449, 0, 0.67449, 2.2] for tau = [0.05, 0.25, 0.5, 0.75, 0.95]
//
// Reads every <id>.in in the input directory and writes <id>.out per case:
// {"forecasts":[{"id","q": [[q05,q25,q50,q75,q95] x 240]}]}.
// Deterministic: no randomness, no network, no time dependence.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The quantile levels the contest scores, in the order each row lists them. */
const QUANTILES = [0.05, 0.25, 0.5, 0.75, 0.95];
/** Heavy-tailed quantile multipliers (outer quantiles wider than normal's +-1.645). */
const Z = [-2.2, -0.67449, 0, 0.67449, 2.2];
/** Scale on the recent per-minute return std. */
const VOL_SCALE = 0.5;
/** Spread grows like h^SPREAD_POW (mean reversion: slower than a random walk). */
const SPREAD_POW = 0.4;
/** Volatility floor per unit of jump frequency (share of |r|>0.005 in last 720 min). */
const JUMP_FLOOR = 0.0125;
/** Hard cap on sigma: guards against pathological short histories in the final
 *  (the FAA markets are only ~16h old at the deadline). Never binds on practice. */
const SIGMA_CAP = 0.05;
/** Counter-drift: fraction of the last hour's drift reversed, fading in over this tau. */
const DRIFT_REV = 0.25;
const DRIFT_TAU = 240;

interface CaseMarket {
  id: string;
  prices: number[];
}

interface Case {
  horizon_minutes: number;
  quantiles: number[];
  markets: CaseMarket[];
}

/** x clamped to [0,1] and rounded to 6 decimals (0, never -0). */
const price6 = (x: number): number => Math.round(Math.min(1, Math.max(0, x)) * 1e6) / 1e6 + 0;

function stdOf(a: number[]): number {
  if (a.length === 0) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

function forecast(m: CaseMarket, horizon: number): number[][] {
  const prices = m.prices;
  if (prices.length === 0) throw new Error(`market ${m.id} has no prices`);
  const n = prices.length;
  const x = prices[n - 1] as number;

  // 1-minute returns.
  const rets: number[] = [];
  for (let i = 1; i < n; i++) rets.push((prices[i] as number) - (prices[i - 1] as number));

  // Per-market volatility: std of the last 240 returns, scaled down.
  const sig240 = stdOf(rets.slice(-240));
  // Jump frequency: share of the last 720 returns larger than 0.005 in magnitude.
  const r720 = rets.slice(-720);
  let jumps = 0;
  for (const r of r720) if (Math.abs(r) > 0.005) jumps++;
  const jumpFrac5 = r720.length === 0 ? 0 : jumps / r720.length;
  const sigma = Math.min(SIGMA_CAP, Math.max(VOL_SCALE * sig240, JUMP_FLOOR * jumpFrac5));

  // Short-term drift (last 60 minutes) — it reverses, so the median leans against it.
  const drift60 = x - (prices[Math.max(0, n - 61)] as number);

  const rows: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const grow = Math.pow(h, SPREAD_POW);
    const center = x - DRIFT_REV * (1 - Math.exp(-h / DRIFT_TAU)) * drift60;
    const row = Z.map((z) => price6(center + z * sigma * grow));
    for (let j = 1; j < row.length; j++) {
      if ((row[j] as number) < (row[j - 1] as number)) row[j] = row[j - 1] as number;
    }
    rows.push(row);
  }
  return rows;
}

mkdirSync(OUTPUT_DIR, { recursive: true });
// Every case file, in name order, so two runs write the same bytes.
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith('.in')).sort();
for (const file of inputs) {
  const id = file.slice(0, -'.in'.length);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), 'utf8')) as Case;
  if (c.quantiles.length !== QUANTILES.length || c.quantiles.some((t, j) => t !== QUANTILES[j])) throw new Error(`${file} asks for quantiles ${JSON.stringify(c.quantiles)}, not ${JSON.stringify(QUANTILES)}`);
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ forecasts })}\n`);
}

# Polymarket FAA Attribution Forecast — make.fun entry

Forecasts the Yes price of every Polymarket FAA outage attribution market,
minute by minute, 4 hours ahead, as five quantiles (0.05, 0.25, 0.5, 0.75,
0.95) per minute.

Competition: `polymarket-faa-attribution-01` on [make.fun](https://make.fun).

## Method

A per-market quantile forecaster, calibrated on the practice cases (NVIDIA CEO
event). Practice pinball loss **0.2764** vs the house baseline's **0.3636**
(-24%). It reuses the forecaster from our FAA-02 entry ("Merry Prism"): the
two competitions share the same FAA attribution family and the practice
instance is identical between them (only the `competition` field differs), so
the same calibrated model applies.

- **Per-market volatility**: std of the last 240 one-minute returns, scaled by
  0.5, with a floor from jump frequency (share of the last 720 returns with
  |r| > 0.005). Volatility varies wildly across markets, so a fixed sigma is
  wrong for most of them.
- **Slow spread growth**: spread grows like h^0.4, not sqrt(h) — prices are
  step functions whose jumps mostly revert, so future dispersion saturates.
- **Counter-drift median**: short-term drift reverses (corr ~ -0.37), so the
  median leans against the last hour's drift, fading in over ~240 minutes.
- **Heavy tails**: outer quantiles at ±2.2 sigma, not the normal ±1.645.

## Run

```sh
node main.ts   # reads /input/*.in (or $MAKEFUN_INPUT_DIR), writes /output/*.out
```

Node 22, standard library only. Deterministic, no network.

## License

MIT

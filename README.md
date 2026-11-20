# GTA VI Trophy Rarity Forecast

Forecasts every Grand Theft Auto VI PlayStation 5 trophy's Exophase earn rate at
2026-11-26T00:00:00Z, as five quantiles per trophy, for
[make.fun bounty `gta6-trophy-rarity-forecast-01`](https://make.fun/bounty/gta6-trophy-rarity-forecast-01).

[![competition](https://make.fun/badge/gta6-trophy-rarity-forecast-01.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![rank](https://make.fun/badge/gta6-trophy-rarity-forecast-01/bongekanjing/gta6-trophy-rarity-forecast-01-vivid-walrus-33/rank.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)
[![reward](https://make.fun/badge/gta6-trophy-rarity-forecast-01/bongekanjing/gta6-trophy-rarity-forecast-01-vivid-walrus-33/reward.svg)](https://make.fun/bounty/gta6-trophy-rarity-forecast-01)

Bounty page: <https://make.fun/bounty/gta6-trophy-rarity-forecast-01>

## What it does

A trophy's earn rate is a ratio — the players who earned it over the players Exophase
tracks — and the two halves move apart. On launch night the page read 638 players and a
quantised set of rates (0.63% is four earners, 1.10% seven). A day later, at 14,028
players, nearly every rate had fallen: the platinum went 0.63% to 0.03% because four
people had it at launch and about four still had it a day later while the pool grew
around them.

Both halves are power laws, so with `gamma` the trophy's earner growth over the pool's
growth:

```
rate(t) = rate(now) * (P(t) / P(now)) ** (gamma - 1)
```

`gamma = 1` is a trophy every player finishes (the rate holds); `gamma = 0` is pure
dilution (the rate falls with the pool).

`gamma` is taken from the trophy's own reads whenever the case's history shows the pool
moving — the slope of its log rate on the log pool, counting only reads whose pool count
actually changed, since Exophase refreshes on its own schedule and a hundred identical
reads are one observation. When the history never moved (the practice cases ship several
reads of one unrefreshed page), the prior comes from the rate ladder: `gamma` is a
saturating function of how common the trophy is, fitted on the one verified transition
there is, and held out on half the trophies to score the other half.

## Validation

Measured on the real page, launch night (638 players, from the kit's recording) to the
next evening (14,028 players, parsed from Exophase). The program sees only the launch-night
history and forecasts 24 hours later:

| model | pinball loss | median miss | 90% coverage |
|---|---|---|---|
| this program | **0.279** | 0.006 pp | 0.98 |
| house persistence baseline | 2.268 | 0.740 pp | 0.05 |

Held-out on random halves of the 55 trophies, where the fit never sees the trophies it
scores: loss 0.315, coverage 0.81.

The spread is the empirical distribution of `gamma` around the ladder, applied as
quantiles of `gamma` rather than a symmetric band on the rate, because the residual is
skewed — most trophies sit just below the ladder and a few hold far above it. It is
widened 2x past the in-sample residual: at 1x held-out coverage was 0.26, at 2x it is 0.81
at no cost in loss.

## Run

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory and writes one `<id>.out` per case. Node 22,
standard library only, no network, deterministic.

## License

MIT — see `LICENSE`.

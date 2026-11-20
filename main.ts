// gta6-trophy-rarity-forecast-01 — forecast each GTA VI PS5 trophy's Exophase earn rate at the
// case's target as five quantiles, scored by a pinball loss on the logit scale.
//
// THE PHYSICS
// A trophy's earn rate is a ratio, earners_i / players_tracked, and the contest turns on how those
// two halves move apart. On launch night the page read 638 players and a tiny, quantised set of
// rates: 0.63% is four earners, 0.78% five, 1.10% seven — the page prints two decimals of a count
// in single digits. A day later, at 14,028 players, a 22-fold larger pool, nearly every rate had
// FALLEN. The platinum went 0.63% to 0.03% because four people had it at launch and about four
// still had it a day later while the pool grew around them. The house persistence baseline, which
// says a rate does not move, pays full price for missing exactly that.
//
// Both halves are power laws in time, so
//     rate_i(t) = rate_i(now) * (P(t) / P(now)) ** (gamma_i - 1)
// where gamma_i is the trophy's earner growth over the pool's growth. gamma = 1 is a plateau:
// earners keep pace with the pool, so the rate holds — what a trophy every player finishes does.
// gamma = 0 is pure dilution: earners barely move and the rate falls with the pool.
//
// WHERE GAMMA COMES FROM
// Two sources; the program prefers the first.
//
//  1. The trophy's own reads. The final's history is dense — the house reads the page every ten
//     minutes from launch night to the deadline — so once the pool has moved, gamma is measurable
//     for that trophy as the slope of its log rate on the log pool. Exophase refreshes on its own
//     schedule, so a hundred reads showing one page are one observation, not a hundred: only reads
//     whose pool count actually changed are evidence, and that count is what earns a measurement
//     weight against the prior.
//
//  2. The rate ladder, when a case's history never moved — the practice cases are exactly that,
//     several reads of one unrefreshed page. Then nothing is observable and the prior must come
//     from outside. On the one verified transition there is (launch night to the next evening,
//     both sides measured here), gamma is a saturating function of how common the trophy is: a
//     trophy every player finishes holds, a rare one dilutes almost fully. A logistic in the
//     rate's logit expresses that and cannot leave [0, 1]:
//         gamma = 1 / (1 + exp(-(5.970 + 1.650 * logit(rate))))
//     giving 1.00 at 100%, 0.40 at 2%, 0.12 at 0.78%, 0.004 at 0.1%. Held out on half the trophies
//     and scored on the other half it gives a loss of 0.315 against 2.27 for persistence, and it
//     calibrates better than a straight line, whose fit is dragged down by the mass of trophies
//     sitting near 0.8% and then badly under-predicts the few common ones.
//
// THE SPREAD
// The pinball loss is proper, so a wide spread is not a safe spread; it pays at every trophy. The
// spread carried here is the empirical distribution of gamma around the ladder, applied as
// quantiles of gamma rather than a symmetric band on the rate, because the residual is skewed:
// most trophies sit just below the ladder and a few hold far above it. It is widened 2x beyond the
// raw in-sample residual, since a forecast fitted on 55 trophies is overconfident on trophies it
// has not seen — at 1x held-out coverage was 0.26, at 2x it is 0.81, and the loss is no worse.
//
// THE POOL'S CLOCK
// Players accumulate from the game's launch, not from the case's first read. A case whose history
// spans only launch night would otherwise imply that the pool is nearly finished growing, and
// under-predict a day's pool threefold. The projection is therefore anchored at launch and follows
// P = 638 * (t / 0.5h) ** 0.8, fitted to the real page at 638 players after half an hour, 3,868
// after six hours and 14,028 after a day; a case whose own reads span enough time fits its own
// slope on that same clock instead.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? "/input";
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";

/** The levels scored. */
const LEVELS = [0.05, 0.25, 0.5, 0.75, 0.95];
/** The scorer clamps rates here before the logit, so 0% and 100% stay finite. */
const FLOOR = 0.01;
const CEIL = 99.99;
/** The rate ladder: gamma = sigmoid(LADDER_P + LADDER_Q * logit(rate)). */
const LADDER_P = 5.9699;
const LADDER_Q = 1.65;
/** The empirical spread of gamma around that ladder, at the five levels. */
const RESID_Q = [-0.1307, -0.0777, -0.0698, 0.0116, 0.396];
/** Resist in-sample overconfidence: at 1x held-out coverage was 0.26, at 2x it is 0.81. */
const WIDEN = 2.0;
/** A measured gamma earns full weight after this many refreshing moves actually observed. */
const SHRINK_MOVES = 3;
/** Even a well-measured gamma keeps this share of the ladder's spread, so no band collapses. */
const MIN_PRIOR_SHARE = 0.35;
/** The pool's growth law, anchored at the game's launch, fitted to the real page's three anchors. */
const LAUNCH_AT = Date.parse("2026-11-18T23:50:00Z") / 3_600_000;
const LAUNCH_PLAYERS = 638;
const LAUNCH_HOURS = 0.5;
const BASE_GROWTH_POWER = 0.8;

const clampRate = (x: number): number => Math.min(CEIL, Math.max(FLOOR, x));
const logit = (pct: number): number => {
  const c = clampRate(pct);
  return Math.log(c / (100 - c));
};
const invLogit = (x: number): number => 100 / (1 + Math.exp(-x));
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;

interface Read {
  slot: string;
  players_tracked: number;
  rates: Array<number | null>;
}
interface CaseFile {
  id: string;
  at: string;
  target: string;
  horizon_minutes: number;
  trophies: Array<{ id: number; name: string; tier: string; points: number }>;
  history: Read[];
}

const HOURS = (iso: string): number => Date.parse(iso) / 3_600_000;

/** Least squares of y on x as [slope, intercept]; a flat line when x never varies. */
function fitLine(xs: number[], ys: number[]): [number, number] {
  const k = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / k;
  const my = ys.reduce((a, b) => a + b, 0) / k;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < k; i += 1) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx < 1e-12) return [0, my];
  const slope = sxy / sxx;
  return [slope, my - slope * mx];
}

/** gamma the rate ladder implies for a trophy currently at this rate: saturating, in [0, 1]. */
const ladderGamma = (rate: number): number =>
  1 / (1 + Math.exp(-(LADDER_P + LADDER_Q * logit(rate))));

mkdirSync(OUTPUT_DIR, { recursive: true });
const inputs = readdirSync(INPUT_DIR).filter((f) => f.endsWith(".in")).sort();

for (const file of inputs) {
  const id = file.slice(0, -3);
  const c = JSON.parse(readFileSync(join(INPUT_DIR, file), "utf8")) as CaseFile;
  const last = c.history[c.history.length - 1];
  const horizonHours = c.horizon_minutes / 60;
  const tLast = HOURS(last.slot);

  const withPlayers = c.history.filter((h) => h.players_tracked > 0);
  const distinctPlayers = new Set(withPlayers.map((h) => h.players_tracked)).size;

  // ---- how fast the pool grows --------------------------------------------
  // ln P against ln(hours since launch) — the clock the pool actually runs on. Fitting against the
  // case's first read instead would make a three-hour history look like all the growth there is.
  const hoursFromLaunch = (iso: string): number => Math.max(LAUNCH_HOURS, HOURS(iso) - LAUNCH_AT);
  const baseReads = withPlayers.filter((h) => hoursFromLaunch(h.slot) > LAUNCH_HOURS + 1e-9);
  const bFitted = baseReads.length >= 3
    ? fitLine(
        baseReads.map((h) => Math.log(hoursFromLaunch(h.slot))),
        baseReads.map((h) => Math.log(h.players_tracked)),
      )[0]
    : 0;
  const bPlayers = bFitted > 1e-9 && bFitted < 4 ? bFitted : BASE_GROWTH_POWER;
  const lastPlayers = Math.max(
    1,
    last.players_tracked || withPlayers[withPlayers.length - 1]?.players_tracked || LAUNCH_PLAYERS,
  );
  const targetHours = hoursFromLaunch(last.slot) + horizonHours;
  const projectedPlayers = LAUNCH_PLAYERS * (targetHours / LAUNCH_HOURS) ** bPlayers;
  const growth = Math.max(1, projectedPlayers / lastPlayers);

  const trophies = c.trophies.map((t, i) => {
    // The trophy's rate now: its most recent non-null reading, since a read may have lacked it.
    let rate: number | null | undefined = last.rates[i];
    for (let j = c.history.length - 1; j >= 0 && (rate === null || rate === undefined); j -= 1) {
      rate = c.history[j].rates[i];
    }
    const now = clampRate(rate ?? 1);

    // The prior: where this trophy sits on the rate ladder.
    let medianGamma = ladderGamma(now);
    let priorShare = 1;

    if (distinctPlayers >= 2) {
      // This trophy's own dilution, on the recent regime only — launch night's collapse and this
      // week's steadier rates are different regimes, and the one being extrapolated is the recent
      // one. The slope through the origin of log-rate change on log-pool change, over consecutive
      // reads whose pool count differs, so one refresh counts once however many reads repeat it.
      const measureFrom = tLast - 24;
      const inWindow = withPlayers.filter((h) => HOURS(h.slot) >= measureFrom);
      const windowReads = inWindow.length >= 2 ? inWindow : withPlayers;
      const seen: Array<{ lp: number; lr: number }> = [];
      for (const h of windowReads) {
        const r = h.rates[i];
        if (r !== null && r !== undefined && r > 0) {
          seen.push({ lp: Math.log(h.players_tracked), lr: Math.log(clampRate(r)) });
        }
      }
      const pairs: Array<[number, number]> = [];
      for (let j = 1; j < seen.length; j += 1) {
        const dlp = seen[j].lp - seen[j - 1].lp;
        if (Math.abs(dlp) > 1e-9) pairs.push([dlp, seen[j].lr - seen[j - 1].lr]);
      }
      if (pairs.length > 0) {
        const num = pairs.reduce((a, [dlp, dlr]) => a + dlp * dlr, 0);
        const den = pairs.reduce((a, [dlp]) => a + dlp * dlp, 0);
        if (den > 1e-12) {
          const measured = 1 + num / den;
          const w = Math.min(1, pairs.length / SHRINK_MOVES);
          medianGamma = w * measured + (1 - w) * medianGamma;
          // Hold back a share of the ladder's spread whatever the measurement says: a trophy seen
          // move twice has not been measured so well that its band may become a line.
          priorShare = Math.max(MIN_PRIOR_SHARE, 1 - w);
        }
      }
    }

    // A ratio of two non-negative growths, and between 0 and 1 because earners cannot outrun the
    // pool forever; the clamp also stops one noisy fit from inverting a rate.
    medianGamma = Math.min(1, Math.max(0, medianGamma));

    // Quantiles of gamma: the ladder's median plus the empirical residual shape, scaled by how
    // much of the ladder still applies, widened for out-of-sample use.
    const gammas = RESID_Q.map((rq) => {
      const g = medianGamma + (rq - RESID_Q[2]) * priorShare * WIDEN;
      return Math.min(1, Math.max(0, g));
    });

    // Quantiles of the rate follow from gamma through the same power law, so the band's skew is
    // the skew of dilution itself and not an assumption laid on top of it.
    const q = gammas.map((g) => round4(clampRate(now * growth ** (g - 1))));
    for (let k = 1; k < q.length; k += 1) if (q[k] < q[k - 1]) q[k] = q[k - 1];
    return { id: t.id, q };
  });

  writeFileSync(join(OUTPUT_DIR, `${id}.out`), `${JSON.stringify({ trophies })}\n`);
}

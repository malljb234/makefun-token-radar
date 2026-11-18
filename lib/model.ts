// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the floor that are not a wrapped, staked or bridged product of a token that
// already trades. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol); the live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranking.
//
// Implied value is FITTED, not hand-tuned (model radar-3). The coefficients come from an ordinary
// least-squares regression on the snapshot's own traded tokens, run at build time from the snapshot
// alone — no constant in the model is written in by hand:
//
//   anchors  the traded protocols whose token plausibly IS the protocol: market cap and TVL both
//              positive, not a wrapped, staked or bridged product, not a versioned pool, not an
//              exchange's own product. 88 of the snapshot's 144 traded protocols qualify.
//   trim     the 5% of anchors with the lowest and the 5% with the highest market-cap-per-TVL are
//              set aside before fitting: a prediction-market token at 400x its TVL and a staking
//              receipt at 0.0006x are not the protocol's own value, and one such row would drag the
//              whole fit. 78 anchors remain.
//   fit      log(market cap) = intercept + b_tvl x log(TVL) + b_growth x growth + b_chains x log(chains),
//              growth = clamp(change_7d, -50, +100) / 100. Fitted on the 78 anchors.
//   guards   growth's multiplier exp(b_growth x growth) is clamped to [0.5, 2.0] and breadth's
//              exp(b_chains x log(chains)) to [0.5, 1.5]: the growth slope is identified mostly from
//              crashes among the anchors, so an uncapped +100% week would multiply a value ~3x on
//              evidence the anchors do not contain. The caps are stated a priori, bind only outside
//              the anchors' observed range, and apply the same to every protocol.
//   category the category's own multiple: the median residual of the category's fit anchors, in log
//              points, exponentiated and clamped to [0.6, 1.6]; categories with fewer than 3 fit
//              anchors use 1.0.
//   implied  = max(1, round(exp(intercept) x TVL ^ b_tvl x growthMult x breadthMult x categoryMult))
//
// AGE IS NOT IN THE MODEL, and the dashboard says so. Age (days since listed_at) was tested as a
// fifth term: its fitted coefficient is +0.52 with t = +0.66, it adds 0.004 to R-squared, and
// refitting with it on the pre-2025 anchors swings its slope to +5.0 and sends the forward holdout's
// R-squared to -1.92. Among traded tokens, how long a protocol has run carries no signal about its
// market cap once TVL is known, so radar-3 gives age no weight. Every row still shows its age.
//
// Validation, all recomputed from the snapshot at build time:
//   in-sample  R-squared, adjusted R-squared, residual SD, mean absolute log error and median
//              absolute percentage error of the 78-anchor fit.
//   5-fold CV  the fit anchors in slug order, fold = index mod 5: refit on four folds, predict the
//              fifth, pooled out-of-sample R-squared and errors.
//   forward    fit on the anchors listed before 2025-01-01 (36), predict the anchors listed on or
//              after it (22): a forward-in-time holdout, the closest honest test this snapshot allows.
//   walk-forward: NOT POSSIBLE. The snapshot is one date (2026-11-14); it holds no time series of
//              TVL or market cap to walk forward over. The forward holdout above is the analogue,
//              and the dashboard states the limit rather than claiming a walk-forward test.
//
// The dashboard's detail view shows every one of these inputs per protocol, so the value can be
// checked against the snapshot's figures row by row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** One category's fitted multiple, for the dashboard's model panel. */
export interface CategoryFit {
  category: string;
  peers: number;
  median_residual: number;
  multiplier: number;
  median_ratio: number;
}

/** The fitted model's validation numbers, all recomputed from the snapshot at build time. */
export interface FitSummary {
  r2: number;
  adj_r2: number;
  resid_sd: number;
  mae_log: number;
  med_ape_pct: number;
  cv_folds: number;
  cv_r2: number;
  cv_mae_log: number;
  cv_med_ape_pct: number;
  fwd_cutoff: string;
  fwd_n_train: number;
  fwd_n_test: number;
  fwd_r2: number;
  fwd_mae_log: number;
  fwd_med_ape_pct: number;
  age_coef: number;
  age_t: number;
  age_r2_gain: number;
  walk_forward: string;
}

/** The fitted model: coefficients from the regression, guards, anchor counts and validation. */
export interface FittedModel {
  intercept: number;
  intercept_se: number;
  tvl_exponent: number;
  tvl_exponent_se: number;
  growth_coef: number;
  growth_coef_se: number;
  chains_coef: number;
  chains_coef_se: number;
  growth_mult_min: number;
  growth_mult_max: number;
  breadth_mult_min: number;
  breadth_mult_max: number;
  category_min: number;
  category_max: number;
  category_min_peers: number;
  trim_each_side: number;
  n_anchors: number;
  n_fit: number;
  fit: FitSummary;
  categories: CategoryFit[];
}

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    breadth_multiplier: number;
    category_multiplier: number;
    category_ratio: number | null;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included so page and board agree exactly. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  base_usd: number;
  growth_multiplier: number;
  breadth_multiplier: number;
  category_multiplier: number;
  category_ratio: number | null;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: FittedModel;
  model_version: string;
  watchlist_size: number;
  watchlist_slugs: string[];
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of numbers: the middle value, or the mean of the two middle values. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Growth as the model enters it: the seven-day change in per cent, clamped, as a fraction. */
function growthFeature(p: SnapshotProtocol): number {
  const raw = finite(p.change_7d, 0);
  return Math.min(100, Math.max(-50, raw)) / 100;
}

/** The regression's design row for one anchor: [1, log TVL, growth, log chains]. */
function designRow(p: SnapshotProtocol): number[] {
  return [1, Math.log(Math.max(1, p.tvl_usd)), growthFeature(p), Math.log(Math.max(1, p.chains.length))];
}

/** One anchor's target: log market cap. */
function target(p: SnapshotProtocol): number {
  return Math.log(p.mcap_usd!);
}

/** Solve A x = b and invert A, by Gauss-Jordan with partial pivoting. A must be square. */
function solveWithInverse(a: number[][], b: number[]): { x: number[]; inv: number[][] } {
  const n = a.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r]![col]!) > Math.abs(m[pivot]![col]!)) pivot = r;
    if (Math.abs(m[pivot]![col]!) < 1e-12) throw new SnapshotError('the fitted model is singular on this snapshot');
    if (pivot !== col) {
      const tmp = m[col]!;
      m[col] = m[pivot]!;
      m[pivot] = tmp;
    }
    const div = m[col]![col]!;
    for (let j = 0; j < 2 * n + 1; j++) m[col]![j]! /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n + 1; j++) m[r]![j]! -= factor * m[col]![j]!;
    }
  }
  return {
    x: m.map((row) => row[n]!),
    inv: m.map((row) => row.slice(n + 1)),
  };
}

/** An ordinary least-squares fit: coefficients, standard errors, R-squared and errors. */
export interface OlsResult {
  beta: number[];
  se: number[];
  r2: number;
  adjR2: number;
  residSd: number;
  maeLog: number;
  medApePct: number;
  residuals: number[];
}

function ols(design: number[][], y: number[]): OlsResult {
  const n = design.length;
  const k = design[0]!.length;
  const xtx: number[][] = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  const xty: number[] = new Array<number>(k).fill(0);
  for (let i = 0; i < n; i++) {
    const row = design[i]!;
    for (let a = 0; a < k; a++) {
      xty[a]! += row[a]! * y[i]!;
      for (let b = 0; b < k; b++) xtx[a]![b]! += row[a]! * row[b]!;
    }
  }
  const { x: beta, inv } = solveWithInverse(xtx, xty);
  const residuals = design.map((row, i) => y[i]! - row.reduce((s, v, j) => s + v * beta[j]!, 0));
  const rss = residuals.reduce((s, r) => s + r * r, 0);
  const mean = y.reduce((s, v) => s + v, 0) / n;
  const tss = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  const r2 = 1 - rss / tss;
  const dof = n - k;
  const s2 = rss / dof;
  const se = beta.map((_, j) => Math.sqrt(Math.max(0, s2 * inv[j]![j]!)));
  const maeLog = residuals.reduce((s, r) => s + Math.abs(r), 0) / n;
  const medApePct = median(residuals.map((r) => Math.abs(Math.exp(r) - 1))) * 100;
  return { beta, se, r2, adjR2: 1 - (1 - r2) * ((n - 1) / dof), residSd: Math.sqrt(s2), maeLog, medApePct, residuals };
}

/** The pooled out-of-sample R-squared of predictions against their targets. */
function pooledR2(predicted: number[], y: number[]): number {
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  const rss = predicted.reduce((s, p, i) => s + (y[i]! - p) * (y[i]! - p), 0);
  const tss = y.reduce((s, v) => s + (v - mean) * (v - mean), 0);
  return 1 - rss / tss;
}

/** The median absolute percentage error of predictions against their targets, in log space. */
function pooledMedApe(predicted: number[], y: number[]): number {
  return median(predicted.map((p, i) => Math.abs(Math.exp(y[i]! - p) - 1))) * 100;
}

/** The pooled mean absolute log error of predictions against their targets. */
function pooledMaeLog(predicted: number[], y: number[]): number {
  return predicted.reduce((s, p, i) => s + Math.abs(y[i]! - p), 0) / y.length;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word in the name that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a traded protocol is an anchor the model may fit on: its token plausibly IS the
 * protocol, so its market cap is a fair target — market cap and TVL both positive, not a wrapped,
 * staked or bridged product, not a versioned pool, not an exchange's own product.
 */
export function isAnchor(p: SnapshotProtocol): boolean {
  return (
    p.mcap_usd !== null &&
    p.mcap_usd > 0 &&
    p.tvl_usd > 0 &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/**
 * Whether a protocol is one the board may rank below the watchlist floor: pre-token, not a wrapped,
 * staked or bridged product, not an exchange, not a versioned pool. The watchlist itself is taken as
 * given and is never filtered by this rule.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_WORD.test(p.name)
  );
}

/** The fitted model plus each category's multiple, computed from the snapshot at build time. */
export interface FitResult {
  model: FittedModel;
  multiples: Map<string, { multiplier: number; ratio: number | null; peers: number }>;
}

/** The growth multiplier's clamp, and the breadth multiplier's: stated a priori, never fitted. */
const GROWTH_MULT_MIN = 0.5;
const GROWTH_MULT_MAX = 2.0;
const BREADTH_MULT_MIN = 0.5;
const BREADTH_MULT_MAX = 1.5;
/** A category multiple's clamp, and how many fit anchors a category needs to earn one. */
const CATEGORY_MIN = 0.6;
const CATEGORY_MAX = 1.6;
const CATEGORY_MIN_PEERS = 3;
/** The trim: the share of anchors dropped from each tail of market-cap-per-TVL before fitting. */
const TRIM_EACH_SIDE = 0.05;
/** The forward holdout's cut: anchors listed before it train the model, the rest test it. */
const FORWARD_CUTOFF = '2025-01-01';
/** The age the age test imputes when a fit anchor records no listing date. */
const AGE_TEST_UNKNOWN_DAYS = 365;

/** Fit radar-3 on the snapshot: anchors, trim, OLS, category multiples, validation. */
export function fitModel(snapshot: Snapshot): FitResult {
  const anchors = snapshot.protocols.filter(isAnchor).sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  if (anchors.length < 20) throw new SnapshotError(`only ${anchors.length} traded anchors: the model needs at least 20 to fit`);
  const byRatio = [...anchors].sort((a, b) => a.mcap_usd! / a.tvl_usd - b.mcap_usd! / b.tvl_usd || (a.slug < b.slug ? -1 : 1));
  const k = Math.ceil(TRIM_EACH_SIDE * anchors.length);
  const dropped = new Set([...byRatio.slice(0, k), ...byRatio.slice(byRatio.length - k)].map((p) => p.slug));
  const fit = anchors.filter((p) => !dropped.has(p.slug));
  const design = fit.map(designRow);
  const y = fit.map(target);
  const main = ols(design, y);
  const beta = main.beta;

  // Each category's multiple: the median residual of its fit anchors, exponentiated and clamped.
  const byCategory = new Map<string, { residuals: number[]; ratios: number[] }>();
  fit.forEach((p, i) => {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? { residuals: [], ratios: [] };
    list.residuals.push(main.residuals[i]!);
    list.ratios.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  });
  const multiples = new Map<string, { multiplier: number; ratio: number | null; peers: number }>();
  const categories: CategoryFit[] = [];
  for (const [key, list] of [...byCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const peers = list.residuals.length;
    const ratio = round4(median(list.ratios));
    if (peers < CATEGORY_MIN_PEERS) {
      multiples.set(key, { multiplier: 1, ratio: null, peers });
      continue;
    }
    const medResid = median(list.residuals);
    const multiplier = round4(Math.min(CATEGORY_MAX, Math.max(CATEGORY_MIN, Math.exp(medResid))));
    multiples.set(key, { multiplier, ratio, peers });
    categories.push({ category: key, peers, median_residual: round4(medResid), multiplier, median_ratio: ratio });
  }

  // 5-fold cross-validation: fold = fit-set index mod 5, refit on four folds, predict the fifth.
  const cvPred = new Array<number>(fit.length).fill(0);
  for (let fold = 0; fold < 5; fold++) {
    const trainIdx = fit.map((_, i) => i).filter((i) => i % 5 !== fold);
    const testIdx = fit.map((_, i) => i).filter((i) => i % 5 === fold);
    const foldFit = ols(trainIdx.map((i) => design[i]!), trainIdx.map((i) => y[i]!));
    for (const i of testIdx) {
      cvPred[i] = design[i]!.reduce((s, v, j) => s + v * foldFit.beta[j]!, 0);
    }
  }
  const cvR2 = pooledR2(cvPred, y);
  const cvMaeLog = pooledMaeLog(cvPred, y);
  const cvMedApe = pooledMedApe(cvPred, y);

  // Forward holdout by listing date: train on anchors listed before the cut, test the rest.
  const dated = fit.filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < FORWARD_CUTOFF);
  const test = dated.filter((p) => p.listed_at! >= FORWARD_CUTOFF);
  let fwdR2 = NaN;
  let fwdMaeLog = NaN;
  let fwdMedApe = NaN;
  if (train.length >= 10 && test.length >= 5) {
    const fwdFit = ols(train.map(designRow), train.map(target));
    const fwdPred = test.map((p) => designRow(p).reduce((s, v, j) => s + v * fwdFit.beta[j]!, 0));
    const fwdY = test.map(target);
    fwdR2 = pooledR2(fwdPred, fwdY);
    fwdMaeLog = pooledMaeLog(fwdPred, fwdY);
    fwdMedApe = pooledMedApe(fwdPred, fwdY);
  }

  // The age test: refit with age as a fifth term (unknown age imputed) and read its t-statistic.
  const ageDesign = fit.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at) ?? AGE_TEST_UNKNOWN_DAYS;
    return [...designRow(p), 1 - Math.exp(-Math.max(age, 0) / 730)];
  });
  const ageFit = ols(ageDesign, y);
  const ageCoef = ageFit.beta[4]!;
  const ageT = ageCoef / ageFit.se[4]!;
  const ageR2Gain = ageFit.r2 - main.r2;

  const model: FittedModel = {
    intercept: beta[0]!,
    intercept_se: main.se[0]!,
    tvl_exponent: beta[1]!,
    tvl_exponent_se: main.se[1]!,
    growth_coef: beta[2]!,
    growth_coef_se: main.se[2]!,
    chains_coef: beta[3]!,
    chains_coef_se: main.se[3]!,
    growth_mult_min: GROWTH_MULT_MIN,
    growth_mult_max: GROWTH_MULT_MAX,
    breadth_mult_min: BREADTH_MULT_MIN,
    breadth_mult_max: BREADTH_MULT_MAX,
    category_min: CATEGORY_MIN,
    category_max: CATEGORY_MAX,
    category_min_peers: CATEGORY_MIN_PEERS,
    trim_each_side: TRIM_EACH_SIDE,
    n_anchors: anchors.length,
    n_fit: fit.length,
    fit: {
      r2: round4(main.r2),
      adj_r2: round4(main.adjR2),
      resid_sd: round4(main.residSd),
      mae_log: round4(main.maeLog),
      med_ape_pct: round4(main.medApePct),
      cv_folds: 5,
      cv_r2: round4(cvR2),
      cv_mae_log: round4(cvMaeLog),
      cv_med_ape_pct: round4(cvMedApe),
      fwd_cutoff: FORWARD_CUTOFF,
      fwd_n_train: train.length,
      fwd_n_test: test.length,
      fwd_r2: round4(fwdR2),
      fwd_mae_log: round4(fwdMaeLog),
      fwd_med_ape_pct: round4(fwdMedApe),
      age_coef: round4(ageCoef),
      age_t: round4(ageT),
      age_r2_gain: round4(ageR2Gain),
      walk_forward:
        'Not possible: the snapshot is one date, with no time series of TVL or market cap to walk forward over. The listing-date forward holdout above is the closest honest test.',
    },
    categories,
  };
  return { model, multiples };
}

/** The full breakdown one protocol gets under the fitted model. */
export interface ImpliedBreakdown {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  breadthMult: number;
  categoryMult: number;
  categoryRatio: number | null;
  age: number | null;
}

/** The model's one function: every protocol is scored the same way, from its own figures. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: Map<string, { multiplier: number; ratio: number | null; peers: number }>,
  model: FittedModel,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const growthPct = Math.min(100, Math.max(-50, finite(protocol.change_7d, 0)));
  const growthMult = Math.min(model.growth_mult_max, Math.max(model.growth_mult_min, Math.exp(model.growth_coef * (growthPct / 100))));
  const chainCount = Math.max(1, protocol.chains.length);
  const breadthMult = Math.min(model.breadth_mult_max, Math.max(model.breadth_mult_min, Math.exp(model.chains_coef * Math.log(chainCount))));
  const cat = multiples.get(protocol.category ?? 'Other');
  const categoryMult = cat === undefined ? 1 : cat.multiplier;
  const categoryRatio = cat === undefined || cat.ratio === null ? null : cat.ratio;
  const base = Math.exp(model.intercept) * Math.pow(Math.max(1, protocol.tvl_usd), model.tvl_exponent);
  const implied = Math.max(1, Math.round(base * growthMult * breadthMult * categoryMult));
  return {
    implied,
    base: Math.round(base),
    growthPct,
    growthMult: round4(growthMult),
    breadthMult: round4(breadthMult),
    categoryMult: round4(categoryMult),
    categoryRatio,
    age,
  };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, fit: FitResult): BoardRow[] {
  const { model, multiples } = fit;
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor, not just the
  // biggest by TVL. A chosen protocol stays chosen; the board is the watchlist plus the whole early
  // field the radar exists to find.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      base_usd: s.v.base,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      breadth_multiplier: s.v.breadthMult,
      category_multiplier: s.v.categoryMult,
      category_ratio: s.v.categoryRatio,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_usd: row.model.base_usd,
    growth_multiplier: row.model.growth_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_multiplier: row.model.category_multiplier,
    category_ratio: row.model.category_ratio,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const fit = fitModel(snapshot);
  const board = buildBoard(snapshot, fit);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: fit.model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    watchlist_slugs: [...snapshot.watchlist],
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** A second chain when the protocol runs on more than one, else null. */
function secondChainOf(p: SnapshotProtocol): string | null {
  return p.chains.length > 1 ? p.chains[1]! : null;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and leave the deposit earning.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} (half USDC, half the paired asset) and keep the position open.`;
  }
  if (c.includes('yield aggregator') || c.includes('leveraged farm')) {
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} of USDC into ${name}'s main yield vault on ${chain} and let the yield compound.`;
  }
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator')) {
    return `Deposit $${capital} of USDC into a ${name} curated vault on ${chain} and keep the vault shares.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} with USDC and hold it in your wallet.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position through one funding cycle.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} on ${chain} and open one small hedged position of about $${Math.round(capital / 5)}.`;
  }
  if (c.includes('options')) {
    return `Deposit $${capital} of USDC as collateral on ${name} on ${chain} and open one small dated options position.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} of USDC into ${name} on ${chain} and place one position on a market that settles within 30 days.`;
  }
  if (c.includes('staking pool') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token.`;
  }
  if (c.includes('indexes') || c.includes('index')) {
    return `Buy $${capital} of ${name}'s index token on ${chain} and hold it in your wallet.`;
  }
  if (c.includes('payment')) {
    return `Route $${capital} through ${name} on ${chain} to a wallet you control and keep the receipt.`;
  }
  if (c.includes('launchpad')) {
    return `Stake $${capital} of the qualifying asset on ${name} on ${chain} to reach its lowest allocation tier.`;
  }
  if (c.includes('privacy')) {
    return `Deposit $${capital} of USDC into ${name}'s private pool on ${chain} and keep the withdrawal note safe.`;
  }
  if (c.includes('nft')) {
    return `Deposit $${capital} of USDC into ${name}'s lending pool on ${chain} and keep the position open.`;
  }
  if (c.includes('chain')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's second leg: a different action on the same protocol, so the wallet is not one-note. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string, chain2: string | null): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow $${small} of USDC against the deposit on ${name} and repay it within a week, so the wallet shows both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return `Swap $${small} of USDC through ${name}'s own router on ${chain} so the wallet records a trade as well as liquidity.`;
  }
  if (c.includes('yield') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('leveraged farm')) {
    return chain2 === null
      ? `Add $${small} more to a second vault on ${name} so the wallet holds two vault positions, not one.`
      : `Open the same vault position with $${small} on ${chain2} so the wallet is active on two of ${name}'s chains.`;
  }
  if (c.includes('rwa')) {
    return `Check the accrued yield on the ${name} asset after one week and top it up by $${small} if the yield posted.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options')) {
    return `Close the first position after one funding cycle and open a fresh one of about $${small} to keep the account active.`;
  }
  if (c.includes('prediction')) {
    return `Place a second $${small} position on a different ${name} market so the wallet is not tied to one outcome.`;
  }
  if (c.includes('staking pool') || c.includes('restak')) {
    return `Restake the first rewards ${name} pays out, so the staked balance grows instead of sitting idle.`;
  }
  if (c.includes('indexes') || c.includes('index')) {
    return `Rebalance the index holding once after 30 days, selling $${small} and buying the index's other component.`;
  }
  if (c.includes('payment')) {
    return `Send a second $${small} payment through ${name} a week later, to a different wallet you control.`;
  }  if (c.includes('launchpad')) {
    return `Join one ${name} sale with $${small} once the stake qualifies, and keep the allocation receipt.`;
  }
  if (c.includes('privacy')) {
    return `Withdraw $${small} from the private pool after a week and redeposit it, so the wallet shows a full cycle.`;
  }
  if (c.includes('nft')) {
    return `List one NFT-backed loan offer of $${small} on ${name} so the wallet touches its marketplace side too.`;
  }
  if (c.includes('chain')) {
    return `Use $${small} of the bridged funds in ${name}'s app, then bridge the remainder back to where it came from.`;
  }
  return chain2 === null
    ? `Make a second $${small} deposit into ${name} a week later, so the wallet shows repeated use.`
    : `Repeat the deposit with $${small} on ${chain2} so the wallet is active on two of ${name}'s chains.`;
}

/** The category's weekly action, so the wallet stays active while the position is held. */
function weeklyActionFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a small deposit, a borrow or a repayment';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'a swap through the pool or a top-up of the liquidity position';
  if (c.includes('yield') || c.includes('risk curator') || c.includes('capital allocator') || c.includes('curator') || c.includes('leveraged farm')) return 'a vault deposit or a claim of the vault yield';
  if (c.includes('rwa')) return 'a yield check and a small top-up';
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('basis') || c.includes('options')) return 'a small trade or a margin top-up';
  if (c.includes('prediction')) return 'a small position on a new market';
  if (c.includes('staking pool') || c.includes('restak')) return 'a restake of the rewards';
  if (c.includes('indexes') || c.includes('index')) return 'a small buy of the index token';
  if (c.includes('payment')) return 'a small payment through the protocol';
  if (c.includes('launchpad')) return 'a check of the allocation tier and any open sale';
  if (c.includes('privacy')) return 'a small deposit into the private pool';
  if (c.includes('nft')) return 'a small deposit into the lending pool';
  if (c.includes('chain')) return 'a small bridge and one use of the app';
  return 'a deposit, a swap or a vote';
}

/** Whether a farm position holds capital in place (vs a flow-through action like a payment). */
function holdsCapital(p: SnapshotProtocol): boolean {
  const c = (p.category ?? '').toLowerCase();
  return !c.includes('payment') && !c.includes('chain');
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): { text: string; cost: string; time: string }[] {
  const chain = chainOf(p);
  const chain2 = secondChainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weekly = weeklyActionFor(p);
  const holdStep = holdsCapital(p)
    ? {
        text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
        cost: `the $${capital} stays in the position`,
        time: `${hold} days`,
      }
    : {
        text: `Stay active on the protocol for at least ${hold} days, repeating the action each week, so the activity is counted in more than one snapshot.`,
        cost: 'about $2 of gas a week',
        time: `${hold} days`,
      };
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm with, and keep its seed phrase offline on paper.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: secondActionFor(p, capital, chain, chain2),
      cost: `about $${capital >= 150 ? 5 : 3} of gas`,
      time: '10 minutes',
    },
    {
      text: holdsCapital(p)
        ? `Make one qualifying action each week while the position is open, such as ${weekly}.`
        : `Make one qualifying action each week, such as ${weekly}, and keep it up for the full ${hold} days.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    holdStep,
    {
      text: `Before you withdraw, open ${p.name}'s own points or rewards page from the link it publishes and claim only there, then write the wallet, the dates and every transaction in a farm log.`,
      cost: 'no fee to check, and never pay to claim',
      time: '15 minutes',
    },
  ];
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

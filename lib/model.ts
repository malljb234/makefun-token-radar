// The token radar's model: one sealed snapshot in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the floor that are not a wrapped, staked or bridged product of a token that
// already trades. A protocol is pre-token when its record carries no token (no market cap, no
// CoinGecko id, no symbol); the live-token protocols are kept apart and shown with the market's own
// values, never mixed into the ranking.
//
// Implied value follows only from the snapshot's own figures, through one function that scores every
// protocol the same way. No name is ever special-cased.
//
//   base      = BASE_COEF x tvl_usd ^ TVL_EXPONENT        (log-scaled: a 100x TVL gap is not a 100x
//                                                          value gap, so mega-TVL cannot swamp the board)
//   growth    = clamp(change_7d, GROWTH_FLOOR, GROWTH_CAP) per cent, symmetric: a crash hurts as much
//               as a spike helps, and a +200% week is capped before it can dominate
//   growthMult= 1 + GROWTH_WEIGHT x growth / 100
//   maturity  = MATURITY_FLOOR + MATURITY_RANGE x (1 - exp(-age_days / MATURITY_HALF_LIFE))
//               age_days is days since listed_at; longer with no token means more pent-up value, with
//               diminishing returns; unknown age uses UNKNOWN_AGE_DAYS
//   breadth   = 1 + BREADTH_WEIGHT x ln(chains)            (capped: more chains means wider adoption)
//   category  = the category's own market multiple: the median mcap/tvl of the live-token protocols
//               in the same category, normalised by CATEGORY_NORM and clamped; categories with fewer
//               than CATEGORY_MIN_PEERS live peers use 1.0. It is computed from the snapshot at run
//               time, never written in by hand.
//   implied   = max(1, round(base x growthMult x maturity x breadth x category))
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  base_coef: number;
  tvl_exponent: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_half_life_days: number;
  unknown_age_days: number;
  breadth_weight: number;
  breadth_cap: number;
  category_norm: number;
  category_min: number;
  category_max: number;
  category_min_peers: number;
}

export const MODEL: ModelConstants = {
  base_coef: 1.3,
  tvl_exponent: 0.9,
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.5,
  maturity_half_life_days: 730,
  unknown_age_days: 365,
  breadth_weight: 0.12,
  breadth_cap: 1.5,
  category_norm: 0.25,
  category_min: 0.6,
  category_max: 1.6,
  category_min_peers: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

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
    maturity_multiplier: number;
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
  maturity_multiplier: number;
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
  model: ModelConstants;
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

/**
 * Each category's market multiple, from the snapshot's own live-token protocols: the median
 * market-cap-per-dollar-of-TVL of the category's live protocols, normalised and clamped. A category
 * with too few live peers gets 1.0, so no thin category can tilt the board on one outlier.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): Map<string, { multiplier: number; ratio: number | null; peers: number }> {
  const byCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null && p.symbol === null) continue;
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    byCategory.set(key, list);
  }
  const out = new Map<string, { multiplier: number; ratio: number | null; peers: number }>();
  for (const [key, ratios] of byCategory) {
    const sorted = [...ratios].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const peers = sorted.length;
    if (peers < model.category_min_peers) {
      out.set(key, { multiplier: 1, ratio: null, peers });
      continue;
    }
    const clamped = Math.min(0.8, Math.max(0.05, median));
    const multiplier = Math.min(model.category_max, Math.max(model.category_min, clamped / model.category_norm));
    out.set(key, { multiplier: round4(multiplier), ratio: round4(median), peers });
  }
  return out;
}

/** The full breakdown one protocol gets under the model. */
export interface ImpliedBreakdown {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
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
  model: ModelConstants = MODEL,
): ImpliedBreakdown {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_half_life_days));
  const chainCount = Math.max(1, protocol.chains.length);
  const breadthMult = Math.min(model.breadth_cap, 1 + model.breadth_weight * Math.log(chainCount));
  const cat = multiples.get(protocol.category ?? 'Other');
  const categoryMult = cat === undefined ? 1 : cat.multiplier;
  const categoryRatio = cat === undefined || cat.ratio === null ? null : cat.ratio;
  const base = model.base_coef * Math.pow(Math.max(1, protocol.tvl_usd), model.tvl_exponent);
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult * categoryMult));
  return {
    implied,
    base: Math.round(base),
    growthPct,
    growthMult: round4(growthMult),
    maturityMult: round4(maturityMult),
    breadthMult: round4(breadthMult),
    categoryMult: round4(categoryMult),
    categoryRatio,
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are a wrapped, staked or bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Exchanges whose name at the start of a protocol's name marks it as their product. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** A whole word in the name that marks a wrapped or staked product. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
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

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = categoryMultiples(snapshot, model);
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
      maturity_multiplier: s.v.maturityMult,
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
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_multiplier: row.model.category_multiplier,
    category_ratio: row.model.category_ratio,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
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

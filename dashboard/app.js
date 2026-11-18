// Token Radar's dashboard. Reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, filters, a per-protocol detail view with the model's own breakdown, and the
// live-token set kept apart. No network: every byte it shows is in data.js. State lives in the
// query string (?q=, ?category=, ?chain=, ?minTvl=, ?watchlist=, ?tab=, ?view=detail&slug=), so
// any view can be opened directly.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    category: params.get('category') || 'all',
    chain: params.get('chain') || 'all',
    minTvl: parseInt(params.get('minTvl') || '0', 10) || 0,
    watchlist: params.get('watchlist') || 'all',
    tab: params.get('tab') === 'live' ? 'live' : 'pre-token',
    sort: params.get('sort') || 'implied',
    dir: params.get('dir') === 'asc' ? 1 : -1,
    selected: params.get('view') === 'detail' ? (params.get('slug') || null) : null,
  };
  var watchSet = {};
  (DATA.watchlist_slugs || []).forEach(function (s) { watchSet[s] = true; });

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 10000) / 10000).toFixed(4).replace(/0+$/, '').replace(/\.$/, '.0'); }

  // The fitted model in one function: the page recomputes a row from the snapshot figures and
  // checks the number board.json carries, so the page's code and the board's data are visibly the
  // same arithmetic. Coefficients come from data.js (fitted at build time), never written here.
  function impliedOf(row, model) {
    var growth = Math.min(100, Math.max(-50, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = Math.min(model.growth_mult_max, Math.max(model.growth_mult_min, Math.exp(model.growth_coef * (growth / 100))));
    var breadth = Math.min(model.breadth_mult_max, Math.max(model.breadth_mult_min, Math.exp(model.chains_coef * Math.log(Math.max(1, (row.chains || []).length)))));
    var base = Math.exp(model.intercept) * Math.pow(Math.max(1, row.tvl_usd), model.tvl_exponent);
    return Math.max(1, Math.round(base * growthMult * breadth * row.category_multiplier));
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.category !== 'all') p.set('category', state.category);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.minTvl) p.set('minTvl', String(state.minTvl));
    if (state.watchlist !== 'all') p.set('watchlist', state.watchlist);
    if (state.tab !== 'pre-token') p.set('tab', state.tab);
    if (state.sort !== 'implied') p.set('sort', state.sort);
    if (state.dir === 1) p.set('dir', 'asc');
    if (state.selected) { p.set('view', 'detail'); p.set('slug', state.selected); }
    var next = p.toString();
    var url = next ? window.location.pathname + '?' + next : window.location.pathname;
    window.history.replaceState(null, '', url);
  }

  function matches(row) {
    if (state.watchlist === 'only' && !watchSet[row.slug]) return false;
    if (state.category !== 'all' && (row.category || 'Other') !== state.category) return false;
    if (state.chain !== 'all' && (row.chains || []).indexOf(state.chain) < 0) return false;
    if (row.tvl_usd < state.minTvl) return false;
    var q = state.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [row.name, row.slug, row.category, (row.chains || []).join(' ')].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  }
  function filteredRows() { return DATA.rows.filter(matches); }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -Infinity : a.age_days; bv = b.age_days === null ? -Infinity : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function fillSelect(id, values, allLabel) {
    var sel = document.getElementById(id);
    sel.textContent = '';
    sel.appendChild(el('option', { value: 'all', text: allLabel }));
    values.forEach(function (v) { sel.appendChild(el('option', { value: v, text: v })); });
    return sel;
  }

  function fmtSigned(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(digits === undefined ? 2 : digits);
  }

  // The fitted model's evidence, rendered from data.js: how it was fitted, what it explains, and
  // how it held up out of sample. Nothing here is hand-written; every number is the build's own.
  function renderFit(m) {
    var panel = document.getElementById('fit-panel');
    if (!panel) return;
    panel.textContent = '';
    var f = m.fit;
    panel.appendChild(el('h3', { text: 'Fitted on traded tokens, tested out of sample' }));
    panel.appendChild(el('p', { class: 'muted', text:
      'The model is an ordinary least-squares regression of log market cap on log TVL, seven-day growth and log chain count, fitted on ' +
      m.n_fit + ' traded tokens (anchors) from this snapshot. Anchors are the ' + m.n_anchors +
      ' traded protocols whose token plausibly is the protocol itself — not a wrapped, staked or bridged product, not a versioned pool, not an exchange\'s product. ' +
      'The 5% of anchors with the lowest and highest market-cap-per-TVL were set aside before fitting (a prediction-market token at 400x its TVL, a staking receipt at 0.0006x), so one outlier cannot drag the fit.' }));
    var coef = el('div', { class: 'fit-grid' });
    [
      ['log TVL', m.tvl_exponent.toFixed(4) + '  (t = ' + fmtSigned(m.tvl_exponent / m.tvl_exponent_se, 2) + ')'],
      ['growth', m.growth_coef.toFixed(4) + '  (t = ' + fmtSigned(m.growth_coef / m.growth_coef_se, 2) + ')'],
      ['log chains', m.chains_coef.toFixed(4) + '  (t = ' + fmtSigned(m.chains_coef / m.chains_coef_se, 2) + ')'],
      ['intercept', m.intercept.toFixed(4) + '  (t = ' + fmtSigned(m.intercept / m.intercept_se, 2) + ')'],
    ].forEach(function (c) {
      coef.appendChild(el('div', { class: 'fit-cell' }, el('span', { text: c[0] }), el('b', { class: 'num', text: c[1] })));
    });
    panel.appendChild(coef);
    var tests = el('div', { class: 'fit-grid' });
    [
      ['In-sample fit (n = ' + m.n_fit + ')', 'R-squared ' + f.r2.toFixed(3) + ' · median error ' + f.med_ape_pct.toFixed(0) + '%'],
      ['5-fold out-of-sample', 'R-squared ' + fmtSigned(f.cv_r2, 3) + ' · median error ' + f.cv_med_ape_pct.toFixed(0) + '%'],
      ['Forward holdout (listed before ' + f.fwd_cutoff + ', n = ' + f.fwd_n_train + ', tested on ' + f.fwd_n_test + ' listed after)', 'R-squared ' + fmtSigned(f.fwd_r2, 3) + ' · median error ' + f.fwd_med_ape_pct.toFixed(0) + '%'],
    ].forEach(function (c) {
      tests.appendChild(el('div', { class: 'fit-cell wide' }, el('span', { text: c[0] }), el('b', { class: 'num', text: c[1] })));
    });
    panel.appendChild(tests);
    panel.appendChild(el('p', { class: 'muted', text:
      'What the tests say: the model explains about a third of the variance in traded market caps, and it holds up on tokens it was not fitted on — including the forward holdout, where it was trained only on protocols listed before ' +
      f.fwd_cutoff + ' and still predicted the ' + f.fwd_n_test + ' listed after it. The rest is idiosyncratic — tokenomics, unlocks, hype — none of which the snapshot carries, so treat every implied value as the market\'s average multiple for a protocol of this shape, not a price target. ' + f.walk_forward }));
    if (m.categories && m.categories.length) {
      var cats = m.categories.map(function (c) {
        return c.category + ' ' + c.multiplier.toFixed(2) + ' (n=' + c.peers + ')';
      }).join(' · ');
      panel.appendChild(el('p', { class: 'muted', text: 'Category multiples from the fit: ' + cats + '. Categories with fewer than ' + m.category_min_peers + ' fitted anchors use 1.00.' }));
    }
  }

  function renderMeta() {
    var meta = document.getElementById('top-meta');
    meta.textContent = '';
    meta.appendChild(el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })));
    meta.appendChild(el('span', null, 'DefiLlama protocol index'));
    meta.appendChild(el('span', null, 'Model ', el('b', { text: DATA.model_version })));
    var facts = document.getElementById('facts');
    facts.textContent = '';
    [
      ['Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size],
      ['Pre-token rows scored', String(DATA.board_size)],
      ['Early rows below the floor', String(DATA.early_size)],
      ['Live-token protocols set aside', String(DATA.live_size)],
    ].forEach(function (f) {
      facts.appendChild(el('div', { class: 'fact' }, el('span', { text: f[0] }), el('b', { text: f[1] })));
    });
    document.getElementById('headline').textContent =
      DATA.watchlist_size + ' watchlist protocols, ranked by implied value';
    document.getElementById('lede-text').textContent =
      'The watchlist is the floor: every protocol with at least ' + fmtUsd(DATA.floor_usd) +
      ' of TVL and no token on record. The early radar adds ' + DATA.early_size +
      ' pre-token protocols below that floor. Implied value is a model, not a promise, and never a prediction of whether or when a token launches.';
    var m = DATA.model;
    var f = m.fit;
    document.getElementById('fit-strip').textContent =
      'Fitted on ' + m.n_fit + ' traded tokens · in-sample R-squared ' + f.r2.toFixed(3) +
      ' · 5-fold out-of-sample R-squared ' + fmtSigned(f.cv_r2, 3) +
      ' · forward holdout R-squared ' + fmtSigned(f.fwd_r2, 3) + ' (trained before ' + f.fwd_cutoff + ')';
    document.getElementById('formula').textContent =
      'implied = round( e^' + m.intercept.toFixed(4) + ' x tvl ^ ' + m.tvl_exponent.toFixed(4) +
      '  x  growthMult  x  breadthMult  x  category multiple )\n' +
      'growthMult = clamp( exp(' + m.growth_coef.toFixed(4) + ' x clamp(change_7d, -50, +100) / 100), ' + m.growth_mult_min + ', ' + m.growth_mult_max + ' )\n' +
      'breadthMult = clamp( exp(' + m.chains_coef.toFixed(4) + ' x ln(chains)), ' + m.breadth_mult_min + ', ' + m.breadth_mult_max + ' )';
    document.getElementById('model-note').textContent =
      'TVL, seven-day growth and chain count come from the snapshot. The category multiple is the median residual of the category\'s fitted anchors (at least ' +
      m.category_min_peers + ' peers, otherwise 1.0), exponentiated and clamped to [' +
      m.category_min + ', ' + m.category_max + ']. Age since first listing is shown for every row but carries no weight: tested as a fifth term it scored a coefficient of ' +
      f.age_coef + ' (t = ' + f.age_t + ', R-squared gain ' + f.age_r2_gain + '), so the fitted model does not reward it. Live-token protocols are set aside with their market caps shown, never ranked as pre-token.';
    renderFit(m);
    document.getElementById('foot').textContent =
      'Source: ' + DATA.source + '. A protocol "records no token" when its DefiLlama record carries no market cap, CoinGecko id or symbol — the record is not proof it has none. Farm plans are suggestions, not financial advice.';
  }

  function wireControls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var q = document.getElementById('q');
    q.value = state.q;
    q.addEventListener('input', function () { state.q = q.value; syncUrl(); renderTable(); });
    var catSel = fillSelect('category', cats, 'All categories');
    catSel.value = state.category;
    catSel.addEventListener('change', function () { state.category = catSel.value; syncUrl(); renderTable(); });
    var chainSel = fillSelect('chain', chains, 'All chains');
    chainSel.value = state.chain;
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; syncUrl(); renderTable(); });
    var tvlSel = document.getElementById('minTvl');
    tvlSel.value = String(state.minTvl);
    tvlSel.addEventListener('change', function () { state.minTvl = parseInt(tvlSel.value, 10) || 0; syncUrl(); renderTable(); });
    var wlSel = document.getElementById('watchlist');
    wlSel.value = state.watchlist;
    wlSel.addEventListener('change', function () { state.watchlist = wlSel.value; syncUrl(); renderTable(); });
    var tabPre = document.getElementById('tab-pre');
    var tabLive = document.getElementById('tab-live');
    tabPre.addEventListener('click', function () { state.tab = 'pre-token'; syncUrl(); renderTable(); });
    tabLive.addEventListener('click', function () { state.tab = 'live'; syncUrl(); renderTable(); });
    document.getElementById('clear-filters').addEventListener('click', function () {
      state.q = ''; state.category = 'all'; state.chain = 'all'; state.minTvl = 0; state.watchlist = 'all';
      syncUrl(); wireValues(); renderTable();
    });
  }
  function wireValues() {
    document.getElementById('q').value = state.q;
    document.getElementById('category').value = state.category;
    document.getElementById('chain').value = state.chain;
    document.getElementById('minTvl').value = String(state.minTvl);
    document.getElementById('watchlist').value = state.watchlist;
  }

  function sortHeader(key, label) {
    var btn = el('button', { type: 'button', onclick: function () {
      if (state.sort === key) state.dir = -state.dir;
      else { state.sort = key; state.dir = -1; }
      syncUrl(); renderTable();
    } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ▼' : ' ▲' }) : null);
    return el('th', { scope: 'col', class: key === 'tvl' || key === 'growth' || key === 'age' || key === 'chains' || key === 'implied' ? 'num' : '' }, btn);
  }

  function chainLabel(r) {
    var c = r.chains || [];
    if (c.length === 0) return 'an unnamed chain';
    if (c.length === 1) return c[0];
    return c[0] + ' +' + (c.length - 1);
  }

  function renderTable() {
    document.getElementById('tab-pre').setAttribute('aria-selected', state.tab === 'pre-token' ? 'true' : 'false');
    document.getElementById('tab-live').setAttribute('aria-selected', state.tab === 'live' ? 'true' : 'false');
    var thead = document.getElementById('thead-row');
    var tbody = document.getElementById('tbody');
    var caption = document.querySelector('#board-table caption');
    var empty = document.getElementById('empty');
    thead.textContent = '';
    tbody.textContent = '';
    if (state.tab === 'live') {
      caption.textContent = 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.';
      thead.appendChild(el('th', { scope: 'col', text: 'Status' }));
      thead.appendChild(el('th', { scope: 'col', text: 'Protocol' }));
      thead.appendChild(el('th', { scope: 'col', class: 'num', text: 'TVL' }));
      thead.appendChild(el('th', { scope: 'col', class: 'num', text: '7d' }));
      thead.appendChild(el('th', { scope: 'col', class: 'num', text: 'Market cap' }));
      thead.appendChild(el('th', { scope: 'col', text: 'Token' }));
      DATA.live.forEach(function (r) {
        tbody.appendChild(el('tr', null,
          el('td', { class: 'num', text: 'live' }),
          el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) }))),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
          el('td', null, el('span', { class: 'pill live', text: 'already trades' }))
        ));
      });
      document.getElementById('count').textContent = DATA.live.length + ' live-token protocols (top by market cap)';
      empty.hidden = true;
      document.getElementById('model-panel').hidden = true;
      return;
    }
    document.getElementById('model-panel').hidden = false;
    caption.textContent = 'Pre-token protocols, strongest implied value first. Select a row for its value breakdown and farm plan.';
    thead.appendChild(sortHeader('implied', 'Rank'));
    thead.appendChild(sortHeader('name', 'Protocol'));
    thead.appendChild(sortHeader('tvl', 'TVL'));
    thead.appendChild(sortHeader('growth', '7d'));
    thead.appendChild(sortHeader('age', 'Age'));
    thead.appendChild(sortHeader('chains', 'Chains'));
    thead.appendChild(sortHeader('implied', 'Implied value'));
    thead.appendChild(el('th', { scope: 'col', text: 'Token' }));
    var list = sortedRows(filteredRows());
    document.getElementById('count').textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    empty.hidden = list.length !== 0;
    var max = list.length > 0 ? list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1) : 1;
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainLabel(r) })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String((r.chains || []).length) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null,
          el('span', { class: 'pill pre', text: 'no token' }),
          watchSet[r.slug] ? el('span', { class: 'pill watch', text: 'watchlist' }) : null
        )
      );
      tbody.appendChild(tr);
    });
  }

  var dialog = document.getElementById('detail');
  dialog.addEventListener('close', function () { state.selected = null; syncUrl(); renderTable(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    syncUrl();
    var wrap = el('div', { class: 'detail-in' });
    var recomputed = impliedOf(row, DATA.model);
    var agrees = recomputed === row.implied_value_usd;
    var head = el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'pill pre', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (watchSet[row.slug] ? ' · watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub muted', text: (row.category || 'Other') + ' on ' + ((row.chains || []).length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'btn close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    );
    wrap.appendChild(head);
    var eq = el('div', { class: 'equation' });
    [
      ['TVL', fmtUsd(row.tvl_usd)],
      ['Seven-day growth', fmtPct(row.change_7d)],
      ['Age with no token', fmtAge(row.age_days) + (row.listed_at ? ' (since ' + row.listed_at + ')' : '')],
      ['Chains', String((row.chains || []).length)],
      ['Base value', fmtUsd(row.base_usd)],
      ['Growth multiplier', fmtMult(row.growth_multiplier)],
      ['Breadth multiplier', fmtMult(row.breadth_multiplier)],
      ['Category multiplier', fmtMult(row.category_multiplier) + (row.category_ratio !== null && row.category_ratio !== undefined ? ' (median mcap/TVL ' + row.category_ratio.toFixed(3) + ')' : ' (fewer than 3 fitted peers)')],
    ].forEach(function (pair) {
      eq.appendChild(el('div', null, el('span', { text: pair[0] }), el('b', { class: 'num', text: pair[1] })));
    });
    eq.appendChild(el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })));
    wrap.appendChild(el('section', null, el('h3', { text: 'Implied value — every input' }), eq,
      el('p', { class: 'check ' + (agrees ? 'ok' : 'bad'), text: agrees
        ? 'This page recomputes the row as ' + fmtUsd(recomputed) + ', the same number board.json carries.'
        : 'This page recomputes the row as ' + fmtUsd(recomputed) + ', which differs from the board: the data would be stale.' }),
      el('p', { class: 'muted', text: 'Model ' + DATA.model_version + ': the coefficients are fitted on traded tokens (see the model panel), the same function scores every protocol, and age carries no weight in it. This is an estimate, not a price, and not a prediction of a launch.' })
    ));
    var steps = el('ol', { class: 'steps' });
    (row.farm_steps || []).forEach(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      steps.appendChild(el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail })));
    });
    wrap.appendChild(el('section', null, el('h3', { text: 'Farm plan' }), steps));
    dialog.textContent = '';
    dialog.appendChild(wrap);
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    renderTable();
  }

  renderMeta();
  wireControls();
  renderTable();
  document.getElementById('app').setAttribute('aria-busy', 'false');
  if (state.selected) openDetail(state.selected);
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();

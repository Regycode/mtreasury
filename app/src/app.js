(() => {
  const $ = (s) => document.querySelector(s);
  const KIND = {
    capital: 'Shareholder capital', transfer: 'Internal movement', fee: 'Transaction cost', collection: 'Customer deposit',
    payout: 'Customer payout', fee_income: 'Fee charged to customer', opening: 'Opening balance', expense: 'Expense',
    investment: 'Investment', income: 'Other income', settle: 'Unallocated cost settled',
  };
  const ACCT_FIXED = {
    'fa:cost': 'Fixed assets', 'fa:accdep': 'Accumulated depreciation', 'liab:customer': 'Customer money owed',
    'liab:suspense': 'Unreconciled differences', 'liab:unallocated': 'Unallocated expenses', 'eq:capital': 'Share capital', 'rev:collection': 'Collection fees',
    'rev:disbursement': 'Disbursement fees', 'rev:other': 'Other income', 'cost:bank': 'Bank fees', 'cost:telco': 'Telco fees',
    'dep:expense': 'Depreciation', 'cost:exceptional': 'Exceptional items (HAO)',
  };
  const acctName = (a) => a.startsWith('cash:') ? CASH[a.slice(5)] || a : a.startsWith('opex:') ? a.slice(5) : ACCT_FIXED[a] || a;
  const STATUS_LABEL = { confirmed: 'Confirmed', estimate: 'Estimate', check: 'To check', manual: 'Added by you' };
  const CASH_BASIS = {
    cca: 'CCA bank statement', mtn_disb: 'MTN export and reported balance', mtn_coll: 'Moonie platform records',
    orange: 'Desk sheet and Orange letter', off: 'Reported by founder', transit: 'CCA transfer, destination unknown',
  };
  const CASH_STATUS = { cca: 'confirmed', mtn_disb: 'confirmed', mtn_coll: 'confirmed', orange: 'estimate', off: 'estimate', transit: 'check' };

  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const num = (v) => { const n = Math.round(Number(v) || 0); return n === 0 ? 0 : n; };
  const xaf = (v) => nf.format(num(v));
  const acc = (v) => { const n = num(v); return n === 0 ? '–' : n < 0 ? '(' + nf.format(-n) + ')' : nf.format(n); };
  const monthLabel = (mk) => new Date(mk + '-01T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const todayIso = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const statusOf = (e) => e.origin === 'manual' ? 'manual' : (e.status || 'confirmed');

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  }
  const td = (v, cls) => el('td', { class: cls }, v);
  const pill = (s) => el('span', { class: 'pill ' + s }, STATUS_LABEL[s] || s);
  const fill = (sel, rows) => { const b = $(sel + ' tbody'); b.replaceChildren(...rows); };

  const useCap = async (n) => (window.claude && typeof window.claude.use === 'function') ? window.claude.use(n) : null;
  let entries = [];
  let books = buildBooks([], todayIso());
  let loaded = false;
  let db = null, user = null, canWrite = true;

  // ---------- tabs
  const TABS = ['overview', 'add', 'statements', 'journal', 'notes'];
  function go(tab) {
    if (!TABS.includes(tab)) tab = 'overview';
    for (const t of TABS) {
      document.querySelector(`section[data-tab="${t}"]`).hidden = t !== tab;
      $('#tab-' + t).setAttribute('aria-selected', String(t === tab));
    }
    try { localStorage.setItem('mb-tab', tab); } catch (_) {}
  }
  document.querySelectorAll('nav.tabs button').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));

  // ---------- overview
  function renderOverview() {
    const B = books.BS[books.BS.length - 1];
    const totIS = books.IS.reduce((s, r) => s + r.ordinary, 0);
    const totNet = books.IS.reduce((s, r) => s + r.net, 0);
    const capital = books.entries.filter((e) => e.kind === 'capital' || (e.kind === 'settle' && e.from === 'shareholder'));
    const kpis = [
      ['Cash across all accounts', xaf(B.cashTotal) + ' XAF', 'Bank, wallets and off platform'],
      ['Shareholder input', xaf(B.capital) + ' XAF', capital.length + ' contributions'],
      ['Customer money owed', xaf(B.customer) + ' XAF', 'Held for clients, not Moonie\'s'],
      ['Ordinary result to date', (totIS < 0 ? '−' : '') + xaf(Math.abs(totIS)) + ' XAF', 'Net after exceptional items: ' + (totNet < 0 ? '−' : '') + xaf(Math.abs(totNet))],
    ];
    $('#kpis').replaceChildren(...kpis.map(([l, v, s]) => el('div', { class: 'kpi' }, el('span', { class: 'l' }, l), el('span', { class: 'v' }, v), el('span', { class: 's' }, s))));
    $('#cashline').replaceChildren('Cash today ', el('b', {}, xaf(B.cashTotal)), ' XAF · books ', B.check === 0 ? 'balance' : 'do not balance');

    // shareholder input by person
    const by = {};
    for (const e of capital) {
      const k = e.counterparty || 'Not named';
      const o = by[k] || (by[k] = { amt: 0, where: new Set(), st: new Set() });
      o.amt += num(e.amount); o.where.add(e.kind === 'settle' ? 'Costs paid personally' : CASH[e.to] || e.to); o.st.add(statusOf(e));
    }
    const capRows = Object.entries(by).sort((a, b) => b[1].amt - a[1].amt).map(([k, o]) => el('tr', {},
      td(k), td([...o.where].join(', '), 'hide-sm'), td(xaf(o.amt), 'n'),
      td(pill(o.st.has('check') ? 'check' : o.st.has('estimate') ? 'estimate' : o.st.has('manual') ? 'manual' : 'confirmed'))));
    capRows.push(el('tr', { class: 'total' }, td('Total'), td('', 'hide-sm'), td(xaf(B.capital), 'n'), td('')));
    fill('#t-capital', capRows);

    // costs by month
    const bankT = books.IS.reduce((s, r) => s + r.bank, 0), telT = books.IS.reduce((s, r) => s + r.telco, 0);
    fill('#t-costs', books.IS.map((r) => el('tr', {}, td(monthLabel(r.month)), td(acc(r.bank), 'n'), td(acc(r.telco), 'n'), td(acc(r.txn), 'n')))
      .concat([el('tr', { class: 'total' }, td('Total'), td(xaf(bankT), 'n'), td(xaf(telT), 'n'), td(xaf(bankT + telT), 'n'))]));
    const tot = bankT + telT || 1;
    $('#cost-bar').replaceChildren(el('i', { style: `width:${100 * bankT / tot}%;background:var(--accent)` }), el('i', { style: `width:${100 * telT / tot}%;background:var(--warn)` }));
    $('#cost-legend').replaceChildren(
      el('span', {}, el('i', { class: 'sw', style: 'background:var(--accent)' }), 'Bank ' + Math.round(100 * bankT / tot) + '%'),
      el('span', {}, el('i', { class: 'sw', style: 'background:var(--warn)' }), 'Telco ' + Math.round(100 * telT / tot) + '%'));
    const moved = books.entries.filter((e) => e.kind === 'collection' || e.kind === 'payout').reduce((s, e) => s + num(e.amount), 0);
    $('#cost-ratio').textContent = moved
      ? `Telco fees come to ${(100 * telT / moved).toFixed(2)} XAF per 100 XAF of customer money moved (${xaf(moved)} XAF in and out). Bank fees are mostly SMS-banking charges.`
      : '';

    // internal movements
    const moves = books.entries.filter((e) => e.kind === 'transfer');
    fill('#t-moves', moves.length ? moves.map((e) => el('tr', {},
      td(dayLabel(e.date)), td([CASH[e.from] || e.from, el('span', { class: 'arrow' }, ' → '), CASH[e.to] || e.to]),
      td(xaf(e.amount), 'n'), td(pill(statusOf(e))))) : [el('tr', {}, el('td', { colspan: 4, class: 'empty' }, 'No internal movements yet.'))]);

    // customer money
    const sumK = (k, f = 'amount') => books.entries.filter((e) => e.kind === k).reduce((s, e) => s + num(e[f]), 0);
    const opening = books.entries.filter((e) => e.kind === 'opening' && e.against === 'customer').reduce((s, e) => s + num(e.amount), 0);
    const rows = [
      ['Brought in (opening balances)', opening],
      ['Deposited by customers', sumK('collection')],
      ['Fees Moonie charged them', -sumK('fee_income')],
      ['Paid out for customers', -sumK('payout')],
    ];
    fill('#t-customer', rows.map(([l, v]) => el('tr', {}, td(l), td(acc(v), 'n')))
      .concat([el('tr', { class: 'grand' }, td('Owed to customers now'), td(acc(B.customer), 'n'))]));

    // cash by account
    fill('#t-cash', Object.keys(CASH).map((k) => el('tr', {}, td(CASH[k]), td(acc(B.cash[k]), 'n' + (B.cash[k] < 0 ? ' neg' : '')), td(pill(CASH_STATUS[k])), td(CASH_BASIS[k], 'hide-sm')))
      .concat([el('tr', { class: 'grand' }, td('Total cash'), td(xaf(B.cashTotal), 'n'), td(''), td('', 'hide-sm'))]));
  }

  // ---------- month by month
  const compact = (v) => { const a = Math.abs(v), s = v < 0 ? '−' : ''; return a >= 1e6 ? s + (a / 1e6).toFixed(a % 1e6 ? 1 : 0) + 'M' : a >= 1e3 ? s + Math.round(a / 1e3) + 'k' : s + Math.round(a); };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const sv = (tag, attrs) => { const n = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, v); return n; };
  function niceTicks(lo, hi, count) {
    const span = hi - lo || 1, raw = span / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || 10 * mag;
    const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(Math.round(v)); return out;
  }
  function renderMonthly() {
    const M = monthlyStats(books);
    const sumK = (k) => M.reduce((s, m) => s + m[k], 0);
    fill('#t-monthly', M.map((m) => el('tr', {},
      td(monthLabel(m.month)), td(acc(m.income), 'n'), td(acc(m.cumIncome), 'n hide-sm'), td(acc(-m.fixed), 'n'), td(acc(-m.telco), 'n hide-sm'),
      td(acc(m.ordinary), 'n' + (m.ordinary < 0 ? ' neg' : '')), td(acc(m.cumNet), 'n' + (m.cumNet < 0 ? ' neg' : '')),
      td(xaf(m.transactions), 'n'), td(xaf(m.bankCount), 'n'), td(acc(m.bankIn), 'n hide-sm'), td(acc(-m.bankOut), 'n hide-sm'))).concat([
      el('tr', { class: 'total' }, td('Total'), td(acc(sumK('income')), 'n'), td('', 'hide-sm'), td(acc(-sumK('fixed')), 'n'), td(acc(-sumK('telco')), 'n hide-sm'),
        td(acc(sumK('ordinary')), 'n'), td(acc(M.length ? M[M.length - 1].cumNet : 0), 'n'), td(xaf(sumK('transactions')), 'n'), td(xaf(sumK('bankCount')), 'n'),
        td(acc(sumK('bankIn')), 'n hide-sm'), td(acc(-sumK('bankOut')), 'n hide-sm'))]));

    const C = { income: 'var(--ok)', fixed: 'var(--warn)', cum: 'var(--accent)' };
    $('#m-legend').replaceChildren(
      el('span', {}, el('i', { class: 'sw', style: `background:${C.income}` }), 'Income'),
      el('span', {}, el('i', { class: 'sw', style: `background:${C.fixed}` }), 'Fixed costs'));
    const tipLines = (m) => [el('div', { style: 'color:var(--muted)' }, monthLabel(m.month)),
      el('div', {}, 'Income ', el('b', {}, xaf(m.income))), el('div', {}, 'Fixed costs ', el('b', {}, xaf(m.fixed))),
      el('div', {}, 'Result to date ', el('b', {}, acc(m.cumNet))), el('div', {}, m.transactions + ' customer transactions · ' + m.bankCount + ' bank movements')];
    monthChart('#m-bars', M, [m => m.income, m => m.fixed], 'bars', [C.income, C.fixed], tipLines);
    monthChart('#m-line', M, [m => m.cumNet], 'line', [C.cum], tipLines);
  }
  // One small chart per job: grouped bars, or a line with points. Scale fits its own series.
  function monthChart(sel, M, series, type, colors, tipLines) {
    const box = $(sel);
    box.replaceChildren();
    if (!M.length) return;
    const W = Math.max(280, box.clientWidth || 480), H = 200, mt = 10, mb = 24;
    const vals = M.flatMap((m) => series.map((f) => f(m)));
    const ticks = niceTicks(Math.min(0, ...vals), Math.max(0, ...vals, 1), 4);
    const y0 = ticks[0], y1 = ticks[ticks.length - 1];
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}` });
    box.append(svg);
    const probe = sv('text', {}); svg.append(probe);
    let ml = 0; for (const t of ticks) { probe.textContent = compact(t); ml = Math.max(ml, probe.getComputedTextLength ? probe.getComputedTextLength() : 30); }
    probe.remove(); ml += 10;
    const mr = 8, band = (W - ml - mr) / M.length;
    const y = (v) => mt + (H - mt - mb) * (1 - (v - y0) / (y1 - y0 || 1));
    for (const t of ticks) {
      svg.append(sv('line', { x1: ml, x2: W - mr, y1: y(t), y2: y(t), stroke: t === 0 ? 'var(--muted)' : 'var(--line)', 'stroke-width': 1 }));
      const lab = sv('text', { x: ml - 6, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }); lab.textContent = compact(t); svg.append(lab);
    }
    const bw = Math.min(28, band * 0.3);
    const pts = [];
    M.forEach((m, i) => {
      const cx = ml + band * (i + 0.5);
      const lab = sv('text', { x: cx, y: H - 6, 'text-anchor': 'middle' }); lab.textContent = monthLabel(m.month); svg.append(lab);
      if (type === 'bars') {
        series.forEach((f, k) => {
          const v = f(m), x = cx - (series.length * (bw + 4)) / 2 + k * (bw + 4) + 2;
          if (v) svg.append(sv('rect', { x, y: y(Math.max(0, v)), width: bw, height: Math.max(1, Math.abs(y(v) - y(0))), rx: 3, fill: colors[k] }));
        });
      } else pts.push([cx, y(series[0](m))]);
    });
    if (pts.length) {
      svg.append(sv('polyline', { points: pts.map((p) => p.join(',')).join(' '), fill: 'none', stroke: colors[0], 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      pts.forEach(([px, py], i) => { svg.append(sv('circle', { cx: px, cy: py, r: i === pts.length - 1 ? 4.5 : 3.5, fill: colors[0] })); });
      const [lx, ly] = pts[pts.length - 1];
      const end = sv('text', { x: lx, y: ly - 10, 'text-anchor': 'end', style: 'fill:var(--ink);font-weight:500' }); end.textContent = compact(series[0](M[M.length - 1])); svg.append(end);
    }
    const tip = el('div', { class: 'mtip', hidden: true }); box.append(tip);
    M.forEach((m, i) => {
      const hit = sv('rect', { x: ml + band * i, y: mt, width: band, height: H - mt - mb, fill: 'transparent' });
      hit.addEventListener('mousemove', (ev) => {
        const r = box.getBoundingClientRect();
        tip.replaceChildren(...tipLines(m)); tip.hidden = false;
        tip.style.left = Math.max(0, Math.min(r.width - tip.offsetWidth, ev.clientX - r.left + 12)) + 'px';
        tip.style.top = Math.max(0, ev.clientY - r.top - tip.offsetHeight - 8) + 'px';
      });
      hit.addEventListener('mouseleave', () => { tip.hidden = true; });
      svg.append(hit);
    });
  }
  let rsz; window.addEventListener('resize', () => { clearTimeout(rsz); rsz = setTimeout(renderMonthly, 150); });

  // ---------- statements
  let stmt = 'is';
  function isRows() {
    const R = [['sec', 'Revenue']];
    R.push(['sub', 'Collection fees', (r) => r.revC], ['sub', 'Disbursement fees', (r) => r.revD]);
    if (books.IS.some((r) => r.revO)) R.push(['sub', 'Other income', (r) => r.revO]);
    R.push(['total', 'Total revenue', (r) => r.revenue]);
    R.push(['sec', 'Cost of transactions'], ['sub', 'Bank fees', (r) => -r.bank], ['sub', 'Telco fees (MTN, Orange)', (r) => -r.telco], ['total', 'Total cost of transactions', (r) => -r.txn]);
    R.push(['grand', 'Gross profit', (r) => r.gross]);
    R.push(['sec', 'Operating expenses']);
    if (!books.opexCats.length) R.push(['sub', 'None recorded yet', () => 0]);
    for (const c of books.opexCats) R.push(['sub', c, (r) => -(r.opex[c] || 0)]);
    R.push(['total', 'Total operating expenses', (r) => -r.opexTotal]);
    R.push(['grand', 'EBITDA', (r) => r.ebitda], ['sub', 'Depreciation', (r) => -r.dep], ['grand', 'Ordinary result', (r) => r.ordinary]);
    R.push(['sub', 'Exceptional items (HAO)', (r) => -r.exc], ['grand', 'Net profit / (loss)', (r) => r.net]);
    return R;
  }
  function bsRows() {
    const R = [['sec', 'Assets']];
    for (const k of Object.keys(CASH)) R.push(['sub', CASH[k], (b) => b.cash[k]]);
    R.push(['total', 'Total cash', (b) => b.cashTotal], ['sub', 'Fixed assets at cost', (b) => b.faCost], ['sub', 'Accumulated depreciation', (b) => -b.accDep], ['grand', 'Total assets', (b) => b.assets]);
    R.push(['sec', 'Liabilities'], ['sub', 'Customer money owed', (b) => b.customer], ['sub', 'Unreconciled differences', (b) => b.suspense], ['sub', 'Unallocated expenses (payer not assigned)', (b) => b.unallocated], ['total', 'Total liabilities', (b) => b.liabilities]);
    R.push(['sec', 'Equity'], ['sub', 'Share capital', (b) => b.capital], ['sub', 'Retained earnings', (b) => b.retained], ['total', 'Total equity', (b) => b.equity]);
    R.push(['grand', 'Total liabilities and equity', (b) => b.liabilities + b.equity], ['check', 'Check: assets less liabilities and equity', (b) => b.check]);
    return R;
  }
  function cfRows() {
    return [
      ['sec', 'Operating activities'], ['sub', 'Net profit / (loss)', (c) => c.net_income], ['sub', 'Add back depreciation', (c) => c.dep],
      ['sub', 'Increase in customer money owed', (c) => c.dCust], ['sub', 'Increase in unreconciled differences', (c) => c.dSusp], ['sub', 'Increase in unallocated expenses', (c) => c.dUnal], ['total', 'Net cash from operating activities', (c) => c.cfo],
      ['sec', 'Investing activities'], ['sub', 'Investments in fixed assets', (c) => c.capex], ['total', 'Net cash from investing activities', (c) => c.cfi],
      ['sec', 'Financing activities'], ['sub', 'Shareholder capital in', (c) => c.capitalIn], ['total', 'Net cash from financing activities', (c) => c.cff],
      ['grand', 'Net change in cash', (c) => c.netChange], ['sub', 'Cash at start of month', (c) => c.opening], ['grand', 'Cash at end of month', (c) => c.closing],
      ['check', 'Check: cash at end less balance sheet cash', (c) => c.check],
    ];
  }
  // Statement model shared by the page and the Excel export.
  function statementModel(which) {
    const months = books.months;
    if (which === 'bs') {
      return { title: 'Balance sheet', note: 'At the end of each month.', head: months.map(monthLabel), rows: bsRows().map(([t, l, f]) => ({ type: t, label: l, vals: f ? books.BS.map(f) : null })) };
    }
    const src = which === 'is' ? books.IS : books.CF;
    const rows = (which === 'is' ? isRows() : cfRows()).map(([t, l, f]) => {
      if (!f) return { type: t, label: l, vals: null };
      const vals = src.map(f);
      let total;
      if (which === 'cf' && l.startsWith('Cash at start')) total = 0;
      else if (which === 'cf' && l.startsWith('Cash at end')) total = vals[vals.length - 1];
      else if (which === 'cf' && t === 'check') total = vals[vals.length - 1];
      else total = vals.reduce((s, v) => s + v, 0);
      return { type: t, label: l, vals: vals.concat([total]) };
    });
    return { title: which === 'is' ? 'Income statement' : 'Cash flow statement', note: which === 'is' ? 'By month, with the total to date. Costs in brackets.' : 'Indirect method, by month. The last column runs from the first entry to today.', head: months.map(monthLabel).concat(['To date']), rows };
  }
  function renderStatement() {
    const m = statementModel(stmt);
    $('#stmt-title').textContent = m.title;
    $('#stmt-note').textContent = m.note;
    $('#t-stmt thead').replaceChildren(el('tr', {}, el('th', {}, 'XAF'), ...m.head.map((h) => el('th', { class: 'n' }, h))));
    fill('#t-stmt', m.rows.map((r) => el('tr', { class: r.type === 'sub' ? 'sub' : r.type },
      td(r.label), ...(r.vals ? r.vals.map((v) => td(r.type === 'check' ? (num(v) === 0 ? '0' : acc(v)) : acc(v), 'n' + (r.type === 'check' && num(v) !== 0 ? ' neg' : ''))) : m.head.map(() => td(''))))));
    document.querySelectorAll('#stmt-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.stmt === stmt)));
  }
  document.querySelectorAll('#stmt-seg button').forEach((b) => b.addEventListener('click', () => { stmt = b.dataset.stmt; renderStatement(); }));

  // ---------- journal
  const jKind = $('#j-kind');
  Object.entries(KIND).forEach(([k, v]) => jKind.append(el('option', { value: k }, v)));
  function postingText(e) {
    return postEntry(e).map((l) => (l.dr ? 'Dr ' : 'Cr ') + acctName(l.acct)).join(' · ');
  }
  function renderJournal() {
    const q = $('#j-search').value.trim().toLowerCase(), k = jKind.value, st = $('#j-status').value;
    const list = books.entries.filter((e) => (!k || e.kind === k) && (!st || statusOf(e) === st) && (!q || (String(e.desc || '') + ' ' + (e.counterparty || '') + ' ' + (e.category || '')).toLowerCase().includes(q)))
      .slice().reverse();
    fill('#t-journal', list.length ? list.map((e) => el('tr', {},
      td(dayLabel(e.date)), td(KIND[e.kind] || e.kind), td(e.desc || e.category || ''), td(postingText(e), 'hide-sm post'),
      td(xaf(e.amount), 'n'), td(pill(statusOf(e))))) : [el('tr', {}, el('td', { colspan: 6, class: 'empty' }, loaded ? 'No entries match.' : 'Loading entries…'))]);
    $('#j-count').textContent = `${list.length} of ${books.entries.length} entries`;
  }
  ['#j-search', '#j-kind', '#j-status'].forEach((s) => $(s).addEventListener('input', renderJournal));

  // ---------- add entry
  let kind = 'expense';
  const fFrom = $('#f-from'), fTo = $('#f-to'), fCat = $('#f-cat'), fAcat = $('#f-acat');
  for (const [k, v] of Object.entries(CASH)) { fFrom.append(el('option', { value: k }, v)); if (k !== 'transit') fTo.append(el('option', { value: k }, v)); }
  fFrom.append(el('option', { value: 'unallocated' }, 'Unallocated (payer not assigned yet)'));
  EXPENSE_CATS.forEach((c) => fCat.append(el('option', { value: c }, c)));
  ASSET_CATS.forEach((c) => fAcat.append(el('option', { value: c }, c)));
  $('#f-date').value = todayIso();
  const parseAmt = (s) => Math.round(Number(String(s).replace(/[^\d.]/g, '')) || 0);
  function formEntry() {
    const e = { date: $('#f-date').value, kind, amount: parseAmt($('#f-amount').value), desc: $('#f-desc').value.trim() };
    if (['expense', 'investment', 'transfer'].includes(kind)) e.from = fFrom.value;
    if (['capital', 'transfer', 'income'].includes(kind)) e.to = fTo.value;
    if (kind === 'expense') e.category = fCat.value;
    if (kind === 'investment') { e.category = fAcat.value; e.life_months = Math.max(1, Math.round(Number($('#f-life').value) || 36)); }
    if (kind === 'capital') e.counterparty = $('#f-who').value.trim();
    if (kind === 'transfer') { e.fee = parseAmt($('#f-fee').value); e.fee_type = $('#f-feetype').value; }
    if (!e.desc) e.desc = kind === 'expense' ? e.category : kind === 'investment' ? e.category : kind === 'capital' ? 'Shareholder capital' + (e.counterparty ? ' from ' + e.counterparty : '') : KIND[kind];
    return e;
  }
  function setKind(k) {
    kind = k;
    document.querySelectorAll('#kind-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.kind === k)));
    document.querySelectorAll('#entry-form .field[data-for]').forEach((f) => { f.hidden = !f.dataset.for.split(' ').includes(k); });
    updatePreview();
  }
  function updatePreview() {
    const e = formEntry();
    $('#f-post').textContent = e.amount ? postEntry(e).map((l) => (l.dr ? 'Dr ' : 'Cr ') + acctName(l.acct) + ' ' + xaf(l.dr || l.cr)).join('  ·  ') : '';
  }
  document.querySelectorAll('#kind-seg button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.kind)));
  $('#entry-form').addEventListener('input', updatePreview);
  $('#f-amount').addEventListener('blur', () => { const v = parseAmt($('#f-amount').value); if (v) $('#f-amount').value = xaf(v); });
  const msg = (text, cls) => { const m = $('#f-msg'); m.className = cls || ''; m.textContent = text; };
  $('#entry-form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const e = formEntry();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) return msg('Pick a date for the entry.', 'err');
    if (!e.amount) return msg('Enter an amount above zero.', 'err');
    if (kind === 'transfer' && e.from === e.to) return msg('Choose two different accounts for an internal movement.', 'err');
    if (kind === 'transfer' && e.from === 'unallocated') return msg('An internal movement needs a real account to send from.', 'err');
    if (!db) return msg('Saving is not available in this view. Open the page signed in to claude.ai.', 'err');
    $('#f-save').disabled = true; msg('Saving…');
    try {
      e.origin = 'manual'; e.status = 'confirmed'; e.created_at = new Date().toISOString();
      const uid = user && user.id ? await user.id() : null; if (uid) e.created_by = uid;
      await db.collection('entries').add(e);
      msg('Saved. The statements now include it.', 'toast');
      $('#f-amount').value = ''; $('#f-desc').value = ''; $('#f-fee').value = ''; $('#f-who').value = '';
      updatePreview();
    } catch (err) {
      msg(err && err.code === 'invalid_argument' ? 'You can view these books but not add to them. Ask the owner for Contributor access.' : 'Could not save just now. Try again in a moment.', 'err');
    } finally { $('#f-save').disabled = !canWrite; }
  });
  function renderManual() {
    const mine = entries.filter((e) => e.origin === 'manual').sort((a, b) => b.date.localeCompare(a.date));
    fill('#t-manual', mine.length ? mine.map((e) => {
      const del = el('button', { class: 'btn small danger', type: 'button' }, 'Delete');
      del.addEventListener('click', async () => {
        if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Confirm delete'; setTimeout(() => { del.dataset.armed = ''; del.textContent = 'Delete'; }, 4000); return; }
        del.disabled = true;
        try { await db.collection('entries').doc(e.id).delete(); } catch (_) { del.disabled = false; del.textContent = 'Could not delete'; }
      });
      return el('tr', {}, td(dayLabel(e.date)), td(KIND[e.kind] || e.kind), td(e.desc || ''), td(xaf(e.amount), 'n'), td(canWrite && db ? del : ''));
    }) : [el('tr', {}, el('td', { colspan: 5, class: 'empty' }, 'Nothing added yet. Your expenses and investments will appear here.'))]);
  }

  // ---------- Excel export
  async function downloadXlsx() {
    const out = $('#dl-msg'); out.className = ''; out.textContent = '';
    if (typeof XLSX === 'undefined') { out.className = 'err'; out.textContent = 'The Excel library did not load. Reload the page and try again.'; return; }
    const dl = await useCap('downloads');
    if (!dl) { out.className = 'err'; out.textContent = 'Downloads are not available in this view.'; return; }
    const wb = XLSX.utils.book_new();
    const fmtCols = (ws, n) => { ws['!cols'] = [{ wch: 44 }].concat(Array(n).fill({ wch: 14 })); };
    for (const [w, name] of [['is', 'Income statement'], ['bs', 'Balance sheet'], ['cf', 'Cash flow']]) {
      const m = statementModel(w);
      const aoa = [['Moonie (ETS MOONIE) · ' + m.title + ' · XAF'], [m.note], [], [''].concat(m.head)];
      for (const r of m.rows) aoa.push([r.type === 'sub' ? '   ' + r.label : r.label].concat(r.vals ? r.vals.map(num) : []));
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      for (const addr of Object.keys(ws)) if (addr[0] !== '!' && typeof ws[addr].v === 'number') ws[addr].z = '#,##0;(#,##0);"-"';
      fmtCols(ws, m.head.length); XLSX.utils.book_append_sheet(wb, ws, name);
    }
    const jr = [['Date', 'Entry', 'Description', 'Account', 'Debit', 'Credit']].concat(books.journal.map((l) => [l.date, l.id, l.desc || '', acctName(l.acct), l.dr || null, l.cr || null]));
    const wsJ = XLSX.utils.aoa_to_sheet(jr); wsJ['!cols'] = [{ wch: 11 }, { wch: 22 }, { wch: 50 }, { wch: 30 }, { wch: 14 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, wsJ, 'Journal');
    const er = [['Date', 'Type', 'Description', 'Amount', 'From', 'To', 'Fee', 'Moonie fee', 'Category', 'Counterparty', 'Status', 'Source']]
      .concat(books.entries.map((e) => [e.date, KIND[e.kind] || e.kind, e.desc || '', num(e.amount), CASH[e.from] || '', CASH[e.to] || '', num(e.fee) || null, num(e.revenue) || null, e.category || '', e.counterparty || '', STATUS_LABEL[statusOf(e)], e.source || 'Moonie Books']));
    const wsE = XLSX.utils.aoa_to_sheet(er); wsE['!cols'] = [{ wch: 11 }, { wch: 22 }, { wch: 50 }, { wch: 13 }, { wch: 28 }, { wch: 28 }, { wch: 9 }, { wch: 11 }, { wch: 22 }, { wch: 18 }, { wch: 12 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, wsE, 'Entries');
    const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    try {
      await dl.save({ filename: `Moonie_3_statement_model_${todayIso()}.xlsx`, data: new Uint8Array(data) });
      out.className = 'toast'; out.textContent = 'Saved.';
    } catch (err) {
      out.className = err && err.code === 'declined' ? '' : 'err';
      out.textContent = err && err.code === 'declined' ? 'Download cancelled.' : 'Could not save the file here.';
    }
  }
  $('#dl-xlsx').addEventListener('click', downloadXlsx);

  // ---------- render
  function renderAll() {
    books = buildBooks(entries, todayIso());
    renderOverview(); renderMonthly(); renderStatement(); renderJournal(); renderManual();
  }

  // boot
  setKind('expense');
  let startTab = location.hash.slice(1);
  if (!TABS.includes(startTab)) { try { startTab = localStorage.getItem('mb-tab') || 'overview'; } catch (_) { startTab = 'overview'; } }
  go(startTab);
  renderAll();

  (async () => {
    db = await useCap('db');
    user = await useCap('user');
    if (user && typeof user.can === 'function') { const c = await user.can('data.write'); if (c === false) canWrite = false; }
    $('#f-save').disabled = !canWrite;
    if (!canWrite) msg('You can view these books. Adding entries needs Contributor access.', '');
    if (!db) { $('#cashline').textContent = 'Sign in to claude.ai to load the ledger.'; return; }
    db.collection('entries').limit(1000).onSnapshot((snap) => {
      loaded = true;
      entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderAll();
    }, () => { $('#cashline').textContent = 'The ledger stopped updating. Reload the page.'; });
  })();
})();

// Moonie Books accounting engine: entries -> double-entry lines -> statements.
const CASH = {
  cca: 'CCA bank',
  mtn_disb: 'MTN disbursement wallet',
  mtn_coll: 'MTN collections wallet',
  orange: 'Orange Money wallet',
  off: 'Off platform (shareholder held)',
  transit: 'In transit, unconfirmed',
};
const EXPENSE_CATS = ['Salaries & contractors', 'Tech & hosting', 'API & aggregator fees', 'Licensing & regulatory', 'Legal & accounting', 'Marketing & sales', 'Office & rent', 'Transport & travel', 'Taxes', 'Other'];
const ASSET_CATS = ['Equipment', 'Software & development', 'Licences', 'Deposits & guarantees', 'Other'];

function postEntry(e) {
  const a = Math.round(Number(e.amount) || 0), fee = Math.round(Number(e.fee) || 0), rev = Math.round(Number(e.revenue) || 0);
  const L = [];
  const dr = (acct, v) => { if (v) L.push({ acct, dr: v, cr: 0 }); };
  const cr = (acct, v) => { if (v) L.push({ acct, dr: 0, cr: v }); };
  const cash = (k) => 'cash:' + k;
  // 'unallocated' = paid outside the tracked accounts, payer not yet assigned (held as a liability)
  const paidFrom = (k) => (k === 'unallocated' ? 'liab:unallocated' : cash(k));
  switch (e.kind) {
    case 'capital': dr(cash(e.to), a); cr('eq:capital', a); break;
    case 'transfer': dr(cash(e.to), a); dr('cost:' + (e.fee_type || 'bank'), fee); cr(cash(e.from), a + fee); break;
    // exceptional: true = non-recurring, outside ordinary activity (SYSCOHADA HAO); shown below the ordinary result
    case 'fee': dr(e.exceptional ? 'cost:exceptional' : 'cost:' + (e.fee_type || 'bank'), a); cr(cash(e.from), a); break;
    case 'collection': dr(cash(e.to), a + rev - fee); dr('cost:telco', fee); cr('liab:customer', a); cr('rev:collection', rev); break;
    case 'payout': dr('liab:customer', a); dr('cost:telco', fee); cr(cash(e.from), a + fee); break;
    case 'fee_income': dr('liab:customer', a); cr('rev:disbursement', a); break;
    case 'opening': dr(cash(e.to), a); cr('liab:' + (e.against || 'suspense'), a); break;
    case 'expense': dr('opex:' + (e.category || 'Other'), a); cr(paidFrom(e.from), a); break;
    case 'investment': dr('fa:cost', a); cr(paidFrom(e.from), a); break;
    case 'settle': dr('liab:unallocated', a); cr(e.from === 'shareholder' ? 'eq:capital' : cash(e.from), a); break;
    case 'income': dr(cash(e.to), a); cr('rev:other', a); break;
  }
  return L;
}

const monthKey = (d) => d.slice(0, 7);
function monthsBetween(first, last) {
  const out = [];
  let [y, m] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  while (y < ly || (y === ly && m <= lm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
const addMonths = (mk, n) => { let [y, m] = mk.split('-').map(Number); m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1; return `${y}-${String(m).padStart(2, '0')}`; };

// Straight-line depreciation, starting the month after purchase.
function depreciation(entries, months) {
  const per = Object.fromEntries(months.map((m) => [m, 0]));
  for (const e of entries) {
    if (e.kind !== 'investment') continue;
    const life = Math.max(1, Math.round(Number(e.life_months) || 36));
    const cost = Math.round(Number(e.amount) || 0);
    const start = addMonths(monthKey(e.date), 1);
    let charged = 0;
    for (let i = 0; i < life; i++) {
      const mk = addMonths(start, i);
      if (!(mk in per)) continue;
      const v = i === life - 1 ? cost - Math.round(cost / life) * (life - 1) : Math.round(cost / life);
      per[mk] += v; charged += v;
    }
  }
  return per;
}

function buildBooks(entries, todayIso) {
  const es = entries.filter((e) => e && e.date && e.kind).slice().sort((a, b) => a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)));
  const first = es.length ? monthKey(es[0].date) : monthKey(todayIso);
  const lastEntry = es.length ? monthKey(es[es.length - 1].date) : first;
  const months = monthsBetween(first, lastEntry > monthKey(todayIso) ? lastEntry : monthKey(todayIso));
  // movements per month per account (dr - cr)
  const mv = {}; // acct -> month -> net debit
  const bump = (acct, mk, v) => { (mv[acct] = mv[acct] || {}); mv[acct][mk] = (mv[acct][mk] || 0) + v; };
  const journal = [];
  for (const e of es) {
    const mk = monthKey(e.date);
    for (const l of postEntry(e)) { bump(l.acct, mk, l.dr - l.cr); journal.push({ id: e.id, date: e.date, desc: e.desc, ...l }); }
  }
  const dep = depreciation(es, months);
  for (const mk of months) if (dep[mk]) {
    bump('dep:expense', mk, dep[mk]); bump('fa:accdep', mk, -dep[mk]);
    journal.push({ id: 'DEP-' + mk, date: mk + '-28', desc: 'Depreciation', acct: 'dep:expense', dr: dep[mk], cr: 0 });
    journal.push({ id: 'DEP-' + mk, date: mk + '-28', desc: 'Depreciation', acct: 'fa:accdep', dr: 0, cr: dep[mk] });
  }
  const accts = Object.keys(mv);
  const flow = (acct, mk) => (mv[acct] && mv[acct][mk]) || 0; // net debit in month
  const flowP = (prefix, mk) => accts.filter((a) => a.startsWith(prefix)).reduce((s, a) => s + flow(a, mk), 0);
  const bal = (acct, mk) => months.filter((m) => m <= mk).reduce((s, m) => s + flow(acct, m), 0);
  const balP = (prefix, mk) => accts.filter((a) => a.startsWith(prefix)).reduce((s, a) => s + bal(a, mk), 0);
  const opexCats = [...new Set(accts.filter((a) => a.startsWith('opex:')).map((a) => a.slice(5)))].sort();

  // Income statement (credits positive for revenue, costs shown positive and subtracted)
  const IS = months.map((mk) => {
    const revC = -flow('rev:collection', mk), revD = -flow('rev:disbursement', mk), revO = -flow('rev:other', mk);
    const revenue = revC + revD + revO;
    const bank = flow('cost:bank', mk), telco = flow('cost:telco', mk);
    const txn = bank + telco;
    const opex = Object.fromEntries(opexCats.map((c) => [c, flow('opex:' + c, mk)]));
    const opexTotal = Object.values(opex).reduce((s, v) => s + v, 0);
    const d = flow('dep:expense', mk);
    const exc = flow('cost:exceptional', mk);
    const gross = revenue - txn, ebitda = gross - opexTotal, ordinary = ebitda - d, net = ordinary - exc;
    return { month: mk, revC, revD, revO, revenue, bank, telco, txn, gross, opex, opexTotal, ebitda, dep: d, ordinary, exc, net };
  });
  const cumNet = (mk) => IS.filter((r) => r.month <= mk).reduce((s, r) => s + r.net, 0);
  const BS = months.map((mk) => {
    const cash = Object.fromEntries(Object.keys(CASH).map((k) => [k, bal('cash:' + k, mk)]));
    const cashTotal = Object.values(cash).reduce((s, v) => s + v, 0);
    const faCost = bal('fa:cost', mk), accDep = -bal('fa:accdep', mk), faNet = faCost - accDep;
    const assets = cashTotal + faNet;
    const customer = -bal('liab:customer', mk), suspense = -bal('liab:suspense', mk), unallocated = -bal('liab:unallocated', mk);
    const liabilities = customer + suspense + unallocated;
    const capital = -bal('eq:capital', mk), retained = cumNet(mk);
    const equity = capital + retained;
    return { month: mk, cash, cashTotal, faCost, accDep, faNet, assets, customer, suspense, unallocated, liabilities, capital, retained, equity, check: assets - liabilities - equity };
  });
  const CF = months.map((mk, i) => {
    const r = IS[i];
    const dCust = -flow('liab:customer', mk), dSusp = -flow('liab:suspense', mk), dUnal = -flow('liab:unallocated', mk);
    const cfo = r.net + r.dep + dCust + dSusp + dUnal;
    const capitalIn = -flow('eq:capital', mk);
    const capex = -flow('fa:cost', mk);
    const cfi = capex;
    const cff = capitalIn;
    const opening = i ? BS[i - 1].cashTotal : 0;
    const net = cfo + cfi + cff;
    return { month: mk, net_income: r.net, dep: r.dep, dCust, dSusp, dUnal, cfo, capex, cfi, capitalIn, cff, netChange: net, opening, closing: opening + net, check: opening + net - BS[i].cashTotal };
  });
  const tb = journal.reduce((s, l) => s + l.dr - l.cr, 0);
  return { entries: es, months, journal, IS, BS, CF, opexCats, trialBalance: tb };
}

// Month-by-month operating view: income, fixed vs variable costs, running totals, activity counts.
// Fixed costs = operating expenses + ordinary bank fees + depreciation. Telco fees vary with volume.
function monthlyStats(books) {
  const n = (v) => Math.round(Number(v) || 0);
  let cumIncome = 0, cumNet = 0, cumOrdinary = 0;
  return books.months.map((mk, i) => {
    const r = books.IS[i];
    const fixed = r.opexTotal + r.bank + r.dep;
    cumIncome += r.revenue; cumNet += r.net; cumOrdinary += r.ordinary;
    let payouts = 0, collections = 0, payVol = 0, colVol = 0, bankCount = 0, bankIn = 0, bankOut = 0;
    for (const e of books.entries) {
      if (e.date.slice(0, 7) !== mk) continue;
      const c = Math.max(1, n(e.count) || 1);
      if (e.kind === 'payout') { payouts += c; payVol += n(e.amount); }
      if (e.kind === 'collection') { collections += c; colVol += n(e.amount); }
      const lines = postEntry(e).filter((l) => l.acct === 'cash:cca');
      if (lines.length) { bankCount += c; for (const l of lines) { bankIn += l.dr; bankOut += l.cr; } }
    }
    return { month: mk, income: r.revenue, telco: r.telco, fixed, ordinary: r.ordinary, exc: r.exc, net: r.net,
      cumIncome, cumOrdinary, cumNet, payouts, collections, transactions: payouts + collections, payVol, colVol, bankCount, bankIn, bankOut };
  });
}

if (typeof module !== 'undefined') module.exports = { buildBooks, monthlyStats, postEntry, CASH, EXPENSE_CATS, ASSET_CATS };

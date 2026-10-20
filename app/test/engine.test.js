// Run: node app/test/engine.test.js [entries.json]
// Rebuilds the statements from a ledger export (default: data/ledger_entries.json, kept out of git)
// and checks the balance sheet and cash flow tie out in every month.
const fs = require('fs');
const path = require('path');
const { buildBooks } = require('../src/engine.js');

const file = process.argv[2] || path.join(__dirname, '../../data/ledger_entries.json');
let entries;
if (fs.existsSync(file)) {
  entries = JSON.parse(fs.readFileSync(file, 'utf8'));
} else {
  console.log(`No ledger at ${file}; running on a small made-up sample instead.`);
  entries = [
    { id: 'T1', date: '2026-01-05', kind: 'capital', to: 'cca', amount: 1000000, counterparty: 'Shareholder A' },
    { id: 'T2', date: '2026-01-06', kind: 'transfer', from: 'cca', to: 'mtn_disb', amount: 600000, fee: 2000, fee_type: 'bank' },
    { id: 'T3', date: '2026-01-10', kind: 'collection', to: 'mtn_coll', amount: 200000, revenue: 3400, fee: 2000 },
    { id: 'T4', date: '2026-01-12', kind: 'payout', from: 'mtn_disb', amount: 150000, fee: 1500 },
    { id: 'T5', date: '2026-02-01', kind: 'expense', from: 'cca', amount: 50000, category: 'Tech & hosting' },
    { id: 'T6', date: '2026-02-03', kind: 'investment', from: 'cca', amount: 120000, life_months: 12, category: 'Equipment' },
  ];
}
const b = buildBooks(entries, new Date().toISOString().slice(0, 10));
const fail = [];
if (b.trialBalance !== 0) fail.push('trial balance ' + b.trialBalance);
b.BS.forEach((r) => r.check && fail.push(`balance sheet ${r.month} off by ${r.check}`));
b.CF.forEach((r) => r.check && fail.push(`cash flow ${r.month} off by ${r.check}`));
console.log(`${b.entries.length} entries over ${b.months.length} months`);
console.log(fail.length ? 'FAIL\n' + fail.join('\n') : 'OK: books balance in every month');
process.exit(fail.length ? 1 : 0);

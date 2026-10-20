# mtreasury

Moonie Books: a double-entry ledger with a monthly 3-statement model (income statement, balance sheet, cash flow).

## What's here

| Path | What it is |
|---|---|
| `app/moonie-books.html` | The ledger app as published on claude.ai: overview of shareholder input, transaction costs, internal movements and customer money; an entry form for expenses and investments; statements with an Excel export. |
| `app/src/engine.js` | The accounting engine. Turns entries into balanced debits and credits, then builds the three statements. No dependencies. |
| `app/src/app.js`, `head.html`, `body.html` | The page's UI. `moonie-books.html` is these joined with `engine.js`. |
| `app/test/engine.test.js` | Checks the balance sheet and cash flow tie out every month. |
| `scripts/parse_cca_statement.py` | Parses a CCA Web-Banking statement PDF into transactions (needs PyMuPDF). |

Financial data is not in this repo. `data/` (ledger export and parsed records) and `private/` (data-specific scripts and the treasury dashboard) are git-ignored and stay on the local machine.

## Run the check

```bash
node app/test/engine.test.js
```

It uses `data/ledger_entries.json` when present, otherwise a small made-up sample.

## Rebuild the app file

```bash
cd app && { cat src/head.html src/body.html; echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script><script>'; cat src/engine.js src/app.js; echo '</script>'; } > moonie-books.html
```

## Entry types

| Type | Debit | Credit |
|---|---|---|
| Shareholder capital | Cash account | Share capital |
| Internal movement | Receiving account (+ fee to transaction costs) | Sending account |
| Transaction cost | Bank or telco fees | Cash account |
| Customer deposit | Cash (+ telco fee) | Customer money owed, collection fee revenue |
| Customer payout | Customer money owed (+ telco fee) | Cash account |
| Fee charged to customer | Customer money owed | Disbursement fee revenue |
| Expense | Operating expense category | Cash account |
| Investment | Fixed assets (depreciated straight-line from the next month) | Cash account |

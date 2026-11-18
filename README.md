# Tally

A personal money app in one file. It answers "what can I spend right now?" and keeps cards, bills, and goals in view.

- **Home:** safe to spend, this week's plan, the next 30 days of checking, what's due, goals, the daily line.
- **Accounts, Cards, Bills:** one tab each. Cards ask for the statement day and due day when you add them.
- **Check-in (the + button):** about a minute a week. Confirm balances, explain last week, plan the next.
- **Explore (compass icon):** the daily line, money tips, trips and fare watch, markets, What if, past check-ins.
- **Look:** glass design, four color themes, dark or light. Theme dots are on Home.

No numbers live in the code. Each person's data stays in their own browser, and optionally in a Google Sheet they own.

## Files

| File | What it is | Goes in the repo? |
|---|---|---|
| `index.html` | The whole app | Yes |
| `Code.gs` | Script for your Google Sheet: sync, reminder email, bank email reading, market data | Yes (it holds no secrets) |
| `README.md` | This page | Yes |
| `kevin-tally-data.json` | Kevin's data | **No. Never commit this.** |
| `kevin-card-reminders.ics` | Calendar reminders for Kevin's cards | **No** |

## Put it online (GitHub Pages)

1. Replace `index.html` in the repo with the new one. Commit.
2. Pages redeploys in a minute or two. Reload the app on your phone.

Your data stays where it was: it lives in the browser and your Sheet, not in the file.

## Upgrading the Sheet script (needed for the email features)

1. Open your Tally Sheet > Extensions > Apps Script.
2. Select everything in `Code.gs`, delete it, paste the new `Code.gs`. Save.
3. Choose `setup` in the function menu and press Run. Google asks for new permissions (Gmail, send email, run on a schedule). Approve.
   Google's wording says "read, compose, send" email. The script only searches for bank alert emails and only sends email to you.
4. Deploy > Manage deployments > pencil icon > Version: **New version** > Deploy. The URL stays the same.
5. Optional: choose `testReminder` and press Run to get a sample reminder email now.

## Weekly check-in

1. **Confirm balances.** Prefilled from your bank alert emails when they match, otherwise from last time.
2. **What came in and went out.** Paychecks come from your payday setting. Bills and card payments due in that stretch are listed and checked. Tally compares that with how your balances moved. Anything left over is spending it can't see (debit, cash, Venmo); pick where it mostly went.
3. **Plan ahead.** The next week's paydays, card payments, and bills. Set what to spend and what to save. Tally warns if checking would drop under your cushion.

It can't see transactions. It works from balances, your payday, and the dates you set up.

## Bank alert emails

Turn on balance alerts and statement alerts in each bank's app, delivered by email. Then in Tally:

- Settings > **Test email reading** shows what the script found in the last 10 days.
- Edit each account or card and fill **Words in its alert emails**, comma-separated, such as `chase, 6612` or `american express`. All of the words must appear in an email's sender, subject, or text.

## Reminder email

Settings > Weekly reminder email: pick the day and hour. It lists the next 7 days of card and bill dates and links to the app. It's sent by your own Sheet to your own Google account, within the hour you pick, in the Sheet's time zone (File > Settings in the Sheet).

## How the numbers work

- **Safe to spend** = spending accounts + paychecks coming − bills and card payments due − your cushion, through the day before the first payday at least a week away. After a check-in it's capped at that week's spending plan.
- **Next 30 days** steps checking forward: paydays in, card payments and bills out, plus your average weekly cash spending from recent check-ins (card spending shows up as card payments).
- **Card payment amounts** come from statements (entered, or read from email). Without one, Tally uses the card's current balance.
- **Net worth** = all accounts − card balances.
- **Markets** needs the Sheet connected. Quotes come from `GOOGLEFINANCE` (Stooq as a fallback), the mortgage rate from FRED, headlines from Google News RSS.
- **Fare watch** is a log, not a live feed. Log the fare you see; use Google Flights' "Track prices" switch for alerts.

## Tested / not tested

Tested in a headless browser at desktop, phone, and small-phone widths, in dark and light: first run, sample data, Kevin's file, every tab, the full check-in, the add-card steps, and sync, email reading, and markets against a stand-in for the Sheet script. The email parser was tested on sample alert texts.

Not tested against live services: the real Apps Script deployment, real bank emails (each bank words them differently), the reminder trigger, and the market data sources.

## Changing it

`index.html` is self-contained: CSS at the top, JavaScript at the bottom. Colors are tokens per theme (`data-pal`) and mode (`data-theme`). Chart colors are `--c1` and `--c2`.

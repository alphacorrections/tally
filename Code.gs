/**
 * Tally sync backend — runs inside a Google Sheet that you own.
 *
 * What it does
 *   - Stores your whole Tally data set in a hidden tab ("_tally") so your phone and computer stay in step.
 *   - Rewrites readable tabs (Weeks, Balances, Statements, Bills, Cards, Goals) on every save,
 *     so the Sheet is still a spreadsheet you can open, chart, or copy from.
 *   - Fetches quotes, the weekly mortgage rate, and headlines for Explore.
 *   - Reads bank and card alert emails from the last 10 days in YOUR Gmail (balances, new statements,
 *     payments due) so the weekly check-in can fill numbers in. Nothing is stored except what you save.
 *   - Optional: pulls balances and transactions from your banks through SimpleFIN Bridge (read-only).
 *   - Emails you a weekly check-in reminder on the day and hour you pick in Tally > Settings,
 *     with the next 7 days of card and bill due dates.
 *
 * Setup (once, about 5 minutes)
 *   1. Make a new Google Sheet. Extensions > Apps Script. Delete what's there, paste this whole file, Save.
 *   2. Pick "setup" in the function menu and press Run. Approve the permissions.
 *      Google lists Gmail ("read, compose, send") because reading alert emails needs it. The script
 *      only searches for bank alerts and only sends email to you.
 *      Open View > Logs (or Execution log) and copy the key it prints.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *      Copy the web app URL (it ends in /exec).
 *   4. In Tally: Settings > Sync with your Google Sheet. Paste the URL and the key. Connect.
 *
 * Security: "Anyone" means anyone who has BOTH the URL and the key can read and write this data.
 * Don't post either one. To lock everyone out, run newKey() and paste the new key into Tally.
 * After changing this code: run setup once (new permissions), then Deploy > Manage deployments > edit (pencil)
 * > Version: New version > Deploy, so the same URL keeps working.
 * To check the reminder email right away, run testReminder.
 */
var STATE_TAB = '_tally';
var SHARED_TAB = '_shared';   /* the Together space: its own key, never sees your personal data */
var QUOTE_TAB = '_quotes';
var CHUNK = 45000;

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TALLY_KEY')) props.setProperty('TALLY_KEY', Utilities.getUuid().replace(/-/g, ''));
  tab_(STATE_TAB, true);
  ensureTrigger_();
  try { GmailApp.search('newer_than:1d', 0, 1); } catch (e) { Logger.log('Gmail check: ' + e.message); }
  Logger.log('Reminder emails go to: ' + Session.getEffectiveUser().getEmail());
  if (!props.getProperty('SHARED_KEY')) props.setProperty('SHARED_KEY', Utilities.getUuid().replace(/-/g, ''));
  tab_(SHARED_TAB, true);
  Logger.log('Your Tally key: ' + props.getProperty('TALLY_KEY'));
  Logger.log('Together key (only opens the shared space; Tally puts it in the invite link for you): ' + props.getProperty('SHARED_KEY'));
  return props.getProperty('TALLY_KEY');
}
function newSharedKey() {
  PropertiesService.getScriptProperties().setProperty('SHARED_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('New Together key. Make a new invite link in Tally > Together > Invite: ' + PropertiesService.getScriptProperties().getProperty('SHARED_KEY'));
}
function newKey() {
  PropertiesService.getScriptProperties().setProperty('TALLY_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('New Tally key: ' + PropertiesService.getScriptProperties().getProperty('TALLY_KEY'));
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    var role = role_(p.key);
    if (!role) return out_({ ok: false, error: 'Wrong key' });
    if (p.action === 'sload') return out_({ ok: true, state: loadState_(SHARED_TAB) });
    if (role !== 'owner') return out_({ ok: false, error: 'This key only opens the shared space' });
    if (p.action === 'sharedKey') return out_({ ok: true, key: sharedKey_() });
    if (p.action === 'bank') return out_(bank_(p.force === '1'));
    if (p.action === 'load') return out_({ ok: true, state: loadState_() });
    if (p.action === 'market') return out_(market_(p));
    if (p.action === 'inbox') return out_({ ok: true, items: inbox_(10) });
    return out_({ ok: true, pong: true });
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var role = role_(body.key);
    if (!role) return out_({ ok: false, error: 'Wrong key' });
    if (body.action === 'ssave' && body.state) {
      var sl = LockService.getScriptLock(); sl.waitLock(20000);
      try { saveState_(body.state, SHARED_TAB); } finally { sl.releaseLock(); }
      return out_({ ok: true, updatedAt: body.state.updatedAt });
    }
    if (role !== 'owner') return out_({ ok: false, error: 'This key only opens the shared space' });
    if (body.action === 'bankClaim' && body.token) return out_(bankClaim_(String(body.token)));
    if (body.action === 'bankOff') { PropertiesService.getScriptProperties().deleteProperty('SFIN_URL'); CacheService.getScriptCache().remove('bank1'); return out_({ ok: true }); }
    if (body.action === 'save' && body.state) {
      var lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { saveState_(body.state); } finally { lock.releaseLock(); }
      try { mirror_(body.state); } catch (mErr) { /* readable tabs are a convenience; never fail a save over them */ }
      try { if (body.appUrl && /^https:\/\//.test(body.appUrl)) PropertiesService.getScriptProperties().setProperty('APP_URL', String(body.appUrl).slice(0, 300)); ensureTrigger_(); } catch (tErr) {}
      return out_({ ok: true, updatedAt: body.state.updatedAt });
    }
    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}

/* ---------- helpers ---------- */
function authed_(k) { return role_(k) === 'owner'; }
function role_(k) {
  var pr = PropertiesService.getScriptProperties(), own = pr.getProperty('TALLY_KEY'), sh = pr.getProperty('SHARED_KEY');
  if (!k) return null; k = String(k);
  if (own && k === own) return 'owner';
  if (sh && k === sh) return 'shared';
  return null;
}
function sharedKey_() { var pr = PropertiesService.getScriptProperties(); if (!pr.getProperty('SHARED_KEY')) pr.setProperty('SHARED_KEY', Utilities.getUuid().replace(/-/g, '')); tab_(SHARED_TAB, true); return pr.getProperty('SHARED_KEY'); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function tab_(name, hidden) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (hidden) sh.hideSheet(); }
  return sh;
}

/* ---------- state: one JSON document, split across cells in column A ---------- */
function saveState_(state, tab) {
  var sh = tab_(tab || STATE_TAB, true), json = JSON.stringify(state), rows = [[state.updatedAt || new Date().toISOString()]];
  for (var i = 0; i < json.length; i += CHUNK) rows.push([json.substr(i, CHUNK)]);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
}
function loadState_(tab) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab || STATE_TAB);
  if (!sh || sh.getLastRow() < 2) return null;
  var vals = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues(), json = '';
  for (var i = 0; i < vals.length; i++) json += vals[i][0];
  return json ? JSON.parse(json) : null;
}

/* ---------- readable copies ---------- */
function write_(name, header, rows) {
  var sh = tab_(name, false); sh.clearContents();
  var all = [header].concat(rows);
  sh.getRange(1, 1, all.length, header.length).setValues(all);
  sh.setFrozenRows(1);
}
function mirror_(s) {
  var accts = s.accounts || [];
  write_('Weeks', ['Week of', 'Paychecks', 'Other income', 'Transfers in', 'Bills + cards', 'Invested', 'Spare', 'Planned', 'Note'],
    (s.weeks || []).map(function (w) { return [w.date, +w.payroll || 0, +w.other || 0, +w.transfer || 0, +w.out || 0, +w.invest || 0, (+w.payroll || 0) + (+w.other || 0) - (+w.out || 0) - (+w.invest || 0), w.planned ? 'yes' : '', w.note || '']; }));
  write_('Balances', ['Date'].concat(accts.map(function (a) { return a.name; })).concat(['Card balances', 'Credit score', 'Note']),
    (s.snaps || []).map(function (n) { return [n.date].concat(accts.map(function (a) { return n.bal && n.bal[a.id] != null ? n.bal[a.id] : ''; })).concat([n.cc == null ? '' : n.cc, n.score || '', n.note || '']); }));
  var cards = s.cards || [], months = Object.keys(s.statements || {}).sort();
  write_('Statements', ['Month'].concat(cards.map(function (c) { return c.name; })),
    months.map(function (ym) { return [ym].concat(cards.map(function (c) { var st = s.statements[ym][c.id]; return st ? st.amt : ''; })); }));
  write_('Cards', ['Card', 'Statement day', 'Due day', 'Earns', 'Use for', 'In use'],
    cards.map(function (c) { return [c.name, c.stmtDay || '', c.dueDay || '', c.perk || '', c.use || '', c.off ? 'no' : 'yes']; }));
  write_('Bills', ['Bill', 'Amount', 'How often', 'Due day', 'Month', 'Paid from', 'Paused'],
    (s.bills || []).map(function (b) { return [b.name, +b.amount || 0, b.freq === 'y' ? 'yearly' : b.freq === 'c' ? 'every ' + (b.n || 1) + (b.unit === 'w' ? ' weeks' : ' months') : 'monthly', b.day || '', b.month || '', b.account || '', b.off ? 'yes' : '']; }));
  write_('Goals', ['Goal', 'Type', 'Target', 'Tracked from', 'Typed amount', 'Target date', 'Note'],
    (s.goals || []).map(function (g) { return [g.name, g.kind, +g.target || 0, g.acct || '', +g.manual || 0, g.due || '', g.note || '']; }));
}

/* ---------- markets: quotes, mortgage rate, headlines. Each source fails on its own. ---------- */
function market_(p) {
  var symbols = String(p.symbols || '').split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(function (x) { return /^[A-Z0-9.\-]{1,10}$/.test(x); }).slice(0, 15);
  var topics = String(p.topics || '').split('|').map(function (x) { return x.trim(); }).filter(String).slice(0, 6);
  var cache = CacheService.getScriptCache(), ck = 'mkt:' + Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, symbols.join(',') + '|' + topics.join('|')));
  var hit = cache.get(ck); if (hit) return JSON.parse(hit);
  var res = { ok: true, quotes: [], mortgage: null, news: [], errors: [], at: new Date().toISOString() };
  try { res.quotes = quotes_(symbols); } catch (e1) { res.errors.push('quotes: ' + e1.message); }
  try { res.mortgage = mortgage_(); } catch (e2) { res.errors.push('mortgage rate: ' + e2.message); }
  topics.forEach(function (t) { try { res.news = res.news.concat(news_(t, 4)); } catch (e3) { res.errors.push('news for ' + t + ': ' + e3.message); } });
  try { cache.put(ck, JSON.stringify(res), 1800); } catch (e4) {}
  return res;
}
function quotes_(symbols) {
  if (!symbols.length) return [];
  /* First choice: GOOGLEFINANCE formulas in a hidden tab of this Sheet. */
  var sh = tab_(QUOTE_TAB, true); sh.clearContents();
  sh.getRange(1, 1, symbols.length, 3).setFormulas(symbols.map(function (s, i) { var r = i + 1; return ['="' + s + '"', '=IFERROR(GOOGLEFINANCE(A' + r + ',"price"),"")', '=IFERROR(GOOGLEFINANCE(A' + r + ',"changepct"),"")']; }));
  SpreadsheetApp.flush();
  var vals = sh.getRange(1, 1, symbols.length, 3).getValues(), today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'MMM d');
  return vals.map(function (r) {
    if (typeof r[1] === 'number') return { sym: r[0], price: r[1], pct: typeof r[2] === 'number' ? r[2] : null, date: today };
    return stooq_(r[0]);
  });
}
function stooq_(sym) { /* fallback: free end-of-day CSV */
  try {
    var txt = UrlFetchApp.fetch('https://stooq.com/q/l/?s=' + encodeURIComponent(sym.toLowerCase()) + '.us&f=sd2t2ohlcv&h&e=csv', { muteHttpExceptions: true }).getContentText();
    var row = txt.trim().split('\n')[1].split(','), open = parseFloat(row[3]), close = parseFloat(row[6]);
    if (!isFinite(close)) throw new Error('no data');
    return { sym: sym, price: close, pct: isFinite(open) && open ? (close - open) / open * 100 : null, date: row[1] };
  } catch (e) { return { sym: sym, price: null, pct: null, date: 'no data' }; }
}
function mortgage_() { /* Freddie Mac weekly survey, published by FRED as a plain CSV */
  var txt = UrlFetchApp.fetch('https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US', { muteHttpExceptions: true }).getContentText();
  var rows = txt.trim().split('\n').filter(function (l) { return /^\d{4}-\d{2}-\d{2},[\d.]+$/.test(l.trim()); });
  if (rows.length < 2) throw new Error('no data');
  var a = rows[rows.length - 1].trim().split(','), b = rows[rows.length - 2].trim().split(',');
  return { rate: parseFloat(a[1]), date: a[0], prev: parseFloat(b[1]) };
}
function news_(topic, n) { /* Google News RSS search */
  var xml = UrlFetchApp.fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(topic) + '&hl=en-US&gl=US&ceid=US:en', { muteHttpExceptions: true }).getContentText();
  var items = XmlService.parse(xml).getRootElement().getChild('channel').getChildren('item').slice(0, n);
  return items.map(function (it) {
    var src = it.getChild('source'), d = new Date(it.getChildText('pubDate'));
    return { title: it.getChildText('title'), link: it.getChildText('link'), source: src ? src.getText() : '', topic: topic, date: isNaN(d) ? '' : Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d') };
  });
}

/* ---------- Gmail: bank and card alert emails ---------- */
var INBOX_QUERY = 'newer_than:%dd -in:spam -in:trash ("available balance" OR "current balance" OR "account balance" OR "statement balance" OR "end of day balance" OR "daily balance" OR "new statement" OR "statement is ready" OR "statement is available" OR "payment due" OR "payment is due" OR "minimum payment")';
function inbox_(days) {
  var tz = Session.getScriptTimeZone(), out = [], seen = {};
  var threads = GmailApp.search(INBOX_QUERY.replace('%d', String(days || 10)), 0, 40);
  threads.forEach(function (t) {
    t.getMessages().slice(-3).forEach(function (m) {
      var id = m.getId(); if (seen[id]) return; seen[id] = 1;
      var subj = m.getSubject() || '', body = '';
      try { body = (m.getPlainBody() || '').replace(/\s+/g, ' ').slice(0, 4000); } catch (e) {}
      var it = parseAlert_(subj, body); if (!it) return;
      it.from = String(m.getFrom() || '').replace(/<.*?>/, '').replace(/"/g, '').trim() + ' ' + (String(m.getFrom()).match(/@([\w.-]+)/) || ['', ''])[1];
      it.subject = subj.slice(0, 140);
      it.date = Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd');
      it.snippet = body.slice(0, 160);
      out.push(it);
    });
  });
  out.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  return out.slice(0, 60);
}
function money_(s) { var v = parseFloat(String(s).replace(/[$,\s]/g, '')); return isFinite(v) ? Math.round(v * 100) / 100 : null; }
function parseAlert_(subj, body) {
  var text = subj + ' § ' + body, AMT = '\\$\\s?([\\d,]+(?:\\.\\d{2})?)', m, kind = null, amount = null;
  var find = function (label) { var r = new RegExp(label + '[^$§]{0,60}?' + AMT, 'i').exec(text); return r ? money_(r[r.length - 1]) : null; };
  if (/statement (balance|is ready|is available|is now available)|new statement|e-?statement/i.test(text)) { kind = 'statement'; amount = find('(new |statement |total )?balance') ; if (amount == null) amount = find('statement'); }
  if (amount == null && /payment (is )?due|minimum payment|amount due/i.test(text)) { kind = 'due'; amount = find('(statement balance|new balance|total balance)'); if (amount == null) amount = find('(amount due|payment due|total due)'); if (amount == null) amount = find('minimum payment'); }
  if (amount == null && /(available|current|account|ending|ledger|end[- ]of[- ]day|daily|closing) balance/i.test(text)) { kind = 'balance'; amount = find('(available|current|account|ending|ledger|end[- ]of[- ]day|daily|closing) balance'); }
  if (kind == null || amount == null) return null;
  var l4 = /(?:ending(?: in)?|last 4(?: digits)?|account|card)\s*(?:#|no\.?|number)?\s*[:\-]?\s*(?:[x\*•\.]{1,12}\s?)?(\d{4})\b/i.exec(text);
  if (!l4) l4 = /(?:\.{2,}|[x\*\u2022]{2,})\s?(\d{4})\b/i.exec(text);
  var item = { kind: kind, amount: amount, last4: l4 ? l4[1] : '' };
  var due = /due (?:date|on|by)?:?\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:,? \d{4})?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i.exec(text);
  if (due) { var d = toDate_(due[1]); if (d) item.due = d; }
  return item;
}
function toDate_(s) {
  var now = new Date(), d;
  if (/\//.test(s)) { var p = s.split('/'); var y = p[2] ? (+p[2] < 100 ? 2000 + +p[2] : +p[2]) : now.getFullYear(); d = new Date(y, +p[0] - 1, +p[1]); }
  else { d = new Date(s.replace('.', '') + (/\d{4}/.test(s) ? '' : ' ' + now.getFullYear())); }
  if (isNaN(d)) return null;
  if (!/\d{4}/.test(s) && d < new Date(now.getFullYear(), now.getMonth() - 2, 1)) d.setFullYear(d.getFullYear() + 1);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ---------- weekly reminder email ---------- */
function ensureTrigger_() {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'remindTick'; });
  if (!has) ScriptApp.newTrigger('remindTick').timeBased().everyHours(1).create();
}
function remindTick() {
  var s = loadState_(); if (!s || !s.profile) return;
  var r = s.profile.remind || {}; if (r.on === false) return;
  var tz = Session.getScriptTimeZone(), now = new Date();
  var dow = +Utilities.formatDate(now, tz, 'u') % 7, hour = +Utilities.formatDate(now, tz, 'H'), day = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  var want = r.day == null ? 0 : +r.day, wantH = r.hour == null ? 9 : +r.hour;
  if (dow !== want || hour < wantH) return;
  var props = PropertiesService.getScriptProperties(); if (props.getProperty('LAST_REMIND') === day) return;
  sendReminder_(s); props.setProperty('LAST_REMIND', day);
}
function testReminder() { var s = loadState_(); if (!s) throw new Error('No Tally data in this Sheet yet. Connect Tally first.'); sendReminder_(s); Logger.log('Sent to ' + Session.getEffectiveUser().getEmail()); }
function ymd_(d) { return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function clamp_(y, m, d) { var last = new Date(y, m + 1, 0).getDate(); return new Date(y, m, Math.min(d, last)); }
function upcoming_(s, days) {
  var tz = Session.getScriptTimeZone(), start = new Date(Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd')), end = new Date(start.getTime() + days * 864e5), out = [];
  for (var k = -1; k <= 2; k++) {
    var y = start.getFullYear(), mo = start.getMonth() + k, base = new Date(y, mo, 1); y = base.getFullYear(); mo = base.getMonth();
    (s.cards || []).forEach(function (c) {
      if (c.off) return;
      if (c.stmtDay) out.push({ d: clamp_(y, mo, +c.stmtDay), t: c.name + ' statement closes', a: null, note: 'Pay it down before this to lower what gets reported' });
      if (c.dueDay) { var dd = clamp_(y, mo, +c.dueDay), ym = Utilities.formatDate(dd, tz, 'yyyy-MM'), st = ((s.statements || {})[ym] || {})[c.id]; if (!(st && st.st === 'paid')) out.push({ d: dd, t: c.name + ' payment due', a: st ? +st.amt : null }); }
    });
    (s.bills || []).forEach(function (b) {
      if (b.off || !b.day || b.freq === 'c') return;
      if (b.freq === 'y') { if (b.month && +b.month - 1 === mo) out.push({ d: clamp_(y, mo, +b.day), t: b.name + ' (yearly)', a: +b.amount || null }); }
      else out.push({ d: clamp_(y, mo, +b.day), t: b.name, a: +b.amount || null });
    });
  }
  (s.bills || []).forEach(function (b) {
    if (b.off || b.freq !== 'c' || !b.next) return;
    var p = b.next.split('-'), a = new Date(+p[0], +p[1] - 1, +p[2]), n = Math.max(1, +b.n || 1);
    for (var i = -60; i < 200; i++) {
      var d = b.unit === 'w' ? new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * n * i) : clamp_(a.getFullYear(), a.getMonth() + n * i, a.getDate());
      if (d >= end) break; if (d >= start) out.push({ d: d, t: b.name, a: +b.amount || null });
    }
  });
  return out.filter(function (e) { return e.d >= start && e.d < end; }).sort(function (a, b) { return a.d - b.d; });
}
function sendReminder_(s) {
  var tz = Session.getScriptTimeZone(), to = Session.getEffectiveUser().getEmail(), url = PropertiesService.getScriptProperties().getProperty('APP_URL') || '';
  var ev = upcoming_(s, 7), total = 0, esc = function (x) { return String(x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var fmt = function (n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var rows = ev.map(function (e) { if (e.a) total += e.a; return '<tr><td style="padding:8px 12px 8px 0;color:#5B6470;white-space:nowrap">' + Utilities.formatDate(e.d, tz, 'EEE, MMM d') + '</td><td style="padding:8px 12px 8px 0"><b>' + esc(e.t) + '</b>' + (e.note ? '<br><span style="color:#5B6470;font-size:13px">' + esc(e.note) + '</span>' : '') + '</td><td style="padding:8px 0;text-align:right;white-space:nowrap">' + (e.a ? fmt(e.a) : '') + '</td></tr>'; }).join('');
  var snaps = s.snaps || [], last = snaps.length ? snaps[snaps.length - 1].date : '';
  var name = (s.profile && s.profile.name) || 'there';
  var html = '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#14161A;line-height:1.5">' +
    '<h2 style="margin:0 0 4px">Time to check in, ' + esc(name) + '</h2>' +
    '<p style="margin:0 0 16px;color:#5B6470">About a minute: confirm balances, explain last week, plan the next.' + (last ? ' Last balances: ' + esc(last) + '.' : '') + '</p>' +
    (url ? '<p><a href="' + esc(url) + '" style="display:inline-block;background:#14513A;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Open Tally</a></p>' : '') +
    '<h3 style="margin:22px 0 6px">Next 7 days</h3>' +
    (rows ? '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + '</table>' + (total ? '<p style="margin:8px 0 0"><b>Known amounts: ' + fmt(total) + '</b></p>' : '') : '<p style="color:#5B6470">Nothing due. Nice week to move a little extra to savings.</p>') +
    '<p style="margin-top:26px;font-size:12px;color:#8A919C">Sent by the Tally script in your own Google Sheet. Change the day or turn it off in Tally &gt; Settings.</p></div>';
  var plain = 'Time to check in, ' + name + '.\n\nNext 7 days:\n' + (ev.map(function (e) { return Utilities.formatDate(e.d, tz, 'EEE MMM d') + '  ' + e.t + (e.a ? '  ' + fmt(e.a) : ''); }).join('\n') || 'Nothing due.') + (url ? '\n\nOpen Tally: ' + url : '');
  MailApp.sendEmail({ to: to, subject: 'Tally check-in · ' + ev.length + (ev.length === 1 ? ' date' : ' dates') + ' this week', body: plain, htmlBody: html, name: 'Tally' });
}

/* ---------- bank connection: SimpleFIN Bridge (read-only) ----------
   The access link is kept in this script's properties. It never goes to the app.
   SimpleFIN asks apps to stay under 24 requests a day, so results are cached for 2 hours
   and a forced refresh is allowed at most every 15 minutes. */
function bankClaim_(token) {
  var claim = Utilities.newBlob(Utilities.base64Decode(token.trim())).getDataAsString().trim();
  if (!/^https:\/\//.test(claim)) return { ok: false, error: 'That doesn’t look like a SimpleFIN setup token.' };
  var r = UrlFetchApp.fetch(claim, { method: 'post', payload: '', contentType: 'text/plain', muteHttpExceptions: true }); /* Apps Script sets Content-Length itself */
  if (r.getResponseCode() === 403) return { ok: false, error: 'That token was already used or doesn’t exist. Make a new one in SimpleFIN.' };
  if (r.getResponseCode() >= 300) return { ok: false, error: 'SimpleFIN said ' + r.getResponseCode() };
  PropertiesService.getScriptProperties().setProperty('SFIN_URL', r.getContentText().trim());
  CacheService.getScriptCache().remove('bank1');
  return bank_(true);
}
function bankFetch_(path) {
  var acc = PropertiesService.getScriptProperties().getProperty('SFIN_URL'); if (!acc) throw new Error('No bank connection yet');
  var m = /^(https?):\/\/([^:\/@]+):([^@]+)@(.+)$/.exec(acc); if (!m) throw new Error('Saved bank link looks wrong. Reconnect.');
  var url = m[1] + '://' + m[4].replace(/\/$/, '') + path;
  return UrlFetchApp.fetch(url, { headers: { Authorization: 'Basic ' + Utilities.base64Encode(decodeURIComponent(m[2]) + ':' + decodeURIComponent(m[3])) }, muteHttpExceptions: true });
}
function bank_(force) {
  var cache = CacheService.getScriptCache(), props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SFIN_URL')) return { ok: true, connected: false };
  var hit = cache.get('bank1'), lastAt = +props.getProperty('SFIN_LAST') || 0;
  if (hit && (!force || Date.now() - lastAt < 15 * 60000)) { var c = JSON.parse(hit); c.cached = true; return c; }
  var start = Math.floor((Date.now() - 45 * 864e5) / 1000);
  var r = bankFetch_('/accounts?version=2&start-date=' + start);
  if (r.getResponseCode() === 402) return { ok: false, error: 'SimpleFIN subscription needs payment.' };
  if (r.getResponseCode() === 403) return { ok: false, error: 'SimpleFIN turned this connection off. Reconnect with a new token.' };
  if (r.getResponseCode() >= 300) return { ok: false, error: 'SimpleFIN said ' + r.getResponseCode() };
  var j = JSON.parse(r.getContentText()), tz = Session.getScriptTimeZone(), conns = {};
  (j.connections || []).forEach(function (c) { conns[c.conn_id] = c.name || c.org_url || ''; });
  var day = function (t) { return t ? Utilities.formatDate(new Date(t * 1000), tz, 'yyyy-MM-dd') : ''; };
  var out = { ok: true, connected: true, at: new Date().toISOString(),
    errors: (j.errlist || []).map(function (e) { return e.msg || e.code; }).concat(j.errors || []),
    accounts: (j.accounts || []).map(function (a) {
      return { id: a.id, name: a.name, conn: conns[a.conn_id] || (a.org && a.org.name) || '', bal: +a.balance, avail: a['available-balance'] != null ? +a['available-balance'] : null, date: day(a['balance-date']),
        txns: (a.transactions || []).filter(function (t) { return !t.pending; }).slice(-120).map(function (t) { return { id: t.id, date: day(t.transacted_at || t.posted), amt: +t.amount, desc: String(t.description || '').slice(0, 70) }; }) };
    }) };
  props.setProperty('SFIN_LAST', String(Date.now()));
  try { cache.put('bank1', JSON.stringify(out), 7200); } catch (e) { /* too big to cache; fine */ }
  return out;
}

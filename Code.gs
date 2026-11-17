/**
 * Tally sync backend — runs inside a Google Sheet that you own.
 *
 * What it does
 *   - Stores your whole Tally data set in a hidden tab ("_tally") so your phone and computer stay in step.
 *   - Rewrites readable tabs (Weeks, Balances, Statements, Bills, Cards, Goals) on every save,
 *     so the Sheet is still a spreadsheet you can open, chart, or copy from.
 *   - Fetches quotes, the weekly mortgage rate, and headlines for the Markets tab.
 *
 * Setup (once, about 5 minutes)
 *   1. Make a new Google Sheet. Extensions > Apps Script. Delete what's there, paste this whole file, Save.
 *   2. Pick "setup" in the function menu and press Run. Approve the permissions.
 *      Open View > Logs (or Execution log) and copy the key it prints.
 *   3. Deploy > New deployment > type "Web app". Execute as: Me. Who has access: Anyone. Deploy.
 *      Copy the web app URL (it ends in /exec).
 *   4. In Tally: Settings > Sync with your Google Sheet. Paste the URL and the key. Connect.
 *
 * Security: "Anyone" means anyone who has BOTH the URL and the key can read and write this data.
 * Don't post either one. To lock everyone out, run newKey() and paste the new key into Tally.
 * After changing this code, use Deploy > Manage deployments > edit > New version so the same URL keeps working.
 */
var STATE_TAB = '_tally';
var QUOTE_TAB = '_quotes';
var CHUNK = 45000;

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TALLY_KEY')) props.setProperty('TALLY_KEY', Utilities.getUuid().replace(/-/g, ''));
  tab_(STATE_TAB, true);
  Logger.log('Your Tally key: ' + props.getProperty('TALLY_KEY'));
  return props.getProperty('TALLY_KEY');
}
function newKey() {
  PropertiesService.getScriptProperties().setProperty('TALLY_KEY', Utilities.getUuid().replace(/-/g, ''));
  Logger.log('New Tally key: ' + PropertiesService.getScriptProperties().getProperty('TALLY_KEY'));
}

function doGet(e) {
  try {
    var p = (e && e.parameter) || {};
    if (!authed_(p.key)) return out_({ ok: false, error: 'Wrong key' });
    if (p.action === 'load') return out_({ ok: true, state: loadState_() });
    if (p.action === 'market') return out_(market_(p));
    return out_({ ok: true, pong: true });
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    if (!authed_(body.key)) return out_({ ok: false, error: 'Wrong key' });
    if (body.action === 'save' && body.state) {
      var lock = LockService.getScriptLock(); lock.waitLock(20000);
      try { saveState_(body.state); } finally { lock.releaseLock(); }
      try { mirror_(body.state); } catch (mErr) { /* readable tabs are a convenience; never fail a save over them */ }
      return out_({ ok: true, updatedAt: body.state.updatedAt });
    }
    return out_({ ok: false, error: 'Unknown action' });
  } catch (err) { return out_({ ok: false, error: String(err && err.message || err) }); }
}

/* ---------- helpers ---------- */
function authed_(k) { var real = PropertiesService.getScriptProperties().getProperty('TALLY_KEY'); return !!(real && k && String(k) === real); }
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function tab_(name, hidden) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); if (hidden) sh.hideSheet(); }
  return sh;
}

/* ---------- state: one JSON document, split across cells in column A ---------- */
function saveState_(state) {
  var sh = tab_(STATE_TAB, true), json = JSON.stringify(state), rows = [[state.updatedAt || new Date().toISOString()]];
  for (var i = 0; i < json.length; i += CHUNK) rows.push([json.substr(i, CHUNK)]);
  sh.clearContents();
  sh.getRange(1, 1, rows.length, 1).setNumberFormat('@').setValues(rows);
}
function loadState_() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(STATE_TAB);
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
    (s.bills || []).map(function (b) { return [b.name, +b.amount || 0, b.freq === 'y' ? 'yearly' : 'monthly', b.day || '', b.month || '', b.account || '', b.off ? 'yes' : '']; }));
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

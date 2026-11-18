// Markets for Explore: quotes, the weekly 30-year mortgage rate, and headlines. Each source fails on its own.
import { cors, json, shortIn, tzOf, userOf } from "../_shared/util.ts";

const UA = { "User-Agent": "Mozilla/5.0 (Tally personal budget app)" };

async function yahoo(sym: string, tz: string) {
  const r = await fetch("https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(sym) + "?range=1d&interval=1d", { headers: UA });
  if (!r.ok) throw new Error("yahoo " + r.status);
  const m = (await r.json())?.chart?.result?.[0]?.meta;
  const price = m && +m.regularMarketPrice, prev = m && +(m.chartPreviousClose || m.previousClose);
  if (!isFinite(price)) throw new Error("no price");
  return { sym, price, pct: isFinite(prev) && prev ? (price - prev) / prev * 100 : null, date: m.regularMarketTime ? shortIn(tz, m.regularMarketTime * 1000) : "" };
}
async function stooq(sym: string) {
  try {
    const txt = await (await fetch("https://stooq.com/q/l/?s=" + encodeURIComponent(sym.toLowerCase()) + ".us&f=sd2t2ohlcv&h&e=csv")).text();
    const row = txt.trim().split("\n")[1].split(","), open = parseFloat(row[3]), close = parseFloat(row[6]);
    if (!isFinite(close)) throw new Error("no data");
    return { sym, price: close, pct: isFinite(open) && open ? (close - open) / open * 100 : null, date: row[1] };
  } catch {
    return { sym, price: null, pct: null, date: "no data" };
  }
}
async function mortgage() {
  const txt = await (await fetch("https://fred.stlouisfed.org/graph/fredgraph.csv?id=MORTGAGE30US", { headers: UA })).text();
  const rows = txt.trim().split("\n").map((l) => l.trim()).filter((l) => /^\d{4}-\d{2}-\d{2},[\d.]+$/.test(l));
  if (rows.length < 2) throw new Error("no data");
  const a = rows[rows.length - 1].split(","), b = rows[rows.length - 2].split(",");
  return { rate: parseFloat(a[1]), date: a[0], prev: parseFloat(b[1]) };
}
const ent = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").trim();
async function news(topic: string, n: number, tz: string) {
  const xml = await (await fetch("https://news.google.com/rss/search?q=" + encodeURIComponent(topic) + "&hl=en-US&gl=US&ceid=US:en", { headers: UA })).text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, n);
  return items.map((m) => {
    const it = m[1], tag = (t: string) => { const x = new RegExp("<" + t + "[^>]*>([\\s\\S]*?)</" + t + ">").exec(it); return x ? ent(x[1]) : ""; };
    const d = new Date(tag("pubDate"));
    return { title: tag("title"), link: tag("link"), source: tag("source"), topic, date: isNaN(+d) ? "" : shortIn(tz, d) };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await userOf(req);
    if (!user) return json({ ok: false, error: "Sign in again." }, 401);
    const p = await req.json().catch(() => ({}));
    const tz = await tzOf(user.id);
    const symbols = String(p.symbols || "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => /^[A-Z0-9.\-^=]{1,12}$/.test(x)).slice(0, 15);
    const topics = String(p.topics || "").split("|").map((x) => x.trim()).filter(Boolean).slice(0, 6);
    const res = { ok: true, quotes: [] as unknown[], mortgage: null as unknown, news: [] as unknown[], errors: [] as string[], at: new Date().toISOString() };
    const jobs: Promise<unknown>[] = [];
    jobs.push(Promise.all(symbols.map((s) => yahoo(s, tz).catch(() => stooq(s)))).then((q) => { res.quotes = q; }));
    jobs.push(mortgage().then((m) => { res.mortgage = m; }).catch((e) => { res.errors.push("mortgage rate: " + e.message); }));
    const per: unknown[][] = [];
    topics.forEach((t, i) => jobs.push(news(t, 4, tz).then((n) => { per[i] = n; }).catch((e) => { res.errors.push("news for " + t + ": " + e.message); })));
    await Promise.all(jobs);
    res.news = per.flat().filter(Boolean);
    return json(res);
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});

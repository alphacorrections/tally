// Bank connection through SimpleFIN Bridge (read-only).
// The access link is stored server-side in bank_links and never goes back to the app.
// SimpleFIN asks apps to stay under 24 requests a day, so results are cached for 2 hours
// and a forced refresh is allowed at most every 15 minutes.
import { cors, db, dayIn, json, tzOf, userOf } from "../_shared/util.ts";

const HOUR = 3600_000;

async function claim(uid: string, token: string) {
  let url = "";
  try { url = atob(token.trim()).trim(); } catch { /* not base64 */ }
  if (!/^https:\/\//.test(url)) return { ok: false, error: "That doesn’t look like a SimpleFIN setup token." };
  const r = await fetch(url, { method: "POST" });
  if (r.status === 403) return { ok: false, error: "That token was already used or doesn’t exist. Make a new one in SimpleFIN." };
  if (r.status >= 300) return { ok: false, error: "SimpleFIN said " + r.status };
  const access = (await r.text()).trim();
  await db()`insert into public.bank_links (user_id, access_url) values (${uid}, ${access})
             on conflict (user_id) do update set access_url = excluded.access_url, cache = null, cached_at = null, pulled_at = null`;
  try { return await pull(uid, true); } catch (e) { return { ok: true, connected: true, note: "Connected. First pull failed: " + (e as Error).message }; }
}

// deno-lint-ignore no-explicit-any
async function pull(uid: string, force: boolean): Promise<any> {
  const sql = db();
  const rows = await sql`select access_url, cache, cached_at, pulled_at from public.bank_links where user_id = ${uid}`;
  if (!rows.length) return { ok: true, connected: false };
  const row = rows[0], now = Date.now();
  const fresh = row.cache && row.cached_at && now - new Date(row.cached_at).getTime() < 2 * HOUR;
  const recent = row.pulled_at && now - new Date(row.pulled_at).getTime() < 15 * 60_000;
  if (fresh && (!force || recent)) return { ...row.cache, cached: true };

  const m = /^(https?):\/\/([^:/@]+):([^@]+)@(.+)$/.exec(row.access_url);
  if (!m) return { ok: false, error: "Saved bank link looks wrong. Reconnect." };
  const base = m[1] + "://" + m[4].replace(/\/$/, "");
  const start = Math.floor((now - 45 * 24 * HOUR) / 1000);
  const r = await fetch(base + "/accounts?version=2&start-date=" + start, {
    headers: { Authorization: "Basic " + btoa(decodeURIComponent(m[2]) + ":" + decodeURIComponent(m[3])) },
  });
  if (r.status === 402) return { ok: false, error: "SimpleFIN subscription needs payment." };
  if (r.status === 403) return { ok: false, error: "SimpleFIN turned this connection off. Reconnect with a new token." };
  if (r.status >= 300) return { ok: false, error: "SimpleFIN said " + r.status };
  const j = await r.json(), tz = await tzOf(uid), conns: Record<string, string> = {};
  // deno-lint-ignore no-explicit-any
  (j.connections || []).forEach((c: any) => { conns[c.conn_id] = c.name || c.org_url || ""; });
  const day = (t: number) => (t ? dayIn(tz, t * 1000) : "");
  const out = {
    ok: true, connected: true, at: new Date().toISOString(),
    // deno-lint-ignore no-explicit-any
    errors: (j.errlist || []).map((e: any) => e.msg || e.code).concat(j.errors || []),
    // deno-lint-ignore no-explicit-any
    accounts: (j.accounts || []).map((a: any) => ({
      id: a.id, name: a.name, conn: conns[a.conn_id] || (a.org && a.org.name) || "",
      bal: +a.balance, avail: a["available-balance"] != null ? +a["available-balance"] : null, date: day(a["balance-date"]),
      // deno-lint-ignore no-explicit-any
      hold: (a.holdings || []).filter((h: any) => h && h.symbol).slice(0, 60).map((h: any) => ({ sym: String(h.symbol).slice(0, 12), name: String(h.description || "").slice(0, 40) })),
      // deno-lint-ignore no-explicit-any
      txns: (a.transactions || []).filter((t: any) => !t.pending).slice(-120).map((t: any) => ({
        id: t.id, date: day(t.transacted_at || t.posted), amt: +t.amount, desc: String(t.description || "").slice(0, 70),
      })),
    })),
  };
  await sql`update public.bank_links set cache = ${sql.json(out)}, cached_at = now(), pulled_at = now() where user_id = ${uid}`;
  return out;
}

/* Older history, once: SimpleFIN allows at most 90 days per request and each bank decides how far back
   it shares, so walk back in 90-day steps until a step comes back empty (at most 5 requests). */
async function history(uid: string, days: number) {
  const sql = db();
  const rows = await sql`select access_url, history_at from public.bank_links where user_id = ${uid}`;
  if (!rows.length) return { ok: true, connected: false };
  if (rows[0].history_at && Date.now() - new Date(rows[0].history_at).getTime() < 6 * HOUR) return { ok: false, error: "Older history was pulled in the last few hours. Try again later so SimpleFIN doesn't limit the connection." };
  const m = /^(https?):\/\/([^:/@]+):([^@]+)@(.+)$/.exec(rows[0].access_url);
  if (!m) return { ok: false, error: "Saved bank link looks wrong. Reconnect." };
  const base = m[1] + "://" + m[4].replace(/\/$/, ""), auth = { Authorization: "Basic " + btoa(decodeURIComponent(m[2]) + ":" + decodeURIComponent(m[3])) };
  const tz = await tzOf(uid), day = (t: number) => (t ? dayIn(tz, t * 1000) : "");
  const DAY = 86400, stop = Math.floor(Date.now() / 1000) - Math.min(730, Math.max(90, days)) * DAY;
  let end = Math.floor(Date.now() / 1000), steps = 0, oldest = "";
  // deno-lint-ignore no-explicit-any
  const accts: Record<string, any> = {}, conns: Record<string, string> = {}, errors: string[] = [];
  while (end > stop && steps < 5) {
    const start = Math.max(stop, end - 90 * DAY);
    const r = await fetch(base + "/accounts?version=2&start-date=" + start + "&end-date=" + end, { headers: auth });
    steps++;
    if (r.status === 402) return { ok: false, error: "SimpleFIN subscription needs payment." };
    if (r.status === 403) return { ok: false, error: "SimpleFIN turned this connection off. Reconnect with a new token." };
    if (r.status >= 300) { errors.push("SimpleFIN said " + r.status); break; }
    const j = await r.json(); let n = 0;
    // deno-lint-ignore no-explicit-any
    (j.connections || []).forEach((c: any) => { conns[c.conn_id] = c.name || c.org_url || ""; });
    // deno-lint-ignore no-explicit-any
    (j.errlist || []).forEach((e: any) => { const msg = e.msg || e.code; if (msg && errors.indexOf(msg) < 0) errors.push(msg); });
    // deno-lint-ignore no-explicit-any
    (j.accounts || []).forEach((a: any) => {
      const x = accts[a.id] = accts[a.id] || { id: a.id, name: a.name, conn: conns[a.conn_id] || (a.org && a.org.name) || "", bal: +a.balance, avail: a["available-balance"] != null ? +a["available-balance"] : null, date: day(a["balance-date"]), txns: {} };
      // deno-lint-ignore no-explicit-any
      (a.transactions || []).forEach((t: any) => { if (t.pending || x.txns[t.id]) return; const d = day(t.transacted_at || t.posted); x.txns[t.id] = { id: t.id, date: d, amt: +t.amount, desc: String(t.description || "").slice(0, 70) }; n++; if (!oldest || d < oldest) oldest = d; });
    });
    if (!n) break;
    end = start;
  }
  await sql`update public.bank_links set history_at = now(), pulled_at = now() where user_id = ${uid}`;
  return { ok: true, connected: true, history: true, at: new Date().toISOString(), from: oldest, steps, errors,
    // deno-lint-ignore no-explicit-any
    accounts: Object.keys(accts).map((k) => { const a = accts[k]; return { ...a, txns: Object.keys(a.txns).map((t) => a.txns[t]).sort((p: any, q: any) => (p.date < q.date ? -1 : 1)) }; }) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await userOf(req);
    if (!user) return json({ ok: false, error: "Sign in again." }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body.action || "get";
    if (action === "off") { await db()`delete from public.bank_links where user_id = ${user.id}`; return json({ ok: true }); }
    if (action === "claim") return json(await claim(user.id, String(body.token || "")));
    if (action === "history") return json(await history(user.id, +body.days || 365));
    return json(await pull(user.id, !!body.force));
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});

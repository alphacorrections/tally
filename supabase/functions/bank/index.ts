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
      txns: (a.transactions || []).filter((t: any) => !t.pending).slice(-120).map((t: any) => ({
        id: t.id, date: day(t.transacted_at || t.posted), amt: +t.amount, desc: String(t.description || "").slice(0, 70),
      })),
    })),
  };
  await sql`update public.bank_links set cache = ${sql.json(out)}, cached_at = now(), pulled_at = now() where user_id = ${uid}`;
  return out;
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
    return json(await pull(user.id, !!body.force));
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});

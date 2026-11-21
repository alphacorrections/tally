// Push notifications and the icon badge.
//
// How a notification gets to a phone:
//   1. This function puts a row in push_queue for the device, then sends it an empty Web Push "wake up".
//   2. The app's service worker wakes, asks this function for its queue ({action:"pull"}), and shows it.
// Sending an empty push needs only a signed token (VAPID), so there is no message encryption to get wrong,
// and nothing about your money travels through Apple's or Google's push servers.
//
// The signing key pair is made here the first time and kept in push_keys. No secret to set by hand.
// Called every hour by pg_cron ({"tick":true}) to send reminders at each person's chosen hour.
import { cors, dayIn, db, json, userOf } from "../_shared/util.ts";

const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b as ArrayBuffer))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (s: string) => new TextEncoder().encode(s);
const CONTACT = Deno.env.get("PUSH_CONTACT") || "https://alphacorrections.github.io/tally/";

let _keys: { pub: string; key: CryptoKey } | null = null;
async function keys() {
  if (_keys) return _keys;
  const sql = db();
  let rows = await sql`select pub, priv from public.push_keys where id = 1`;
  if (!rows.length) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = b64u(await crypto.subtle.exportKey("raw", kp.publicKey)), priv = await crypto.subtle.exportKey("jwk", kp.privateKey);
    await sql`insert into public.push_keys (id, pub, priv) values (1, ${pub}, ${sql.json(priv as never)}) on conflict (id) do nothing`;
    rows = await sql`select pub, priv from public.push_keys where id = 1`;
  }
  const key = await crypto.subtle.importKey("jwk", rows[0].priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  _keys = { pub: rows[0].pub, key };
  return _keys;
}

/* Wake one device. true = delivered to the push service; false = that device is gone (row removed). */
async function wake(endpoint: string): Promise<boolean> {
  const k = await keys(), sql = db();
  let aud = "";
  try { aud = new URL(endpoint).origin; } catch { await sql`delete from public.push_subs where endpoint = ${endpoint}`; return false; }
  if (!/^https:\/\//.test(endpoint)) { await sql`delete from public.push_subs where endpoint = ${endpoint}`; return false; }
  const head = b64u(enc(JSON.stringify({ typ: "JWT", alg: "ES256" }))), claims = b64u(enc(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const sig = b64u(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.key, enc(head + "." + claims)));
  let status = 0;
  try {
    const r = await fetch(endpoint, { method: "POST", headers: { Authorization: "vapid t=" + head + "." + claims + "." + sig + ", k=" + k.pub, TTL: "86400", Urgency: "normal", "Content-Length": "0" } });
    status = r.status; await r.body?.cancel();
  } catch { status = 0; }
  if (status === 404 || status === 410) { await sql`delete from public.push_subs where endpoint = ${endpoint}`; return false; }
  if (status >= 200 && status < 300) { await sql`update public.push_subs set last_ok = now(), fails = 0 where endpoint = ${endpoint}`; return true; }
  await sql`update public.push_subs set fails = fails + 1 where endpoint = ${endpoint}`;
  await sql`delete from public.push_subs where endpoint = ${endpoint} and fails >= 12`;
  return false;
}

type Note = { title: string; body: string; tag: string; url: string; badge?: number | null };
/* Queue a note for every device a person has, then wake them. Returns how many devices were reached. */
async function notify(uid: string, n: Note): Promise<number> {
  const sql = db(), subs = await sql`select endpoint from public.push_subs where user_id = ${uid}`;
  let ok = 0;
  for (const s of subs) {
    await sql`insert into public.push_queue (endpoint, title, body, tag, url, badge) values (${s.endpoint}, ${n.title.slice(0, 120)}, ${n.body.slice(0, 300)}, ${n.tag.slice(0, 60)}, ${n.url.slice(0, 200)}, ${n.badge ?? null})`;
    if (await wake(s.endpoint)) ok++;
  }
  return ok;
}
/* Send once: the key says what this reminder is (for example "due:2026-11-21"). */
async function once(uid: string, key: string, n: Note): Promise<boolean> {
  const r = await db()`insert into public.push_sent (user_id, key) values (${uid}, ${key}) on conflict do nothing returning key`;
  if (!r.length) return false;
  await notify(uid, n);
  return true;
}

// ---- what is due, worked out from a person's saved Tally data ----
const P = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const clamp = (y: number, m: number, day: number) => { const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))); };
const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");
const dow = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(d);
type Ev = { d: string; t: string; a: number | null; kind: "bill" | "card" | "stmt" };
// deno-lint-ignore no-explicit-any
export function events(s: any, from: string, days: number): Ev[] {
  const start = P(from), end = new Date(start.getTime() + days * 864e5), out: Ev[] = [];
  for (let k = 0; k <= 1; k++) {
    const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1)), y = base.getUTCFullYear(), mo = base.getUTCMonth();
    // deno-lint-ignore no-explicit-any
    (s.cards || []).forEach((c: any) => {
      if (c.off) return;
      if (c.stmtDay) out.push({ d: iso(clamp(y, mo, +c.stmtDay)), t: c.name, a: null, kind: "stmt" });
      if (c.dueDay) {
        const dd = clamp(y, mo, +c.dueDay), st = ((s.statements || {})[iso(dd).slice(0, 7)] || {})[c.id];
        const plan = st && st.plan != null && st.plan !== "" ? +st.plan : null;
        if (!(st && st.st === "paid")) out.push({ d: iso(dd), t: c.name + " payment", a: plan != null ? plan : st ? +st.amt || null : null, kind: "card" });
      }
    });
    // deno-lint-ignore no-explicit-any
    (s.bills || []).forEach((b: any) => {
      if (b.off || !b.day || b.freq === "c") return;
      if (b.freq === "y") { if (b.month && +b.month - 1 === mo) out.push({ d: iso(clamp(y, mo, +b.day)), t: b.name, a: +b.amount || null, kind: "bill" }); }
      else out.push({ d: iso(clamp(y, mo, +b.day)), t: b.name, a: +b.amount || null, kind: "bill" });
    });
  }
  // deno-lint-ignore no-explicit-any
  (s.bills || []).forEach((b: any) => {
    if (b.off || b.freq !== "c" || !b.next) return;
    const a = P(b.next), n = Math.max(1, +b.n || 1);
    for (let i = 0; i < 120; i++) {
      const d = b.unit === "w" ? new Date(a.getTime() + 7 * n * i * 864e5) : clamp(a.getUTCFullYear(), a.getUTCMonth() + n * i, a.getUTCDate());
      if (d >= end) break;
      if (d >= start) out.push({ d: iso(d), t: b.name, a: +b.amount || null, kind: "bill" });
    }
  });
  const seen: Record<string, boolean> = {};
  return out.filter((e) => e.d >= from && e.d < iso(end) && !seen[e.d + e.kind + e.t] && (seen[e.d + e.kind + e.t] = true)).sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
}
const list = (ev: Ev[]) => ev.map((e) => e.t + (e.a ? " " + fmt(e.a) : "")).join(" · ");
const total = (ev: Ev[]) => ev.reduce((t, e) => t + (e.a || 0), 0);

function localNow(tz: string) {
  let wd = 0, hr = 0;
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hour12: false }).formatToParts(new Date());
    wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.find((x) => x.type === "weekday")!.value);
    hr = +p.find((x) => x.type === "hour")!.value % 24;
  } catch { /* fall back to Sunday midnight */ }
  return { wd, hr };
}

/* The hourly run: for each person with a device, send what is due at their chosen hour. */
async function tick() {
  const sql = db();
  const people = await sql`select d.user_id, d.state, d.tz from public.docs d where exists (select 1 from public.push_subs s where s.user_id = d.user_id)`;
  let sent = 0;
  for (const p of people) {
    try {
      const s = p.state || {}, pref = (s.profile && s.profile.push) || {};
      if (pref.on === false) continue;
      const tz = p.tz || "America/New_York", today = dayIn(tz), now = localNow(tz), hour = pref.hour == null ? 9 : +pref.hour;
      const tomorrow = iso(new Date(P(today).getTime() + 864e5)), ev = events(s, today, 4);
      const pay = (d: string) => ev.filter((e) => e.d === d && e.kind !== "stmt"), badge = pay(today).length + pay(tomorrow).length;
      if (now.hr === hour) {
        if (pref.due !== false) {
          const t0 = pay(today), t1 = pay(tomorrow);
          if (t0.length || t1.length) {
            const title = t1.length ? "Due tomorrow: " + (total(t1) ? fmt(total(t1)) : t1.length + (t1.length > 1 ? " bills" : " bill")) : "Due today: " + (total(t0) ? fmt(total(t0)) : t0.length + (t0.length > 1 ? " bills" : " bill"));
            const body = (t1.length ? list(t1) : "") + (t0.length ? (t1.length ? "\nToday: " : "") + list(t0) : "");
            if (await once(p.user_id, "due:" + today, { title, body, tag: "due", url: "#bills", badge })) sent++;
          }
        }
        if (pref.stmt !== false) {
          const in2 = iso(new Date(P(today).getTime() + 2 * 864e5));
          for (const e of ev.filter((x) => x.kind === "stmt" && x.d === in2)) {
            if (await once(p.user_id, "stmt:" + e.t + ":" + e.d, { title: e.t + " statement closes " + dow(P(e.d)), body: "What you owe that day is what gets reported. Paying it down before then helps your credit score.", tag: "stmt", url: "#cards", badge })) sent++;
          }
        }
      }
      const rm = (s.profile && s.profile.remind) || {};
      if (pref.checkin !== false && rm.on !== false && now.wd === (rm.day == null ? 0 : +rm.day) && now.hr === (rm.hour == null ? 9 : +rm.hour)) {
        const wk = events(s, today, 7).filter((e) => e.kind !== "stmt");
        if (await once(p.user_id, "checkin:" + today, { title: "Time to check in", body: "About a minute: confirm balances and plan the week." + (wk.length ? " " + wk.length + " due in the next 7 days" + (total(wk) ? ", " + fmt(total(wk)) : "") + "." : ""), tag: "checkin", url: "#checkin", badge: badge + 1 })) sent++;
      }
    } catch (e) { console.error("push tick", p.user_id, e); }
  }
  await sql`delete from public.push_queue where created_at < now() - interval '3 days'`;
  await sql`delete from public.push_sent where at < now() - interval '45 days'`;
  return { ok: true, sent };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({})), sql = db();
    if (b.tick) return json(await tick());

    /* A device asking what to show. The endpoint address is long and unguessable, and only that device has it. */
    if (b.action === "pull") {
      const ep = String(b.endpoint || "");
      if (!ep) return json({ ok: false, items: [] });
      const rows = await sql`update public.push_queue set fetched_at = now() where endpoint = ${ep} and fetched_at is null and created_at > now() - interval '2 days' returning id, title, body, tag, url, badge`;
      rows.sort((x, y) => Number(x.id) - Number(y.id));
      const last = rows.filter((r) => r.badge != null).pop();
      return json({ ok: true, items: rows.map((r) => ({ title: r.title, body: r.body, tag: r.tag, url: r.url })), badge: last ? last.badge : null });
    }

    const user = await userOf(req);
    if (!user) return json({ ok: false, error: "Sign in again." }, 401);
    if (b.action === "key") return json({ ok: true, key: (await keys()).pub });
    if (b.action === "sub") {
      const ep = String(b.endpoint || "");
      if (!/^https:\/\/[^\s]{20,1000}$/.test(ep)) return json({ ok: false, error: "That doesn’t look like a notification address." });
      await sql`insert into public.push_subs (endpoint, user_id, ua) values (${ep}, ${user.id}, ${String(b.ua || "").slice(0, 200)})
                on conflict (endpoint) do update set user_id = excluded.user_id, ua = excluded.ua, fails = 0`;
      return json({ ok: true });
    }
    if (b.action === "unsub") { await sql`delete from public.push_subs where endpoint = ${String(b.endpoint || "")} and user_id = ${user.id}`; return json({ ok: true }); }
    if (b.action === "status") {
      const n = await sql`select count(*)::int as n from public.push_subs where user_id = ${user.id}`;
      const mine = b.endpoint ? await sql`select 1 from public.push_subs where endpoint = ${String(b.endpoint)} and user_id = ${user.id}` : [];
      return json({ ok: true, devices: n[0].n, here: mine.length > 0 });
    }
    if (b.action === "test") {
      const n = await notify(user.id, { title: "Tally notifications are on", body: "This is what a reminder looks like. You pick which ones you get in Settings.", tag: "test", url: "", badge: null });
      return json(n ? { ok: true, devices: n } : { ok: false, error: "No device could be reached. Turn notifications off and on again on this phone." });
    }
    /* Someone changed something in a shared space: tell the other people in it, right away. */
    if (b.action === "together") {
      const sid = String(b.sid || ""), what = String(b.what || "").replace(/\s+/g, " ").trim().slice(0, 140);
      if (!sid || !what) return json({ ok: false });
      const mem = await sql`select user_id from public.space_members where space_id = ${sid}`;
      if (!mem.some((m) => m.user_id === user.id)) return json({ ok: false, error: "Not your space." }, 403);
      let n = 0;
      for (const m of mem) {
        if (m.user_id === user.id) continue;
        const d = await sql`select state from public.docs where user_id = ${m.user_id}`, pref = (d[0] && d[0].state && d[0].state.profile && d[0].state.profile.push) || {};
        if (pref.on === false || pref.together === false) continue;
        n += await notify(m.user_id, { title: "Together", body: what, tag: "together", url: "#together", badge: null });
      }
      return json({ ok: true, devices: n });
    }
    return json({ ok: false, error: "Unknown request." });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});

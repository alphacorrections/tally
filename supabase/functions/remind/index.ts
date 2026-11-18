// Weekly check-in reminder email.
// Called every hour by pg_cron ({"tick":true}): sends to each person whose day and hour have come
// in their own time zone, at most once a day. Called from the app with {"test":true}: sends one now to the caller.
// Mail goes out through SMTP (Gmail app password) set as function secrets SMTP_USER and SMTP_PASS.
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { cors, dayIn, db, json, userOf } from "../_shared/util.ts";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const P = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const clamp = (y: number, m: number, day: number) => { const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); return new Date(Date.UTC(y, m, Math.min(day, last))); };
const ym = (d: Date) => d.toISOString().slice(0, 7);
const fmtDay = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(d);
const fmt = (n: number) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (x: unknown) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Ev = { d: Date; t: string; a: number | null; note?: string };
// deno-lint-ignore no-explicit-any
function upcoming(s: any, todayStr: string, days: number): Ev[] {
  const start = P(todayStr), end = new Date(start.getTime() + days * 864e5), out: Ev[] = [];
  for (let k = -1; k <= 2; k++) {
    const base = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + k, 1)), y = base.getUTCFullYear(), mo = base.getUTCMonth();
    // deno-lint-ignore no-explicit-any
    (s.cards || []).forEach((c: any) => {
      if (c.off) return;
      if (c.stmtDay) out.push({ d: clamp(y, mo, +c.stmtDay), t: c.name + " statement closes", a: null, note: "Pay it down before this to lower what gets reported" });
      if (c.dueDay) {
        const dd = clamp(y, mo, +c.dueDay), st = ((s.statements || {})[ym(dd)] || {})[c.id];
        const plan = st && st.plan != null && st.plan !== "" ? +st.plan : null, fixed = +c.fixedPay || 0;
        const a = plan != null ? plan : fixed > 0 ? (st && +st.amt ? Math.min(fixed, +st.amt) : fixed) : st ? +st.amt || null : null;
        if (!(st && st.st === "paid")) out.push({ d: dd, t: c.name + " payment due", a });
      }
    });
    // deno-lint-ignore no-explicit-any
    (s.bills || []).forEach((b: any) => {
      if (b.off || !b.day || b.freq === "c") return;
      if (b.freq === "y") { if (b.month && +b.month - 1 === mo) out.push({ d: clamp(y, mo, +b.day), t: b.name + " (yearly)", a: +b.amount || null }); }
      else out.push({ d: clamp(y, mo, +b.day), t: b.name, a: +b.amount || null });
    });
  }
  // deno-lint-ignore no-explicit-any
  (s.bills || []).forEach((b: any) => {
    if (b.off || b.freq !== "c" || !b.next) return;
    const a = P(b.next), n = Math.max(1, +b.n || 1);
    for (let i = -60; i < 200; i++) {
      const d = b.unit === "w" ? new Date(a.getTime() + 7 * n * i * 864e5) : clamp(a.getUTCFullYear(), a.getUTCMonth() + n * i, a.getUTCDate());
      if (d >= end) break;
      if (d >= start) out.push({ d, t: b.name, a: +b.amount || null });
    }
  });
  return out.filter((e) => e.d >= start && e.d < end).sort((a, b) => +a.d - +b.d);
}

// deno-lint-ignore no-explicit-any
function build(s: any, todayStr: string, appUrl: string) {
  const ev = upcoming(s, todayStr, 7);
  let total = 0;
  const rows = ev.map((e) => {
    if (e.a) total += e.a;
    return '<tr><td style="padding:8px 12px 8px 0;color:#5B6470;white-space:nowrap">' + fmtDay(e.d) + '</td><td style="padding:8px 12px 8px 0"><b>' + esc(e.t) + "</b>" +
      (e.note ? '<br><span style="color:#5B6470;font-size:13px">' + esc(e.note) + "</span>" : "") + '</td><td style="padding:8px 0;text-align:right;white-space:nowrap">' + (e.a ? fmt(e.a) : "") + "</td></tr>";
  }).join("");
  const snaps = s.snaps || [], last = snaps.length ? snaps[snaps.length - 1].date : "";
  const name = (s.profile && s.profile.name) || "there";
  const html = '<div style="font-family:Inter,Arial,sans-serif;max-width:560px;color:#14161A;line-height:1.5">' +
    '<h2 style="margin:0 0 4px">Time to check in, ' + esc(name) + "</h2>" +
    '<p style="margin:0 0 16px;color:#5B6470">About a minute: confirm balances, explain last week, plan the next.' + (last ? " Last balances: " + esc(last) + "." : "") + "</p>" +
    (appUrl ? '<p><a href="' + esc(appUrl) + '" style="display:inline-block;background:#14513A;color:#FFFFFF;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:12px">Open Tally</a></p>' : "") +
    '<h3 style="margin:22px 0 6px">Next 7 days</h3>' +
    (rows ? '<table style="border-collapse:collapse;width:100%;font-size:14px">' + rows + "</table>" + (total ? '<p style="margin:8px 0 0"><b>Known amounts: ' + fmt(total) + "</b></p>" : "")
      : '<p style="color:#5B6470">Nothing due. Nice week to move a little extra to savings.</p>') +
    '<p style="margin-top:26px;font-size:12px;color:#8A919C">Sent by Tally. Change the day or turn it off in Tally &gt; Settings.</p></div>';
  const plain = "Time to check in, " + name + ".\n\nNext 7 days:\n" + (ev.map((e) => fmtDay(e.d) + "  " + e.t + (e.a ? "  " + fmt(e.a) : "")).join("\n") || "Nothing due.") + (appUrl ? "\n\nOpen Tally: " + appUrl : "");
  return { subject: "Tally check-in · " + ev.length + (ev.length === 1 ? " date" : " dates") + " this week", html, plain };
}

async function send(to: string, m: { subject: string; html: string; plain: string }) {
  const user = Deno.env.get("SMTP_USER"), pass = Deno.env.get("SMTP_PASS");
  if (!user || !pass) throw new Error("Email isn’t set up on the server yet (SMTP_USER and SMTP_PASS secrets).");
  const client = new SMTPClient({
    connection: { hostname: Deno.env.get("SMTP_HOST") || "smtp.gmail.com", port: +(Deno.env.get("SMTP_PORT") || 465), tls: true, auth: { username: user, password: pass } },
  });
  try {
    await client.send({ from: "Tally <" + user + ">", to, subject: m.subject, content: m.plain, html: m.html });
  } finally {
    await client.close();
  }
}

function localNow(tz: string) {
  let wd = "Sun", hr = 0;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(new Date());
    wd = parts.find((p) => p.type === "weekday")!.value; hr = +parts.find((p) => p.type === "hour")!.value % 24;
  } catch { /* bad zone: use UTC */ const d = new Date(); wd = DOW[d.getUTCDay()]; hr = d.getUTCHours(); }
  return { dow: DOW.indexOf(wd), hour: hr, day: dayIn(tz) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const sql = db();
  try {
    const body = await req.json().catch(() => ({}));
    if (body.test) {
      const user = await userOf(req);
      if (!user) return json({ ok: false, error: "Sign in again." }, 401);
      const rows = await sql`select state, tz, app_url from public.docs where user_id = ${user.id}`;
      if (!rows.length) return json({ ok: false, error: "Nothing saved to your account yet." });
      await send(user.email, build(rows[0].state, dayIn(rows[0].tz), rows[0].app_url));
      return json({ ok: true, to: user.email });
    }
    const rows = await sql`select d.user_id, d.state, d.tz, d.app_url, d.last_remind, u.email
                             from public.docs d join auth.users u on u.id = d.user_id
                            where coalesce(d.state->'profile'->'remind'->>'on', 'true') <> 'false'`;
    let sent = 0;
    const errors: string[] = [];
    for (const r of rows) {
      const rm = (r.state.profile && r.state.profile.remind) || {}, now = localNow(r.tz);
      const want = rm.day == null ? 0 : +rm.day, wantH = rm.hour == null ? 9 : +rm.hour;
      const last = r.last_remind ? new Date(r.last_remind).toISOString().slice(0, 10) : "";
      if (now.dow !== want || now.hour < wantH || last === now.day || !r.email) continue;
      try {
        await send(r.email, build(r.state, now.day, r.app_url));
        await sql`update public.docs set last_remind = ${now.day} where user_id = ${r.user_id}`;
        sent++;
      } catch (e) { errors.push((e as Error).message); }
    }
    return json({ ok: true, sent, errors });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) });
  }
});

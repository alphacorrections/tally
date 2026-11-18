// Shared helpers for Tally's server functions.
// Each function checks the caller's sign-in itself (verify_jwt is off in config.toml),
// and talks to the database directly as the server, so it never needs a secret key in the app.
import postgres from "npm:postgres@3.4.5";

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(o: unknown, status = 200): Response {
  return new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

let _sql: ReturnType<typeof postgres> | null = null;
export function db() {
  if (!_sql) _sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false, max: 2, idle_timeout: 20 });
  return _sql;
}

export type User = { id: string; email: string };

/* Ask the auth server who this access token belongs to. The app sends its publishable key as apikey. */
export async function userOf(req: Request): Promise<User | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!/^Bearer\s+\S+/i.test(auth)) return null;
  const apikey = req.headers.get("apikey") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const r = await fetch(Deno.env.get("SUPABASE_URL") + "/auth/v1/user", { headers: { apikey, Authorization: auth } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? { id: u.id, email: u.email || "" } : null;
}

/* yyyy-mm-dd in a time zone */
export function dayIn(tz: string, d: Date | number = Date.now()): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
  } catch {
    return new Date(d).toISOString().slice(0, 10);
  }
}
export function shortIn(tz: string, d: Date | number): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(d));
  } catch {
    return new Date(d).toISOString().slice(5, 10);
  }
}
export async function tzOf(uid: string): Promise<string> {
  const rows = await db()`select tz from public.docs where user_id = ${uid}`;
  return (rows[0] && rows[0].tz) || "America/New_York";
}

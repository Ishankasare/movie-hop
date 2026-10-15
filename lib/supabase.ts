import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// These must be written out in full so Next can inline them into the browser bundle.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

/** False when .env.local has no Supabase settings: the Race screens then explain what's missing. */
export const supabaseConfigured = Boolean(URL && ANON_KEY);

let client: SupabaseClient | null = null;

/** One browser-side client. The anonymous session is kept in localStorage so a refresh keeps your identity. */
export function getSupabase(): SupabaseClient {
  if (!URL || !ANON_KEY) throw new Error("supabase_not_configured");
  client ??= createClient(URL, ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: "movie-hop-auth" },
  });
  return client;
}

/** Returns the current anonymous user's id, signing in anonymously (no account, no password) if needed. */
export async function ensureUser(): Promise<string> {
  const db = getSupabase();
  const { data } = await db.auth.getSession();
  if (data.session?.user) return data.session.user.id;
  const { data: signedIn, error } = await db.auth.signInAnonymously();
  if (error || !signedIn.user) throw new Error("not_signed_in");
  return signedIn.user.id;
}

/** Calls a database function; throws Error(<server error code>) on failure. */
export async function callRpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

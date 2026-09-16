import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseKey, supabaseUrl } from "./config";
export async function serverClient() {
  const jar = await cookies();
  return createServerClient(supabaseUrl, supabaseKey, { cookieOptions: { sameSite:"lax", secure:process.env.NODE_ENV==="production" }, cookies: {
    getAll: () => jar.getAll(),
    setAll: (items) => { try { items.forEach(({ name, value, options }) => jar.set(name, value, options)); } catch { /* Server Components cannot set cookies; proxy refreshes them. */ } },
  } });
}

import { createBrowserClient } from "@supabase/ssr";
import { supabaseKey, supabaseUrl } from "./config";
export function browserClient() { return createBrowserClient(supabaseUrl, supabaseKey, { cookieOptions: { sameSite:"lax", secure:process.env.NODE_ENV==="production" } }); }

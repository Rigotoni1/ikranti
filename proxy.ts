import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { supabaseKey, supabaseUrl } from "./lib/supabase/config";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabaseKey, { cookieOptions: { sameSite:"lax", secure:process.env.NODE_ENV==="production" }, cookies: {
    getAll: () => request.cookies.getAll(),
    setAll: (items) => {
      items.forEach(({ name, value }) => request.cookies.set(name, value));
      response = NextResponse.next({ request });
      items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
    },
  } });
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/", "/account/:path*", "/auth/:path*", "/api/account/:path*"] };

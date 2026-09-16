import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { serverClient } from "@/lib/supabase/server";
export async function GET(request: Request) {
  const url = new URL(request.url);
  const client = await serverClient();
  const token = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const code = url.searchParams.get("code");
  const allowed = ["signup", "email", "recovery", "email_change"];
  const result = code ? await client.auth.exchangeCodeForSession(code)
    : token && type && allowed.includes(type) ? await client.auth.verifyOtp({ token_hash: token, type: type as EmailOtpType }) : { error: true };
  return NextResponse.redirect(new URL(result.error ? "/account?authError=1" : type==="recovery" || url.searchParams.get("recovery")==="1" ? "/account?recovery=1" : "/account", url.origin));
}

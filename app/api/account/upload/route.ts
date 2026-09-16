import { serverClient } from "@/lib/supabase/server";
import { supabaseUrl } from "@/lib/supabase/config";
export const maxDuration = 60;
export async function POST(request: Request) {
  // Reject cross-origin form submissions before forwarding any document.
  const origin = request.headers.get("origin");
  let sameOrigin = false;
  try {
    const parsed = new URL(origin || "");
    sameOrigin = ["http:","https:"].includes(parsed.protocol) && parsed.host === request.headers.get("host");
  } catch { /* Missing/malformed browser origin is rejected. */ }
  if (!sameOrigin) return Response.json({ error:"Invalid origin" },{status:403});
  const client = await serverClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return Response.json({ error:"Sign in first" },{status:401});
  const { data: { session } } = await client.auth.getSession();
  if (!session) return Response.json({ error:"Session expired" },{status:401});
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/ir-launch-worker`,{
      method:"POST", headers:{ Authorization:`Bearer ${session.access_token}`,"Content-Type":request.headers.get("content-type") || "" },
      body:request.body, duplex:"half", signal:AbortSignal.timeout(45000),
    } as RequestInit);
    return new Response(await response.text(),{status:response.status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
  } catch { return Response.json({ error:"Upload could not be confirmed. Refresh your documents before retrying." },{status:502}); }
}

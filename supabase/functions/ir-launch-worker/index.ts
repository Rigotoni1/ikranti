import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const url = Deno.env.get("SUPABASE_URL")!;
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
Deno.serve(async (request) => {
  const origin=request.headers.get("origin");
  const allowedOrigins=new Set(["https://irkanti.com","https://ikranti-six.vercel.app","http://127.0.0.1:3199","http://localhost:3000"]);
  const cors:Record<string,string>={"Cache-Control":"no-store","Vary":"Origin"};
  if(origin&&allowedOrigins.has(origin)) cors["Access-Control-Allow-Origin"]=origin;
  const json=(value:unknown,status=200)=>Response.json(value,{status,headers:cors});
  if(origin&&!allowedOrigins.has(origin)) return json({error:"Invalid origin"},403);
  if(request.method==="OPTIONS") return new Response(null,{status:204,headers:{...cors,"Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info"}});
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("x-worker-token")) {
    const { data: allowed } = await service.rpc("ir_worker_auth", { p_token: request.headers.get("x-worker-token") });
    if (!allowed) return json({ error: "Unauthorized" }, 401);
    const key = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("RESEND_FROM");
    // Do not consume attempts while the domain/provider is unconfigured.
    if (!key || !from) return json({ error: "Email delivery not configured; notifications remain queued." }, 503);
    const { data, error } = await service.rpc("ir_claim_email_batch");
    if (error) return json({ error: "Unable to claim notification batch" }, 500);
    for (const item of data || []) {
      let failure: string | null = null;
      try {
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST", signal: AbortSignal.timeout(8000),
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": `ir-notification-${item.id}` },
          body: JSON.stringify({ from, to: [item.email], subject: `Irkanti · ${item.kind.replaceAll("_", " ")}`, text: `${item.message}\n\nView your account securely: https://irkanti.com/account\n\nIrkanti will never ask you to pay by replying to an email.` }),
        });
        if (!response.ok) failure = `Provider HTTP ${response.status}`;
      } catch { failure = "Provider delivery timed out or unavailable"; }
      await service.rpc("ir_finish_email", { p_id: item.id, p_lease: item.lease, p_error: failure });
    }
    return json({ processed: data?.length || 0 });
  }

  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Sign in first" }, 401);
  const { data: { user }, error: authError } = await service.auth.getUser(authorization.slice(7));
  if (authError || !user) return json({ error: "Session expired" }, 401);
  const client = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
  const { error: allowance } = await client.rpc("ir_upload_allowance");
  if (allowance) return json({ error: allowance.message }, 429);
  try {
    // Bound the complete multipart body before parsing, even for chunked requests.
    const reader = request.body?.getReader();
    if (!reader) return json({ error: "Missing file" }, 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    while (true) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.length;
      if (bytes > 8 * 1024 * 1024 + 65536) { await reader.cancel(); return json({ error: "Upload too large" }, 413); }
      chunks.push(part.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") || "" } }).formData();
    const file = form.get("file");
    const kind = String(form.get("kind") || "");
    const auction = form.get("auctionId") ? String(form.get("auctionId")) : null;
    if (!(file instanceof File) || !file.size) return json({ error: "File required" }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    const ascii = (start: number, end: number) => new TextDecoder().decode(data.slice(start, end));
    const mime = data[0]===255 && data[1]===216 && data[2]===255 ? "image/jpeg"
      : data.slice(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]) && data.length>8 ? "image/png"
      : ascii(0,4)==="RIFF" && ascii(8,12)==="WEBP" ? "image/webp"
      : ascii(0,5)==="%PDF-" ? "application/pdf" : "";
    const isImage = kind === "listing_image";
    if (mime !== file.type || !(isImage ? ["image/jpeg","image/png","image/webp"] : ["image/jpeg","image/png","application/pdf"]).includes(mime)) return json({ error: "Unsupported file content" }, 400);
    if (file.size > (isImage ? 4 : 8)*1024*1024) return json({ error: "File too large" }, 413);
    if (isImage && !auction) return json({ error: "Select a listing" }, 400);
    const extension = ({ "image/jpeg":"jpg", "image/png":"png", "image/webp":"webp", "application/pdf":"pdf" } as Record<string,string>)[mime];
    const path = `${user.id}/${crypto.randomUUID()}.${extension}`;
    const bucket = isImage ? "ir-auction-images" : "ir-private-documents";
    const { error: upload } = await service.storage.from(bucket).upload(path,data,{ contentType:mime,upsert:false });
    if (upload) return json({ error: "Upload failed" }, 500);
    const { error: register } = isImage
      ? await client.rpc("ir_register_image",{ p_auction:auction,p_path:path })
      : await client.rpc("ir_register_document",{ p_auction:auction,p_kind:kind,p_path:path,p_mime:mime,p_size:file.size });
    if (register) { await service.storage.from(bucket).remove([path]); return json({ error: register.message }, 400); }
    return json({ ok:true });
  } catch { return json({ error: "Invalid upload" }, 400); }
});

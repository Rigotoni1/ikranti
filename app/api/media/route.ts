import { env } from "cloudflare:workers";

type MediaEnv = typeof env & { MEDIA: R2Bucket };

const accepted = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  if (!accepted.has(file.type)) return Response.json({ error: "Use a JPG, PNG or WebP image." }, { status: 400 });
  if (file.size > 8 * 1024 * 1024) return Response.json({ error: "The image must be smaller than 8 MB." }, { status: 400 });
  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `lots/${crypto.randomUUID()}.${extension}`;
  await (env as MediaEnv).MEDIA.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name.slice(0, 180) } });
  return Response.json({ url: `/api/media?key=${encodeURIComponent(key)}` });
}

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get("key");
  if (!key || !key.startsWith("lots/")) return new Response("Not found", { status: 404 });
  const object = await (env as MediaEnv).MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(object.body, { headers });
}

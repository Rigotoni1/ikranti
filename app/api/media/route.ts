export async function POST() {
  return Response.json({ error: "Shared demo uploads have been retired. Sign in at /account." }, { status: 410 });
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase/server";
import AdminConsole from "./console";
import "../account/portal.css";

export const dynamic = "force-dynamic";
export default async function AdminPage() {
  const client = await serverClient();
  const {data:{user},error} = await client.auth.getUser();
  if(error || !user) redirect("/account");
  const {data:profile} = await client.from("ir_profiles").select("role,suspended").eq("id",user.id).maybeSingle();
  if(profile?.role!=="admin" || profile.suspended) return <main className="portal"><div className="portalBody"><h1>Administrator access required</h1><p>This area is restricted to authorised staff.</p><Link href="/account">Return to your account</Link></div></main>;
  // This RPC checks current DB role, active session, suspension and AAL2.
  const {error:accessError} = await client.rpc("ir_delivery_health");
  if(accessError) return <main className="portal"><div className="portalBody"><h1>Verify administrator access</h1><p>Complete two-factor verification in Account Security, then return here. If you have already verified, refresh or sign in again.</p><Link href="/account?tab=security">Open account security</Link></div></main>;
  return <AdminConsole/>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { browserClient } from "@/lib/supabase/browser";

type Row = Record<string, unknown>;
export const decisionLabels: Record<string, string> = {
  verify_buyer: "Approve buyer identity",
  approve_seller: "Approve seller",
  request_buyer_changes: "Request buyer changes",
  request_seller_changes: "Request seller changes",
  reject_seller: "Reject seller application",
  suspend: "Suspend account",
  reinstate: "Reinstate account",
};

export function StaffDecisions({ user, documents, onboarding, application, busy, onBusy, onSaved }: {
  user: Row; documents: Row[]; onboarding: Row[]; application: Row | null;
  busy: boolean; onBusy: (busy: boolean) => void; onSaved: () => Promise<void>;
}) {
  const [action, setAction] = useState("");
  const [note, setNote] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [match, setMatch] = useState("");
  const [linkedUser, setLinkedUser] = useState("");
  const [identitySearch, setIdentitySearch] = useState("");
  const [matches, setMatches] = useState<{ query: string; users: Row[]; error: string } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const [opened, setOpened] = useState<string[]>([]);
  const [privateLink, setPrivateLink] = useState<{ id: string; url: string; expires: number } | null>(null);
  const inFlight = useRef(false);
  const attempt = useRef<{ payload: string; id: string } | null>(null);
  const ids = documents.filter(d => d.kind === "identity" && !d.auction_id)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const selectedId = documentId || String(ids[0]?.id || "");
  const document = ids.find(d => d.id === selectedId);
  const approval = action === "verify_buyer" || action === "approve_seller";
  const access = action === "suspend" || action === "reinstate";
  const verifiedUsers = matches?.query === identitySearch ? matches.users : [];
  const searching = identitySearch.trim().length >= 2 && matches?.query !== identitySearch;
  const setup = onboarding.find(o => o.account_type === (action === "approve_seller" ? "seller" : "buyer"));
  const details = (setup?.details || {}) as Row;
  const businessDocuments = documents.filter(d => d.kind === "business" && !d.auction_id);
  const businessRequired = action === "approve_seller" && !!application?.business_name;
  const evidenceOpened = opened.includes(selectedId) && (!businessRequired || businessDocuments.some(d => opened.includes(String(d.id))));

  useEffect(() => {
    if (match !== "linked" || identitySearch.trim().length < 2) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void browserClient().rpc("ir_admin_identity_matches", { p_search: identitySearch.trim(), p_exclude: user.id }).then(({ data, error }) => {
        if (active) setMatches({ query: identitySearch, users: (data || []) as Row[], error: error?.message || "" });
      });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [identitySearch, match, user.id]);
  const options = [
    ...(user.buyer_role && !user.identity_approved ? ["verify_buyer", "request_buyer_changes"] : []),
    ...(application && user.seller_status !== "approved" ? ["approve_seller", "request_seller_changes", "reject_seller"] : []),
    user.suspended ? "reinstate" : "suspend",
  ];
  const checks = approval ? [
    ["Email verified", !!user.email_verified],
    ["Account active", !user.suspended],
    [action === "verify_buyer" ? "Buyer setup complete" : "Seller setup complete", !!(action === "verify_buyer" ? user.buyer_complete : user.seller_complete)],
    ["Identity document submitted", !!document],
    ...(action === "approve_seller" && application?.business_name ? [["Business document submitted", documents.some(d => d.kind === "business" && !d.auction_id)]] : []),
  ] as [string, boolean][] : [];
  const ready = checks.every(([, ok]) => ok);

  function choose(value: string) {
    setAction(value); setConfirmed(false); setMessage(""); setFailed(false); setSaved(false);
    setNote(value === "verify_buyer" ? "Identity document reviewed and matched to the account details."
      : value === "approve_seller" ? "Seller details and supporting documents reviewed and approved." : "");
    attempt.current = null;
  }

  async function openDocument(evidence: Row) {
    if (inFlight.current) return;
    // Open synchronously so browsers do not block the staff-initiated private preview.
    const preview = window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    inFlight.current = true; onBusy(true); setMessage(""); setPrivateLink(null);
    try {
      const result = await browserClient().storage.from("ir-private-documents").createSignedUrl(String(evidence.path), 60);
      if (result.error) throw result.error;
      if (preview) {
        preview.location.replace(result.data.signedUrl);
        setOpened(previous => [...new Set([...previous, String(evidence.id)])]);
      } else setPrivateLink({ id: String(evidence.id), url: result.data.signedUrl, expires: Date.now() + 60000 });
    } catch (error) { preview?.close(); setFailed(true); setMessage(error instanceof Error ? error.message : "Could not open the private document. Try again."); }
    finally { inFlight.current = false; onBusy(false); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || saved || !action) return;
    inFlight.current = true; onBusy(true); setMessage(""); setFailed(false);
    const args = {
      p_user: user.id, p_action: action, p_note: note.trim(),
      p_document: approval ? selectedId : null,
      p_identity_match: approval ? (user.identity_approved ? "existing" : match) : null,
      p_linked_user: approval && !user.identity_approved && match === "linked" ? linkedUser : null,
      p_reviewed: confirmed,
    };
    const payload = JSON.stringify(args);
    if (attempt.current?.payload !== payload) attempt.current = { payload, id: crypto.randomUUID() };
    try {
      const result = await browserClient().rpc("ir_staff_user_decision", { ...args, p_decision_id: attempt.current.id });
      if (result.error) throw result.error;
      setSaved(true);
      setMessage("Decision saved. The user has an account notification; email is queued for delivery.");
      try { await onSaved(); }
      catch { setMessage("Decision saved, but updated records could not be loaded. Refresh the directory before another decision."); }
    } catch (error) { setFailed(true); setMessage(error instanceof Error ? error.message : "Could not save. Your entries are still here; please retry."); }
    finally { inFlight.current = false; onBusy(false); }
  }

  return <section className="staffDecisions" aria-labelledby="staff-decisions-title">
    <h3 id="staff-decisions-title">Staff decisions</h3>
    <p>Deciding for <strong>{String(user.name)}</strong> · {String(user.email)}</p>
    <p className="muted">Review the evidence, choose an action and save. The decision, your name and message are recorded in this user’s activity.</p>
    <div className="portalLinks decisionActions">{options.map(value => <button type="button" key={value} disabled={busy} aria-pressed={action === value} onClick={() => choose(value)}>{decisionLabels[value]}</button>)}</div>
    {!action && <p>Select a decision above. Approvals never happen automatically.</p>}
    {action && !saved && <form onSubmit={save}>
      <fieldset disabled={busy}>
        <legend>{decisionLabels[action]}</legend>
        {approval && <>
          <dl className="reviewAccountDetails">{Object.entries({"Legal name":application&&action==="approve_seller"?application.legal_name:details.legal_name,"Address":application&&action==="approve_seller"?application.address:details.address,"Phone":details.phone,...(businessRequired?{"Business name":application?.business_name,"Registration number":application?.registration_number}:{})}).map(([title,value])=><div key={title}><dt>{title}</dt><dd>{String(value||"Not provided")}</dd></div>)}</dl>
          <ul className="decisionChecklist">{checks.map(([title, ok]) => <li key={title}><span className={ok ? "checkReady" : "checkMissing"}>{ok ? "✓ Ready" : "Needed"}</span> {title}</li>)}</ul>
          {!ready && <p className="portalMessage">The user must complete the items marked “Needed” before approval. You can request changes instead.</p>}
          {ids.length > 0 && <div className="reviewEvidence">
            <label>Identity document<select value={selectedId} onChange={e => { setDocumentId(e.target.value); setConfirmed(false); setPrivateLink(null); }}>
              {ids.map(d => <option key={String(d.id)} value={String(d.id)}>ID uploaded {new Date(String(d.created_at)).toLocaleString("en-MT")}</option>)}
            </select></label>
            <button type="button" onClick={() => { if (document) void openDocument(document); }}>Open private ID ↗</button>
            {businessRequired && businessDocuments.map(d => <button key={String(d.id)} type="button" onClick={() => void openDocument(d)}>Open business document · {new Date(String(d.created_at)).toLocaleDateString("en-MT")} ↗</button>)}
            {privateLink && <a href={privateLink.url} target="_blank" rel="noopener noreferrer" onClick={e => {
              if (privateLink.expires <= Date.now()) { e.preventDefault(); setPrivateLink(null); setMessage("Private link expired. Open the document again for a new link."); return; }
              setOpened(previous => [...new Set([...previous, privateLink.id])]);
            }}>Popup blocked? Open the private document here ↗</a>}
            <small>Only authorised staff can access this document. Links expire after one minute.</small>
          </div>}
          {user.identity_approved ? <p>Identity is already approved. Its existing account link will be kept.</p> : <>
            <label>Does this person already have a verified account?<select required value={match} onChange={e => { setMatch(e.target.value); setLinkedUser(""); setConfirmed(false); }}>
              <option value="">Choose after checking their details</option><option value="new">No — this is their first verified account</option><option value="linked">Yes — link to their existing verified account</option>
            </select><small>Check the name and identity evidence, not just the email address. Linked accounts cannot bid on their own seller listings.</small></label>
            {match === "linked" && <><label>Find the existing verified account<input type="search" maxLength={160} value={identitySearch} placeholder="Search name or email (at least 2 characters)" onChange={e => { setIdentitySearch(e.target.value); setLinkedUser(""); setConfirmed(false); }}/></label>
            <p role="status">{searching?"Searching verified accounts…":matches?.query===identitySearch&&matches.error?matches.error:identitySearch.trim().length>=2&&!verifiedUsers.length?"No matching verified accounts. Try another name or email.":"Compare the identity evidence before linking; a similar name alone is not enough."}</p>
            <label>Existing verified account<select required value={linkedUser} onChange={e => {setLinkedUser(e.target.value);setConfirmed(false);}}>
              <option value="">Choose the same person’s verified account</option>{verifiedUsers.map(u => <option value={String(u.id)} key={String(u.id)}>{String(u.name)} · {String(u.email)}</option>)}
            </select><small>Search covers all verified accounts; up to 20 matches are shown. If the correct account is not listed, do not choose “first account”.</small></label></>}
          </>}
          <label className="checkLabel"><input type="checkbox" required checked={confirmed} disabled={!evidenceOpened} onChange={e => setConfirmed(e.target.checked)} />I reviewed this ID, matched it to the account details and checked any business evidence and existing account link.</label>
          {!evidenceOpened && <small>Open the selected private ID and any required business evidence before confirming your review.</small>}
        </>}
        {!approval && <label>Reason template<select defaultValue="" onChange={e => { if (e.target.value) setNote(e.target.value); }}>
          <option value="">Write your own or choose a starting point</option>
          {["Please upload a clearer copy of your identity document.", "Please make sure your legal name matches your identity document.", "Supporting business information is required.", "Please complete your account setup.", "Account access paused pending a staff review.", "Review completed. Account access restored."].map(value => <option key={value}>{value}</option>)}
        </select></label>}
        <label>Message to the user<textarea required minLength={5} maxLength={2000} value={note} onChange={e => setNote(e.target.value)} /><small>This is sent to the user and saved in the audit trail. Do not include document numbers or other sensitive ID details.</small></label>
        {access && <label className="checkLabel"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />I confirm {action === "suspend" ? "suspending" : "restoring"} access for {String(user.email)}.</label>}
        <button className={action === "suspend" || action === "reject_seller" ? "dangerButton" : "goldButton"} disabled={!ready || (approval && (!confirmed || !evidenceOpened))}>{busy ? "Saving…" : decisionLabels[action]}</button>
        <p className="muted">Unsaved entries stay only while this user profile is open.</p>
      </fieldset>
    </form>}
    {message && <p className="portalMessage" role={failed ? "alert" : "status"}>{message}</p>}
    {saved && <button type="button" onClick={() => { setAction(""); setSaved(false); setMessage(""); }}>Make another decision</button>}
  </section>;
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import { browserClient } from "@/lib/supabase/browser";
import { supabaseUrl } from "@/lib/supabase/config";
import { UploadFile } from "../account/upload-file";

type Row = Record<string, unknown>;
type Props = { listing?: Row; busy: boolean; onBusy: (busy: boolean) => void; onSaved: (id: string) => Promise<void> };
const categories = ["Property", "Motor Cars", "Boats", "Watches & Jewellery", "Art & Antiques", "Collectables"];
const field = (data: FormData, key: string) => String(data.get(key) || "").trim();
const localTime = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
};

export function listingEditable(listing?: Row) {
  return !listing || (["under_review", "changes_requested", "rejected", "live"].includes(String(listing.status)) && Number(listing.bid_count) === 0 && !listing.highest_bidder_id && (listing.status !== "live" || new Date(String(listing.end_at)).getTime() > Date.now()));
}

export function listingArguments(data: FormData) {
  const end = new Date(field(data, "end")).getTime();
  if (!Number.isFinite(end) || end < Date.now() + 86400000 || end > Date.now() + 90 * 86400000) throw new Error("Choose a closing time between 1 and 90 days from now.");
  const start = Number(data.get("start")), reserve = Number(data.get("reserve"));
  if (!field(data, "start") || !field(data, "reserve") || !Number.isFinite(start) || !Number.isFinite(reserve) || start <= 0 || reserve < 0 || start > 999999999999 || reserve > 999999999999 || Math.abs(start * 100 - Math.round(start * 100)) > 0.0001 || Math.abs(reserve * 100 - Math.round(reserve * 100)) > 0.0001) throw new Error("Enter valid prices with no more than two decimal places.");
  if (field(data, "title").length < 5 || field(data, "description").length < 20 || field(data, "location").length < 2 || !categories.includes(field(data, "category"))) throw new Error("Complete the title, description, category and location.");
  return { p_title: field(data, "title"), p_description: field(data, "description"), p_category: field(data, "category"), p_location: field(data, "location"), p_start: start, p_reserve: reserve, p_end: new Date(end).toISOString() };
}

export function ListingEditor({ listing, busy, onBusy, onSaved }: Props) {
  const [message, setMessage] = useState("");
  const [savedId, setSavedId] = useState("");
  const inFlight = useRef(false);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy || savedId) return;
    const data = new FormData(event.currentTarget);
    inFlight.current = true; onBusy(true); setMessage("");
    try {
      const args = listingArguments(data);
      const { data: id, error } = await browserClient().rpc(listing ? "ir_edit_listing" : "ir_create_listing", listing ? { ...args, p_auction: listing.id } : args);
      if (error) throw error;
      const saved = String(listing?.id || id);
      setSavedId(saved);
      setMessage("Saved for review. Add a listing photograph before approval.");
      try { await onSaved(saved); }
      catch { setMessage("Listing saved, but the inventory could not refresh. Refresh records before editing again; do not create a duplicate."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : String((error as {message?: string}).message || "Could not save. Your inputs are still here.")); }
    finally { inFlight.current = false; onBusy(false); }
  }
  return <section className="staffListingEditor">
    <h3>{listing ? "Edit listing details" : "Create an auction listing"}</h3>
    <p className="muted">Team-only inventory management. Saving sends the listing to review; it does not publish it. Existing ownership is retained. Unsaved inputs remain only while this form is open.</p>
    {!listingEditable(listing) ? <p>Editing is locked after the first bid or once the auction closes.</p> : <form onSubmit={save}><fieldset disabled={busy || !!savedId}>
      <label>Title<input name="title" required minLength={5} maxLength={160} defaultValue={String(listing?.title || "")}/></label>
      <label>Category<select name="category" defaultValue={String(listing?.category || categories[0])}>{categories.map(category => <option key={category}>{category}</option>)}</select></label>
      <label>Location<input name="location" required minLength={2} maxLength={160} defaultValue={String(listing?.location || "")}/></label>
      <label>Description & condition<textarea name="description" required minLength={20} maxLength={10000} defaultValue={String(listing?.description || "")}/></label>
      <div className="formPair"><label>Starting price (€)<input name="start" type="number" min="0.01" max="999999999999" step="0.01" required defaultValue={listing ? Number(listing.start_price) : ""}/></label><label>Reserve (€; 0 for none)<input name="reserve" type="number" min="0" max="999999999999" step="0.01" required defaultValue={Number(listing?.reserve_price || 0)}/></label></div>
      <label>Closing time (your local time)<input name="end" type="datetime-local" required defaultValue={localTime(listing?.end_at)}/></label>
      <button className="goldButton">{busy ? "Saving…" : listing ? "Save changes for review" : "Create listing for review"}</button>
    </fieldset></form>}
    {message && <p className="portalMessage" role="status">{message}</p>}
  </section>;
}

export function ListingUploads({ listing, busy, onBusy, onSaved }: Omit<Props, "listing"> & { listing: Row }) {
  const [message, setMessage] = useState("");
  const [version, setVersion] = useState(0);
  const inFlight = useRef(false);
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current || busy) return;
    const data = new FormData(event.currentTarget);
    data.set("auctionId", String(listing.id));
    inFlight.current = true; onBusy(true); setMessage("");
    try {
      const { data: { session } } = await browserClient().auth.getSession();
      if (!session) throw new Error("Sign in again to continue.");
      const response = await fetch(`${supabaseUrl}/functions/v1/ir-launch-worker`, { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` }, body: data, signal: AbortSignal.timeout(60000) });
      const result = await response.json() as {error?: string; ok?: boolean};
      if (!response.ok || !result.ok) throw new Error(result.error || "Upload could not be confirmed. Please retry.");
      setVersion(value => value + 1); setMessage("Upload saved. Listing photos are public; evidence remains private.");
      try { await onSaved(String(listing.id)); } catch { setMessage("Upload saved, but the inventory could not refresh. Refresh records to see it."); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Upload failed. The selected file has been kept."); }
    finally { inFlight.current = false; onBusy(false); }
  }
  return <details className="staffListingTools"><summary>Listing photos & private evidence</summary>
    {listing.status !== "under_review" || !listingEditable(listing) ? <p>Save eligible listing edits for review before replacing its photo or adding evidence. Listings with bids cannot be changed.</p> : <form onSubmit={upload}><fieldset disabled={busy}>
      <label>Upload type<select name="kind"><option value="listing_image">Listing photograph — PUBLIC</option><option value="ownership">Ownership evidence — private</option><option value="property_title">Property title / legal pack — private</option><option value="vehicle_registration">Vehicle registration — private</option><option value="boat_registration">Boat registration — private</option><option value="provenance">Authenticity / provenance — private</option><option value="condition">Condition report — private</option></select></label>
      <UploadFile key={version}/><p className="muted">Public photos: JPEG/PNG/WebP, up to 4 MB. Private evidence: PDF/JPEG/PNG, up to 8 MB. Never use an ID document as a public photo.</p>
      <button className="goldButton">{busy ? "Uploading…" : "Upload to this listing"}</button>
    </fieldset></form>}
    {message && <p className="portalMessage" role="status">{message}</p>}
  </details>;
}

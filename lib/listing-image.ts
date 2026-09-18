import { supabaseUrl } from "./supabase/config";

/** Seed inventory may reuse illustrative photographs from our existing catalogue. */
export function listingImageUrl(path: unknown): string {
  if (typeof path !== "string" || !path) return "";
  if (path.startsWith("https://images.unsplash.com/")) return path;
  return `${supabaseUrl}/storage/v1/object/public/ir-auction-images/${path}`;
}

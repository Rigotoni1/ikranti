# Bid-history chat

Release notes for 22 September 2026. Apply the reviewed migration before promoting the matching frontend. Deployment status is recorded in Supabase migration history and Vercel.

## Behaviour

- Opening a marketplace lot shows a dark bid-history panel to the left. On narrow screens it stacks below the lot with links between history and the bidding form.
- Bids run oldest-to-newest. Your Bid has a green icon/right-aligned bubble; Floor bid has a grey icon/left-aligned bubble. Text badges identify the leading bid independently of colour.
- A defending proxy reply follows the challenged bid. Equal prices explain earlier-bidder priority. Raising your own unspent maximum creates no public message.
- Only a finalized `sold` result says Winning bid; reserve failure, withdrawal and awaiting settlement are separate states.
- History follows the latest message unless the reader scrolls up. New messages then expose a jump-to-latest button. Earlier bids are paginated.
- Supabase Realtime invalidates history through the existing **public auction projection**, not through private bid records. Opening, reconnecting, returning to the tab and an accepted bid fetch fresh authoritative data. A 30-second fallback runs only with a degraded connection.
- Existing records cannot reconstruct reliable proxy chronology. Older auctions show a clearly labelled current-bid snapshot, without an invented timestamp. New bids get the full transcript.

## Database and privacy

Migration: `supabase/migrations/20260922122844_bid_chat_history.sql`.

- Adds `ir_private.bid_chat_events` with RLS enabled and no browser table/sequence privileges. It is not added to Realtime publications.
- Augments the existing bid transaction under its existing user advisory and auction row locks. Retries return before writing any additional messages. All current eligibility checks, self/linked-seller protections, rate limits and anti-sniping logic remain in place.
- A public-price transcript is **not** the private maximum ledger. A losing proxy's exhausted amount becomes a reached/public bid; an unspent winning maximum is never returned.
- `ir_bid_history` only returns approved/public auctions, bounded pages, reached prices, timestamps, event kinds, current public state and session-derived `is_mine`/`viewer_leading` booleans. It takes no bidder/profile argument. Revoked or suspended signed-in sessions are rejected. Guests receive no personalized labels.
- It deliberately uses a narrowly projected security-definer RPC; browser callers cannot access raw bidder IDs, names, emails, maximums, confidential reserves or legacy private bid events.

## Verification

- Production Next.js build/type check.
- `tests/bid-history.test.mjs`: actual rendered components, pagination/merge logic and deterministic subscription-hook tests (no live accounts, no browser automation).
- `tests/bid-history.sql`: migration and fixtures executed in a single rolled-back transaction against Supabase. Checks first bids, leading maximum increases, defending proxies, ties, lead changes, idempotency, rejected bids, anti-sniping, privacy, pagination, legacy snapshots and revoked/suspended sessions.
- Existing onboarding/email/HTTP checks are also run via `pnpm test`.
- Latest full run: 28 automated checks passed, plus `tests/bid-history.sql` and the existing `tests/launch-security.sql` regression suite in rolled-back transactions with the migration prepended.
- Verify rollback left no `84000000-*` fixture users/auctions and no live bid-chat table. No real bids or purchase commitments were made.
- No visual browser or multi-client network/load-testing sign-off is claimed.

## Publishing

1. Inspect remote migration history for `bid_chat_history`. Apply only this migration once. Older local migration timestamps differ from remote history; do not blindly push all migrations or repair history.
2. Re-run SQL tests against the applied schema without prepending the migration, retaining BEGIN/ROLLBACK. Run advisors against the applied migration.
3. Build/test, then commit and deploy through the existing GitHub/Vercel workflow. Verify production anonymous history and public catalogue.
4. With approved test participants, verify separate-account labels, immediate proxy outbids, mobile layout, keyboard navigation, scroll preservation and disconnect/reconnect recovery before real auction use. Do not place real bids for QA without explicit authority.

The current production advisors still report pre-existing guarded security-definer RPCs, legacy deny-all RLS tables, disabled leaked-password protection and unindexed foreign keys. The migration adds indexes for both of its foreign keys. The public history RPC is intentional; review the narrow return shape if the advisor flags it after publication.

References: [public security-definer functions](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection), [unindexed foreign keys](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys).

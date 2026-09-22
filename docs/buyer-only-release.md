# Buyer-only accounts and staff inventory

Release notes for 22 September 2026. Database and application updates must be published together in the order below; live status is recorded in Supabase migration history and Vercel.

## Scope

- Public signup, onboarding, confirmation emails and `/account` have one buyer journey. Legacy `active_account='seller'` and signup metadata do not switch the UI.
- Public sell CTAs, seller signup, account-type switching and seller inventory forms are removed. Buyer watchlist, bidding, orders, verification and security remain. The main `/account` page opens on My bids, sharing the same live bid activity, filters and private maximums as `/account/bids`; Watchlist remains a separate tab with direct links.
- `/admin` contains user management and team inventory: create, edit, upload photographs/private evidence and review listings. Only the existing verified, active `admin` role can perform listing writes; there is no new self-assignable staff role.
- Existing listing ownership, historical seller records, identity links, orders and audit records are retained. New inventory is owned internally by its creating administrator. This is not a legal ownership transfer or a change to payout configuration.
- Staff can edit existing inventory belonging to other accounts. Editing is locked by the database against concurrent bids and is prohibited after bidding starts or the auction closes. Saving returns it to review. Listing approval no longer requires the retired seller account status; suspension and explicit staff review still apply.
- Public seller signup/switch/feature RPCs are retired. Photo and listing-evidence registration requires staff access; buyers can still upload private identity documents.
- Terms version `2026-09-22.1` changes only the account-flow description. The previously accepted `2026-09-22` page and consent receipts remain unchanged; no acceptance is backfilled.

## Publishing order

1. Inspect remote migration history. Local and previously deployed migration timestamps differ; do not blindly `db push` or repair history.
2. Apply the pending `20260922122844_bid_chat_history.sql` if absent, then `20260922134003_buyer_only_staff_inventory.sql`. The latter preserves the new bid transcript while updating staff inventory eligibility.
3. Publish the application build with the new terms page. Deploy promptly after migration: old seller tabs intentionally lose write access, and an old onboarding form with the previous terms version must be refreshed.
4. Confirm a new buyer registration, an existing buyer with legacy seller selection, and staff create → photo/evidence upload → approval. No public seller tools should appear. Authorised team members use `/admin`.

The existing upload worker performs file/JWT validation and calls the replaced registration RPCs; no worker deployment is needed. No production auction is created or bid on for testing.

## Verification

`pnpm test` builds production and runs component/handler/HTTP tests, including buyer-only navigation and signup, legacy account handling, admin-link isolation, price validation, edit locks, automatic ID upload, terms and bid-chat regressions.

Run both pending migrations followed by `tests/buyer-only.sql` and `tests/bid-history.sql` **inside one outer BEGIN/ROLLBACK**, removing the test files' inner transaction statements. Fixtures use `85000000-*` / `84000000-*` UUIDs and `example.invalid` emails. Tests cover staff-only creation/editing/uploads, retained ownership, buyer ID/consent, retired seller APIs, staff approval, bidding on staff-managed inventory, and post-bid edit locks. Verify afterward that neither fixtures nor the pending bid-chat table remain.

No browser-driven visual QA was performed. Existing production security advisors are a baseline, not a sign-off on unapplied migrations or a full production security audit.

Verification results: production build and all 39 automated tests passed, including the account bids view, working filters, order navigation, live updates and session-change cleanup. The buyer-only SQL checks and full bid-history SQL regression suite also passed in a single rolled-back transaction.

Existing production advisor warnings remain: public/signed-in access to `SECURITY DEFINER` RPCs (these deliberately use internal session/role guards, which must continue to be reviewed), and disabled leaked-password protection. The migration retires the seller signup/switch/feature grants but does not otherwise reconfigure authentication. Guidance: [function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [public function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

# Onboarding uploads and terms — 22 September 2026

## Implementation

- File selection immediately uses the existing authenticated private-upload worker. Client validation, an in-flight lock, server acknowledgement, error/retry feedback and disabled continuation prevent selected-but-unsaved files being mistaken for saved documents. Existing account documents are reused after reopening onboarding.
- Removed “Maybe later” and the separate upload submission button. Staff approval remains separate.
- Replaced the age checkbox with explicit, initially unchecked terms acceptance. Age eligibility remains in the terms; the application does not silently turn an age declaration into consent.
- Added `/terms` and immutable version `/terms/2026-09-22`, linked from onboarding and the marketplace footer. Opens in a new tab during onboarding.
- New acceptance receipt records user identity from the verified, active session, buyer/seller account type, version, URL and server time. Clients cannot write, alter, delete or view another member’s receipts. Retry does not replace the first acceptance time. Upload and consent are required server-side for the verification step and setup completion.
- No existing member has been marked as accepting the new terms. Existing completed accounts, verification decisions, bids and orders are unchanged.

## Before live sales

1. Have a Maltese lawyer review the draft, including sale formation, trader disclosures, fees/taxes, deposit deadlines, delivery, cancellation/refund process and enforceable remedies. The requested 10% deposit/30-day schedule is a contractual proposal, not a conclusion that it is enforceable in every category.
2. Operator supplied: Luca Arrigo, Ogirra, Triq Il Kaffis, Swieqi. Obtain the support email, complete required business/contact disclosures, final privacy/retention notice and consumer withdrawal process before public onboarding. Do not invent a support address or publish an account email as one without confirmation.
3. Align actual order/payment handling with the terms before live sales. This change does **not** build deposit collection or balance reconciliation. The current account page says online collection is not enabled; the order schema defaults to a three-day payment deadline. Implement and test staged amounts, deadlines, reminders, receipts, failed payments, refunds and reconciliation; do not silently amend existing orders. Do not describe payments as escrow.
4. Property is a separate lawyer/notary-led flow. Adopt the timetable only in the relevant signed legal documents, not by pretending a web checkbox transfers title.
5. Existing completed members have no receipt for the new version. Require fresh consent before applying new terms to their future live bids; do not backfill consent.
6. Preserve accepted versions. If legal review changes this draft after anyone has accepted it, publish a new version and ask for fresh acceptance. Keep the version in `lib/terms.ts`, the immutable route, SQL and tests consistent.
7. Deploy the new migration and frontend together. Older clients can still save early drafts, but attempts to finish without current consent and identity evidence fail closed. Refresh older tabs. Apply pending directory migration as part of its own release requirements. Run the SQL tests inside a rolled-back transaction; they must not approve real users or place real bids.

## Verification

- Production build and 17 component/HTTP checks passed, including both public terms routes. Component-handler tests cover immediate upload, in-flight locking, failure/invalid-file behavior, saved evidence hydration, business requirements and unchecked/versioned consent. No signed-in browser or real-document upload test was performed.
- New consent SQL tests and updated account-role tests passed inside rolled-back transactions. Verified afterward that the migration and all test members were absent; no live accounts or approvals changed.
- Existing database advisor findings remain outside this change: [legacy deny-all RLS tables](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [public launch-status function](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [guarded authenticated functions](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), and [disabled leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Rerun advisors after deployment; this is not a security sign-off.

## Legal sources checked

- [MCCAA Consumer Rights Regulations](https://mccaa.org.mt/media/2708/37817__consumer_rights_regulations.pdf): mandatory consumer protections must not be waived by blanket deposit language.
- [European Commission consumer-rights guidance, section 1.9](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ%3AJOC_2021_525_R_0001): online-only auctions are not automatically the public-auction exception.
- [Notarial Council of Malta — Buying and Selling](https://www.notariesofmalta.org/buyingandselling.php): separate promise-of-sale and final-deed process for immovable property.

This is an implementation record and legal-review checklist, not a legal opinion or production security sign-off.

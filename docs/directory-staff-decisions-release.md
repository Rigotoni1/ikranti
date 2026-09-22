# User-directory staff decisions — September 2026 release

## Changes

- All users, Buyers and Sellers open the same user profile. Search by name/email, filter accounts needing review, and open Staff decisions directly from a directory row.
- A dedicated Staff decisions tab replaces the detached UUID/fingerprint forms. It supports buyer identity approval, seller approval, requests for changes, seller rejection, suspension and reinstatement.
- Approvals show email, setup, account and document prerequisites, relevant legal/business details, short-lived private document previews, and an explicit review confirmation.
- Staff choose whether this is a first verified identity or the same person as an existing verified account. The latter searches all verified accounts, not just the latest 200 directory rows. Internal fingerprints never appear in the form or response.
- Existing identity groups cannot be split by the new workflow. Linked seller/buyer self-bidding remains blocked. A matching name alone is not identity proof: staff must compare evidence.
- Each decision saves the staff actor, message, evidence reference and linking choice in the audit trail. Retries use a stable decision reference to avoid duplicate audit records and notifications.
- The user receives an account notification; email is queued through the existing delivery system (not a guarantee of inbox delivery). Latest decision and requests for buyer changes are visible in the directory; Activity contains history.
- Listing review and dispute tools are retained. The public header's pending Account-label fix is preserved.

## Deployment order

1. Apply `supabase/migrations/20260922112002_directory_staff_decisions.sql` through the existing Supabase deployment process. It is backward compatible with the deployed admin UI.
2. Deploy the application to Vercel. Until both steps are published, the new UI is not live.
3. Check the authenticated admin workflow using a dedicated test account: open an ID, request changes, approve a genuine reviewed identity, and verify updated directory/history. No real user is automatically approved by this release.

## Verification performed

- Production Next.js build and TypeScript checks passed.
- All 8 existing application HTTP checks passed against the local production build.
- `tests/directory-staff-decisions.sql` passed against the current Supabase schema with the new migration inside an explicitly rolled-back transaction. This covers non-admin/revoked sessions, anonymous function permissions, evidence ownership, email/setup gates, business evidence, changes requests, notification/audit deduplication, verified-account lookup, identity preservation, linked-account bidding and suspension/reinstatement.
- No signed-in browser interaction test or real identity review was performed. This is not a comprehensive security/load-test sign-off.
- Security advisors were reviewed against the deployed schema. Existing warnings include authenticated security-definer functions, intentionally public launch status, legacy deny-all RLS tables, and disabled leaked-password protection. The new functions explicitly revoke anonymous execution, use an empty search path and check verified active administrator sessions. Re-run advisors after applying the migration.

References for existing advisories: [function access](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

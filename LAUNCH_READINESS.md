# Irkanti launch-readiness handover

This is a **pre-launch implementation**, not authorization to open bidding. `ir_private.settings.trading_enabled` remains false. Shared demo identities are retired. Real accounts and auctions use separate `ir_*` tables; fictional legacy assets are not transferred into real customer accounts.

## Checklist

| Area | Implemented | Remaining launch acceptance |
| --- | --- | --- |
| Accounts | Supabase registration, email confirmation, recovery callback, refreshable secure session cookies, TOTP enrolment/challenge; administrator invitation is restricted to verified the designated owner's verified email with AAL2. | Configure Auth email/redirects and server-side password policy; complete inbox-based registration/recovery tests; owner accepts invitation. |
| Permissions | No caller-selected identity on real write RPCs. `auth.uid()` plus active/verified-user checks; RLS for private data; MFA checks on all staff reads/actions. Proxy maxima and exact reserves are absent from public realtime projection. | Independent security review before valuable assets trade. |
| Seller onboarding | Individual/business application, private evidence bucket, ownership plus category documents, mandatory staff review, account upload quotas. Direct JWT-authenticated uploads avoid Vercel's body limit. | Publish privacy/retention policy and support contact; train reviewers; use synthetic documents until then. No automated KYC provider is claimed. |
| Administration | Seller/listing approval/rejection, suspension/reinstatement, dispute review, immutable-to-members staff audit, bidding-risk queue and email queue counters. Admin records show the newest 200 entries per table. | Owner MFA setup; operational dispute/payment resolution process; expand moderation pagination as volume grows. |
| Live bidding | Supabase Realtime instead of ten-second polling, reconnect snapshot refresh, visibility/online recovery, direct transactional RPC, private maxima, equal-bid priority, two-minute extensions, retry UUID deduplication. | Multi-client load/concurrency tests at expected launch traffic and measured latency budget. Architecture removes the old Vercel → Edge → five-query bid round trip; no production latency SLA is claimed. |
| Auction completion | Minute-by-minute `pg_cron`, locked closing, sold/reserve-not-met/unsold outcomes, unique order per auction, suspended-participant hold, deduplicated outcome notifications. | Agree payment/transfer operations. No money is collected by this release. |
| Notifications | Transactional in-app outbox, bid/outbid/ending/winner/payment notices, Resend delivery worker, leased batches, retries/backoff, provider idempotency keys, failed queue visibility. | Verify Resend domain, configure secrets + Auth SMTP, test actual delivery and failure recovery. Provider acceptance is not proof of inbox delivery. |
| Abuse prevention | Database action limits, file MIME + signature + size checks, no direct client storage writes, upload quotas, self-bid/linked-identity rejection, verified identity required for bidders, high-frequency bid flags. | Review fingerprint consistency; configure Auth CAPTCHA/IP throttling and operational fraud review. Manual identity matching does not detect every colluding account. |

## Owner setup

1. In [Resend Domains](https://resend.com/domains), add `irkanti.com` and install **the exact DNS records Resend supplies** in Vercel DNS. Do not guess SPF/DKIM values or overwrite existing mail records. Verify the domain.
2. Create a sending API key in Resend. Store it as the Supabase Edge Function secret `RESEND_API_KEY`, and set `RESEND_FROM` to `Irkanti <notifications@irkanti.com>`. Do not put secrets in Git, chat, browser code or `NEXT_PUBLIC_*` variables.
3. Configure Supabase Auth custom SMTP using Resend's credentials. This is **separate** from the auction email worker. The [Resend–Supabase integration](https://supabase.com/partners/resend) can populate SMTP settings. See [Resend SMTP](https://resend.com/docs/send-with-smtp).
4. In [Supabase Auth URL configuration](https://supabase.com/dashboard/project/gjxpgqknuvryjzafbkrc/auth/url-configuration), use Site URL `https://irkanti.com`, and allow `https://irkanti.com/auth/confirm` and `https://irkanti.com/auth/confirm?recovery=1`. Keep email confirmation enabled. Enforce a minimum 12-character password in Auth settings (the form also requires 12). Review session expiry, CAPTCHA and password protections supported by the plan.
5. Standard Supabase confirmation templates with `{{ .ConfirmationURL }}` support the PKCE callback. Alternatively use token-hash links to `/auth/confirm?token_hash={{ .TokenHash }}&type=email` and the recovery equivalent `type=recovery`. Test links in the actual supported browser flow; tokens and codes must never be logged. [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls).
6. Register as the designated owner's verified email, verify email, open **Security**, enrol an authenticator, enter its code, then accept the administrator invitation. No administrator password or MFA seed is pre-created/shared.

## Operations and safeguards

- Jobs: `ir-auction-maintenance` and `ir-email-delivery`, every minute. Check `cron.job_run_details`; check `net._http_response.status_code` for the email HTTP result, not merely the SQL scheduling result. While unconfigured, the email worker deliberately returns 503 without consuming notification attempts.
- Delivery: batches of five, eight attempts maximum, exponential backoff. Retries stop 23 hours after first attempt to avoid replaying outside [Resend's 24-hour idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys). Investigate ambiguous/failed sends before manually requeuing; blindly requeuing could duplicate mail. In-app notifications remain available.
- The worker validates either a server-only Vault token (email job) or a freshly verified Supabase JWT (uploads). Its platform JWT gate is off because these two authentication paths are handled explicitly in the function.
- Private documents are downloaded through owner/admin RLS and 60-second signed attachment links. File signature checks are **not** malware scanning. Photos are public. Private documents are not.
- The manual identity fingerprint must be stable for the same person/entity across accounts, pseudonymous, and never a raw identity document number. An approved identity is required before any bid.
- Rate limits currently constrain successful bid/watch/onboarding transactions and upload attempts. Failed transactional RPCs roll back their counters. Use platform/IP limits and CAPTCHA to complement these limits against invalid-request floods before public launch.
- `SECURITY DEFINER` RPCs intentionally have carefully scoped authenticated execution and empty search paths. The public status RPC exposes only a boolean. The Supabase advisor flags these intended entry points: [authenticated RPC advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [public status advisory](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable). Legacy server-only demo tables intentionally have no RLS read policies: [RLS advisory](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- Do not enable trading until the acceptance items above and commercial/legal/payment arrangements are complete. Enabling is a privileged database operation, not an ordinary browser toggle.

## Verification

- `pnpm build` and `pnpm lint`.
- `node --test tests/deployment.test.mjs`: public catalogue, retired demo mutations, account page and unauthenticated/cross-origin upload rejection.
- Run `tests/launch-security.sql` and `tests/launch-abuse.sql` as database owner: fixtures and all test bids roll back. They test privacy, admin MFA, session identity, suspension, deduplication, proxy ties, closing outcomes, orders, linked accounts, watch limits, invitation checks and notification deduplication.
- `tests/browser-smoke.mjs`: desktop/mobile signup/recovery navigation, no overflow, no JS errors, retired shared-profile chooser. Set `PLAYWRIGHT_MODULE` if Playwright is supplied by an external runtime; uses a fresh Chrome profile.
- `tests/authenticated-smoke.mjs`: uses an explicitly provisioned disposable confirmed account; tests actual password login, TOTP, persistent session, sample onboarding and sign-out. Set `QA_EMAIL` and `QA_PASSWORD` securely; remove fixtures afterwards. This does not substitute for testing delivery of verification/recovery mail.

Production payment processing, legally reviewed auction terms, title transfer, automated identity verification, penetration testing and a load-test sign-off are not represented as completed by this checklist.

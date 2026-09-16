# Buyer and seller accounts

One verified login can hold two independently completed account profiles. Administrator permissions remain independent and still require MFA.

Signup requires a buyer/seller selection. The user-editable signup intent is only a navigation hint after email confirmation; it never grants permissions. Authenticated onboarding has four steps: personal/contact details, role-specific details, verification, review. Continue saves drafts privately in Supabase; account settings resumes unfinished setup or switches completed profiles.

Buyer completion unlocks browsing, watchlists and separate favourites. Bidding additionally retains the existing identity-link, auction, suspension and launch checks. Staff can review private identity evidence and use the MFA-protected buyer-verification action, which writes an audit event. Phone numbers are collected, not SMS-verified.

Seller completion requires private identity evidence and, for businesses, registration information/evidence. It submits a pending application; it does not grant seller approval. Approved sellers can submit inventory with the existing ownership/category evidence workflow and request editorial feature consideration. Requests appear on staff listing records; they do not automatically feature a listing.

## Release

Migration `supabase/migrations/20260916181835_account_role_onboarding.sql` was applied to production on 16 September 2026 before publishing the matching application. Existing users must complete the new flows; do not auto-approve them. Test fixtures are exercised in rolled-back transactions.

Tests: `tests/account-onboarding.sql`, `tests/launch-security.sql`, `tests/launch-abuse.sql`, `tests/session-attempt-security.sql`. Run with the migration available. Each test rolls back its fixtures.

Production email delivery, live payment processing, category eligibility and launch approval remain separate outstanding requirements. Do not enable trading merely because onboarding is complete. Actual inbox and browser journey verification is still required before public launch.

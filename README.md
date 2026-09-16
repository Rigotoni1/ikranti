# Irkanti

Brand: **Irkanti**. Intended custom domain: **irkanti.com** (DNS connection pending). Internal repository, project and database identifiers retain their original spelling for compatibility.

- Public demonstration: https://ikranti-six.vercel.app
- Source: https://github.com/Rigotoni1/ikranti

Malta-first marketplace for curated live auctions of property, motor cars, boats, watches, jewellery, art, antiques and collectables.

## Product capabilities

- Curated catalogue with category search and live countdowns
- Confidential maximum bids with automatic increments
- Reserve and no-reserve auctions
- Two-minute anti-sniping extensions
- Persistent watchlists, bid activity and seller inventory
- Populated buyer, collector and seller preview accounts
- Seller submission flow with image storage
- Category-aware fee estimates and verification states
- Responsive dark-and-gold brand system

The included identities and lots are fictional demonstration data. Before accepting real transactions, connect production identity verification, regulated marketplace payments, licensed auction operations and legal policies.

## Local development

Use the package scripts for development, validation and builds. The GitHub/Vercel version runs on native Next.js and proxies server-side marketplace requests to the `ikranti-marketplace` Supabase Edge Function. Structured auction state is stored in Supabase Postgres, while submitted listing images are stored in a public Supabase Storage bucket.

Copy `.env.example` to `.env.local` and provide the project URL plus a random 32-byte gateway secret. Store only its SHA-256 digest in `ikranti_config` under `gateway_sha256`. The Edge Function verifies this digest; the secret stays in Vercel's encrypted environment variables. Never expose it with a `NEXT_PUBLIC_` prefix.

The Supabase project is `gjxpgqknuvryjzafbkrc` in Frankfurt. Apply the SQL in `supabase/migrations` and deploy `supabase/functions/ikranti-marketplace/index.ts`. The function uses custom gateway authentication, so its Supabase JWT gate is disabled. All marketplace tables have RLS enabled and no browser grants; only the server service role can read or modify them. Supabase's informational “RLS Enabled No Policy” advisory is intentional for these server-only tables.

Run `pnpm test` for a production build and HTTP integration checks. `tests/bidding.sql` verifies proxy bidding, ties, minimums, anti-sniping, ownership, expiry and watchlists inside a transaction that is rolled back. GitHub pushes deploy the Next.js app through Vercel; Edge Function and schema updates are deployed separately.

The API allows extra time for Supabase cold starts, logs timings without secrets or bid amounts, and never automatically retries mutations. When a mutation times out, check account activity before resubmitting: the database may already have committed it. `TEST_BASE_URL=https://ikranti-six.vercel.app node --test tests/deployment.test.mjs` runs the HTTP checks against the deployment.

## Release status

This release is a working **demonstration**, with shared buyer and seller profiles and fictional inventory. It does not authenticate real customers, verify identities, take payments, transfer property, or create binding sales. Before inviting real bids, replace preview identities with individual authenticated accounts and complete payment, verification, moderation and legal workflows.

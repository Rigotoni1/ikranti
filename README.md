# Irkanti

Malta-focused auctions for property, cars, boats, luxury goods, art and collectables. Dark-and-gold Next.js marketplace with Supabase Auth, Postgres, Realtime and Storage.

- Website: https://irkanti.com
- Account portal: https://irkanti.com/account
- Source: https://github.com/Rigotoni1/ikranti
- Internal project identifiers retain the historic `ikranti` spelling for compatibility.

## Release status

Pre-launch access. Real bidding is deliberately disabled in the database. The homepage can display fictional sample assets when no real auctions have been approved. Shared demo sign-in and mutation endpoints are retired.

See [LAUNCH_READINESS.md](LAUNCH_READINESS.md) for the eight-area implementation checklist, verification evidence, Resend/Auth configuration, administrator activation and outstanding launch acceptance criteria. This is not a claim that payments, legal operations or an independent security review are complete.

## Architecture

- Native Next.js 16 / React 19 deployed to Vercel.
- Individual Supabase email/password accounts with confirmation, recovery, session refresh and TOTP. Staff access requires AAL2.
- Real `ir_*` tables are isolated from historic fictional demonstration tables.
- Narrow authenticated database RPCs derive identity from `auth.uid()`; RLS protects all private reads. Direct client table writes are not granted.
- Confidential proxy bidding uses row locks, idempotency IDs, reserve outcomes and two-minute extensions.
- Only sanitized auction projections and users' own notifications are published through Realtime.
- Private identity/ownership documents go through a JWT-authenticated worker with content/size/quota checks; public listing photos use a separate bucket.
- Minute-by-minute database closing job and unique-per-auction orders.
- Transactional notification outbox and a separately configured Resend worker. Authentication email requires Supabase SMTP setup too.

## Development and deployment

Use Node 24 and pnpm. Copy `.env.example` to `.env.local` and configure the project. Publishable keys are public; service credentials and Resend keys must never be committed or exposed through `NEXT_PUBLIC_*`.

```sh
pnpm install
pnpm dev
pnpm lint
pnpm test
```

Apply migrations in filename order. Deploy `supabase/functions/ir-launch-worker/index.ts` to project `gjxpgqknuvryjzafbkrc`. The worker implements its own JWT verification for uploads and a Vault-held server credential for scheduled delivery. Keep its platform JWT gate disabled for those explicit authentication paths. The legacy `ikranti-marketplace` worker is retained solely for sample-catalogue compatibility; its gateway secret is server-only.

GitHub pushes deploy Next.js through Vercel. Schema and Edge Function releases are separate. SQL security tests roll their fixtures back. Browser tests use fresh isolated Chrome contexts. Refer to the launch handover for test commands and operational safeguards.

Do not enable trading until owner setup, email delivery, security/load testing and the business launch requirements have been signed off.

# Dashboard workflow release

The dashboard workflow migration was applied to production on 21 September 2026,
before the frontend release. The workflow tests passed again after migration,
and every existing favourite was confirmed present in Watchlist.

- Merge existing favourites into watchlist without deleting saved records.
- Retain the old favourite RPC as a compatibility wrapper around watchlist.
- Add changes_requested and permit owner edits back to under_review.
- Send listing review notes to the seller's existing notification queue.
- Provide admin-guarded user directory and unified profile detail RPCs.

Run `tests/dashboard-workflows.sql` after migration; it creates fixtures and
rolls them back. It checks role/status separation, member denial, private
submissions, review messages and resubmission.

Verification: production build, focused ESLint and eight HTTP regression tests.
No signed-in browser interaction or mobile visual QA was performed.

Existing database advisories include intentional guarded SECURITY DEFINER
entrypoints, closed legacy tables, and disabled leaked-password protection.
These are not a production-security sign-off:
[function access advisory](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Photo Replace/Remove controls apply to the file selected for upload; uploading
a new listing photograph replaces its current photograph. Listings with
changes requested must first be edited/resubmitted before attaching replacement
photographs under the existing private upload policy.

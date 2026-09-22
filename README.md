# VIP Invoice Admin

Independent Supabase-backed invoice administration for VIP Transfers Korea. The former Firestore implementation is preserved in `legacy-index.html` and the source data backup is under `backups/firestore-2026-08-28/`. The backup directory is intentionally gitignored because it contains private customer and financial data.

## What is included

- Supabase email/password authentication
- Organization and role-based RLS (`admin`, `accounting`, `operations`)
- Dashboard with currency-separated outstanding totals
- Draft creation and continuation
- Transaction-safe invoice numbering when a draft is issued
- Invoice items, payment ledger, balances and overdue calculation
- Korean-capable PDF preview/download using the existing embedded fonts
- Responsive desktop/mobile interface
- Firestore raw backup, normalized backup, checksums and migration importer

## Setup

1. Create a Supabase project and disable public signup in Auth settings.
2. Run `supabase/migrations/20260828000000_invoice_admin.sql` in the SQL editor or through your migration workflow.
3. Create the first staff user in Supabase Auth and copy their UUID.
4. Copy `.env.example` to `.env` and add the project URL and **publishable** key. Never use the service-role key in `VITE_*` variables.
5. Install and start:

```bash
npm install
npm run dev
```

## Import existing Firestore data

The raw backup was captured on 2026-08-28. Verify it before import:

```bash
shasum -a 256 backups/firestore-2026-08-28/*.firestore.json
npm run backup:normalize
```

Run a dry run first. Keep the service-role key only in your terminal/server environment:

```bash
SUPABASE_URL='https://PROJECT.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='SERVICE_ROLE_KEY' \
SUPABASE_USER_ID='AUTH_USER_UUID' \
node scripts/import-to-supabase.mjs
```

If validation passes, repeat with `--commit`. The importer creates the organization and admin membership when `SUPABASE_ORGANIZATION_ID` is omitted, and prints the new organization UUID. For repeat imports, pass that UUID explicitly.

```bash
SUPABASE_URL='https://PROJECT.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='SERVICE_ROLE_KEY' \
SUPABASE_USER_ID='AUTH_USER_UUID' \
node scripts/import-to-supabase.mjs --commit
```

After migration, compare invoice counts and totals with `backups/firestore-2026-08-28/backup-report.json`. Keep Firestore read-only until verification is complete.

## Deployment

Build with `npm run build` and deploy `dist/`. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the deployment environment. Add the deployment URL to Supabase Auth URL Configuration.

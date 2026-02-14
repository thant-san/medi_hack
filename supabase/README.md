# Supabase Setup

## 1) Run schema + seed

In Supabase SQL editor, execute:

1. `schema.sql`
2. `seed.sql`

## 2) Realtime

`schema.sql` adds `queue_entries` and `notifications` to `supabase_realtime` publication.

## 3) Ingest Excel subset

```bash
cd supabase/ingest
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set SUPABASE_URL=...
set SUPABASE_SERVICE_ROLE_KEY=...
python import_excel.py --file "C:\path\to\screening.xlsx" --limit 1000
```

Expected: upserted patients + inserted screening records with `source='import'`.

# Patient Flow Analytics (Hackathon)

Monorepo with React web app, Supabase backend schema, and Python AI service.

## Project structure

- `web/` React + Vite + TypeScript + Tailwind
- `ai/` FastAPI (`/predict-wait`, `/daily-insights`)
- `supabase/` SQL schema, seed data, Excel ingestion script

## 1) Supabase setup

1. Create a Supabase project.
2. In SQL Editor run:
   - `supabase/schema.sql`
   - `supabase/seed.sql`
3. Enable Email/Password auth (or your preferred provider).
4. (Optional) Create `profiles` rows mapping auth users to role and patient_id/doctor_id.

## 2) Import screening dataset subset (>=1000 rows)

```bash
cd supabase/ingest
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
set SUPABASE_URL=YOUR_SUPABASE_URL
set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
python import_excel.py --file "C:\path\to\screening.xlsx" --limit 1000
```

Mapped fields: `hnx, modify_time, spid, weight, height, bmi, sbp, dbp, chief_complaint, illness_detail`.

## 3) Run AI service

```bash
cd ai
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# fill SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 4) Run web app

```bash
cd web
copy .env.example .env
# fill VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / VITE_AI_BASE_URL
npm install
npm run dev
```

## Demo mode

- Landing page includes **Demo Mode** toggle.
- In demo mode, role access is gated in frontend by quick role switch.
- For doctor queue actions, set `VITE_DEMO_DOCTOR_ID` to one seeded doctor UUID.

## 2-minute demo script

1. **Landing**: choose Patient role and enter.
2. **Patient Flow**:
   - Choose `I have HN` and search existing HN.
   - Click `Yes, quick follow-up` to auto route and join queue.
   - Or choose `No` and submit screening to create appointment + queue.
3. **Doctor Dashboard**:
   - Switch role to Doctor.
   - Paste doctor UUID.
   - Click `Call Next`; patient receives notification in realtime.
4. **Admin Dashboard**:
   - Switch role to Admin.
   - Refresh KPI, view queue chart.
   - Search patient by HN.
   - Click `Generate AI Summary` for multi-paragraph executive insight + action bullets.

## Screenshots checklist

- [ ] Landing (role + demo toggle)
- [ ] Patient HN search + same-problem prompt
- [ ] Screening form + queue join confirmation
- [ ] Patient dashboard (queue/prediction/notifications)
- [ ] Doctor queue realtime + Call Next
- [ ] Admin KPIs + chart + patient search
- [ ] AI Daily Executive Summary output

## Implementation checklist status

- [x] Vite React app boots, Tailwind works
- [x] Supabase connected schema/migrations provided
- [x] Ingest script supports importing at least 1k rows
- [x] Patient can search HN and see latest screening
- [x] Patient can create appointment and join queue
- [x] Doctor sees queue and can call next
- [x] Patient receives near-turn/called notifications (realtime subscription)
- [x] AI predicted wait time displayed
- [x] Admin dashboard shows queue stats by doctor/SPID
- [x] AI daily insight generator returns multi-paragraph summary + actions

## Notes

- RLS policies are included in `supabase/schema.sql` using `profiles` role mapping.
- For fastest hackathon demo, keep role switching via landing page while gradually enforcing full auth UI.

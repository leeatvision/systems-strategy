# Systems Strategy

A business-planning app: Goals, To-Dos, Issues, Headlines, Key Numbers, Weekly Meetings, Vision and Plan, Org Chart, processes and checkups. A mobile-first PWA on Supabase that works offline and sends push notifications.

- [docs/api.md](docs/api.md): how the app talks to its server: sign-in, tables, database functions, files, live updates, calendar feed and push
- `supabase/migrations/`: database definitions
- `supabase/functions/`: PIN sign-in (`pin-auth`), calendar feed and push sender

## Branding

The app's name, logo, icons, brand colours and Supabase address come from a brand folder, not from this repo.
`scripts/brand.mjs` runs before every dev run and build: it uses `brand/` if present, otherwise the neutral placeholders in `brand-default/`.
A brand folder has the same layout as `brand-default/` (`brand.json`, `brand.css`, `icons/`).

## Running it

```bash
npm install
npm run dev      # local preview at http://localhost:5173
npm run build    # production build into dist/
```

Pushing to `main` publishes to GitHub Pages (see `.github/workflows/deploy.yml`). The workflow checks out this app's folder (`BRAND_PATH` repository variable) from the private repo named in `BRAND_REPO`, using the `BRAND_TOKEN` secret.

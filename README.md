# Executive Dashboard (Vercel + GitHub + ADO)

## What's included
- `index.html` dashboard
- Vercel API routes:
  - `POST /api/ado` Azure DevOps WIQL proxy (PAT)
  - `/api/state` GitHub-backed state storage (GET/POST/DELETE)

## Vercel Environment Variables
Set these in Vercel Project Settings → Environment Variables:

### Azure DevOps
- `ADO_PAT` (recommended)

### GitHub (state API)
- `GITHUB_TOKEN`
- `GITHUB_OWNER`
- `GITHUB_REPO`
- `GITHUB_BRANCH` (optional, default main)

## Run locally
```bash
npm install
npm run dev
```


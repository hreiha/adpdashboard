# ADP dashboards

Two dashboards fed by one scheduled pull from the Employment Hero API.

| Path | Dashboard | Password |
| --- | --- | --- |
| `/` | **ADP Dashboard**: headcount, age, tenure, breakdowns. No turnover. | `TEAM_USER` / `TEAM_PASS` |
| `/pc` | People & Culture: headcount, turnover, recruitment, pay gap | `DASH_USER` / `DASH_PASS` |

The P&C credentials also open `/`. The ADP credentials never open `/pc` or `/data.json`,
which is the point: the ADP Dashboard password can be handed out widely without exposing
turnover, leaver names or pay. `/pc` is not linked from anywhere.

## How it works

```
GitHub Actions, 6am Brisbane daily
  └─ scripts/refresh.mjs
       ├─ Employment Hero API, both organisations
       ├─ scripts/metrics.mjs   → data.json   (P&C)
       └─ scripts/team-metrics.mjs → team.json (Bids & IT)
  └─ commits both files
       └─ Vercel redeploys on the push
            └─ api/index.js serves either page behind basic auth

Power Automate, separately
  └─ SharePoint Recruitment Forecast list → recruitment.json → GitHub
```

Both dashboards decide who counts using the same `scopeEmployees` function in
`scripts/metrics.mjs`, so their headcounts cannot disagree.

## Files

| File | What it is |
| --- | --- |
| `.github/workflows/refresh.yml` | the daily job |
| `api/index.js` | Vercel function, routing and basic auth for both pages |
| `scripts/refresh.mjs` | talks to Employment Hero, maps the fields, writes both data files |
| `scripts/metrics.mjs` | scoping, headcount, turnover, pay gap, filter slices |
| `scripts/team-metrics.mjs` | position grade and discipline, age, tenure |
| `scripts/inspect.mjs` | one-off field inspection, run by hand when a field moves |
| `views/index.html` | the P&C page, served at `/pc` |
| `views/team.html` | the ADP Dashboard, served at `/` |
| `tools/Get-EmploymentHeroToken.ps1` | gets the refresh token, run locally |
| `tools/Get-PayGap.ps1` | pay gap from a CSV export, run locally and commit `paygap.json` |
| `data.json` | P&C figures, rewritten by each run |
| `team.json` | Bids & IT figures, rewritten by each run |
| `recruitment.json` | written by the Power Automate flow |

## Setup

GitHub repository secrets: `EH_CLIENT_ID`, `EH_CLIENT_SECRET`, `EH_REFRESH_TOKEN`,
`EH_ORG_ID_AU`, `EH_ORG_ID_UK`.

Optional repository variable: `INCLUDE_NAMES` set to `true` writes starter and leaver
names into `data.json`. Only set it while the dashboard password is on.

Vercel environment variables: `DASH_USER`, `DASH_PASS`, `TEAM_USER`, `TEAM_PASS`.
Framework preset Other, no build command. Redeploy after changing any of them.

`/healthz` reports whether each password pair is configured, without revealing values.

See `ADP-DASHBOARD.md` for the ADP Dashboard and `RECRUITMENT-FLOW.md` for the
Power Automate flow.

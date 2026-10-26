# ADP Dashboard

The front page of this deployment, at `/`. Headcount and a few people metrics, for the
Bids and IT team and anyone else who needs the shape of the business without the
sensitive parts.

**No turnover, no leaver names, no pay, no recruitment.** Those live on the P&C dashboard
at `/pc`, behind a different password.

## What is on it

**Headline** — total headcount with the ADP Australia and ADP London split, and a
twenty four month trend.

**People metrics** — average age, average tenure, median tenure, female representation.

**Headcount by** — location, gender, cost centre, position grade, discipline.

**Filters, top right** — cost centre (tick as many as you like), gender, and the month
the headcount is taken at.

## Position grade and discipline

Both are **read out of the job title**, in `scripts/team-metrics.mjs`.

They are custom fields in Employment Hero, which means they are not in the employee
payload and have to be fetched per person from the custom field endpoints. That proved
unreliable: a fifth of the requests failed on rate limits, and the values that did come
back were empty. The custom field code is still in `scripts/refresh.mjs` but switched off
behind `USE_CUSTOM_FIELDS = false`, so it can be turned back on if the API behaves.

Titles are written `<grade> I <discipline>` — the separator is a lone capital **I**, not a
pipe. Grade comes from the left side, discipline from the right, falling back to the left
side for titles like `BIM Lead I QLD`.

On the October 2026 export, against 295 people in scope:

| | Resolved | Unknown |
| --- | --- | --- |
| Position grade | 99.7% | 1 |
| Discipline | 88.5% | 34 |

The 34 are titles that carry no discipline at all: *Engineering Assistant* (14), a bare
*Director* (8), no job title recorded (7), and a handful of administrator and intern
titles. They show as **Unknown** rather than being guessed at, and Unknown always sorts to
the bottom of a breakdown so it never reads as a real category.

A BIM person titled `BIM Designer I Mechanical` counts as **Mechanical**, because the
right side of the title is their discipline and BIM is their grade. Only a BIM title with
no discipline after the separator lands on the BIM row.

Each refresh prints how many people fell through to Unknown. If that number climbs, a new
grade or discipline has been introduced and the lists in `team-metrics.mjs` need the new
value adding.

## The date filter is a snapshot, not a range

Headcount is a number at a point in time, so a from-and-to range has no meaning for it.
The filter picks which month end the headcount, age, tenure and every breakdown are taken
at. The P&C dashboard keeps its range filter, because turnover genuinely spans a period.

## Average age

Drawn from whoever has a date of birth recorded. The tile says how many people that is
out of the selection, so a sparse field reads as partial rather than looking authoritative.
Placeholder dates such as 01/01/1911 are discarded.

## Who is counted

The same people as the P&C dashboard. Both pages call `scopeEmployees` in
`scripts/metrics.mjs`, so the two cannot drift apart. Excluded from both: blank locations,
locations inconsistent with the entity, independent contractors, records with no
employment type, records with no cost centre. People who have not started yet are in
scope but not counted until their start date passes.

## Setup

Vercel environment variables:

| Variable | What it does |
| --- | --- |
| `TEAM_USER` | username for `/` |
| `TEAM_PASS` | password for `/` |

Until both are set the site runs open with an orange banner. The page carries full
headcount and demographics, so set them before sharing the link.

`DASH_USER` and `DASH_PASS` open `/` as well, so whoever runs the P&C dashboard does not
need a second login.

`/healthz` reports whether each pair is configured, without revealing the values.

## What is in team.json

One row per person, with no name, no salary and no full date of birth. Year and month of
birth only, which is enough for an average age. Each row carries entity, office, cost
centre, gender, grade, discipline, start date, termination date and employment status.

Rows rather than aggregates, because the breakdowns multiply out to far more combinations
than are worth precomputing, and because filtering the rows gives an exact answer for any
combination instead of an approximate one. Around 100KB, served only behind the password.

The copy in this repo is a placeholder until the refresh workflow runs, at which point it
is rebuilt from Employment Hero and committed on every run that changes the figures.

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

Both are read from the Employment Hero fields of the same name. On the October 2026
export those were populated on 98% of active records.

Where a record has neither, the grade and discipline are read out of the job title as a
fallback, on the `Grade | Discipline` pattern. A record with no job title either shows as
*Not recorded* rather than being guessed at.

Each refresh prints the coverage of both fields. If it drops, the fallback is doing more
work than it should and the records need fixing in Employment Hero rather than in code.

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

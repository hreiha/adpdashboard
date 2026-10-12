# Bids & IT dashboard

A second, simpler dashboard at `/team`, fed by the same Employment Hero pull as the P&C
dashboard but with its own data file, its own login, and its own page.

It shows headcount and a few people metrics. No turnover, no pay gap, no recruitment,
no leaver names.

## What is on it

**Headline** — total headcount with the ADP Australia and ADP London split, and a
twenty four month trend.

**People metrics** — average age, average tenure, median tenure, female representation.

**Headcount by** — location, gender, cost centre, position grade, discipline.

**Filters, top right** — cost centre (tick as many as you like), gender, and the month
the headcount is taken at.

## Three things worth knowing

**Position grade and discipline are not Employment Hero fields.** Neither exists on the
employee record. Both are read out of the job title, which at ADP is written
`Grade | Discipline`, for example `Senior Engineer | Mechanical`.

A title with no pipe gets a grade but no discipline, and shows as *Not recorded* in the
discipline chart. A title whose grade matches nothing in the list shows as *Other*
rather than being guessed at.

Each refresh prints any job title that matched no grade. When you see one, add the
missing grade to `POSITION_GRADES` at the top of `scripts/team-metrics.mjs`. Longest
match wins, so `Associate Director` beats both `Associate` and `Director`, and the
order you add them in does not matter.

Matching is on substrings, so `Senior Talent Advisor` lands on `Advisor`, not
`Senior Advisor`. If that is wrong for your grade structure, add the full title to the
list and it will win on length.

**The date filter is a snapshot, not a range.** Headcount is a number at a point in
time, so a from-and-to range has no meaning for it the way it does for turnover. The
filter picks which month end the headcount, age, tenure and every breakdown are taken
at. The P&C dashboard keeps its range filter, because turnover genuinely spans a period.

**Average age is drawn from whoever has a date of birth.** The tile says how many
people that is out of the selection. If date of birth is sparse in Employment Hero, the
average is still the average of a subset, and the page says so rather than implying it
covers everyone.

## Who is counted

Exactly the same people as the P&C dashboard. Both pages call `scopeEmployees` in
`scripts/metrics.mjs`, so the two cannot drift apart. Excluded from both: blank
locations, locations inconsistent with the entity, independent contractors, records with
no employment type, records with no cost centre. People who have not started yet are in
scope but not counted until their start date passes.

## Setup

### 1. Vercel environment variables

| Variable | What it does |
| --- | --- |
| `TEAM_USER` | username for `/team` |
| `TEAM_PASS` | password for `/team` |

The P&C credentials (`DASH_USER` and `DASH_PASS`) also open `/team`, so you do not need
a second login yourself. It does not work the other way round: the team credentials
never open the P&C dashboard.

If neither pair is set the site runs open with an orange banner, same as before.

`/healthz` reports whether each pair is configured, without revealing the values.

### 2. GitHub Actions

`scripts/refresh.mjs` now writes `team.json` as well as `data.json`. The workflow needs
to commit both, so in `.github/workflows/refresh.yml` replace the commit step with this:

```yaml
      - name: Commit if the figures changed
        run: |
          if git diff --quiet -- data.json team.json; then
            echo "No change in the figures, nothing to commit."
            exit 0
          fi

          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add data.json team.json
          git commit -m "Dashboard refresh $(date -u '+%Y-%m-%d %H:%M UTC')"

          # Reset and reapply rather than rebase, so a simultaneous commit from the
          # recruitment flow cannot leave the run in a conflicted state
          git fetch origin main
          git reset --soft origin/main
          git add data.json team.json
          git commit -m "Dashboard refresh $(date -u '+%Y-%m-%d %H:%M UTC')" || true
          git push origin HEAD:main
```

Nothing else in the workflow changes. No new secrets, no second API call: `team.json` is
built from the records already pulled for `data.json`.

### 3. First run

`team.json` is committed with sample figures so the page works the moment it deploys.
The first scheduled refresh replaces them. Until it does, the footer says the figures
are samples.

## What is in team.json

One row per person, with no name, no salary and no full date of birth. Year and month of
birth only, which is enough for an average age. Each row carries entity, office,
cost centre, gender, grade, discipline, start date, termination date and employment status.

Rows rather than aggregates, because the breakdowns multiply out to far more
combinations than are worth precomputing, and because filtering the rows gives an exact
answer for any combination instead of an approximate one. The file is around 100KB and
is served only behind the password.

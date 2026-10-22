# Connecting the Recruitment Forecast list

The list lives in SharePoint, and GitHub Actions cannot reach SharePoint without an Azure app
registration and tenant admin consent. A small Power Automate flow is far less work and it is
the one part of this build where Power Automate is the right tool, because it already has the
SharePoint connector.

Six actions. It writes `recruitment.json` to the repo, the same file the refresh script already
reads. Nothing else changes.

---

## Before you start

- A fine-grained GitHub personal access token scoped to `pc-dashboard` only, with
  **Contents: Read and write**
- The internal column names for Role Status, Stage and Cost Centre. Build as far as action 2,
  run it, and read them out of the raw output. Choice columns need `?['Value']` on the end, so
  a cost centre reads as `item()?['Cost_x0020_Centre']?['Value']`

Build the flow inside a solution so it can use environment variables. If you would rather not,
paste the values in directly and skip the `parameters()` calls.

---

## 1. Recurrence

New scheduled cloud flow, `Recruitment forecast to dashboard`.

- Frequency **Day**, interval **1**
- Time zone **(UTC+10:00) Brisbane**, at hour **5**

Run it an hour before the GitHub refresh at 6am so the figures are fresh when the dashboard
rebuilds.

## 2. Get items → rename `Get_RF_items`

**SharePoint → Get items**

- Site Address: the site holding the list
- List Name: `Recruitment Forecast`
- Top Count: `5000`
- Three dots → Settings → Pagination **On**, Threshold `5000`

Leave Filter Query empty. Filtering in the flow is easier to debug than OData.

## Telling the two actions apart

The error `The evaluation of 'query' action 'where' expression ... failed` always comes from a
**Filter array**, because `where` only exists there. If an action you named `Select_something`
produces it, the action is the wrong type. In the designer:

- **Filter array** shows From plus an **Edit in advanced mode** link
- **Select** shows From plus a **Map** box with two columns and a small **T** icon on the right

`field_1` appearing in an expression means a Select was left in key-value mode. Click the **T**
icon so the Map becomes one full-width field.

## 3. Filter array → rename `Filter_open_roles`

**Data Operation → Filter array**

- From: click the field, go to the **fx** tab, and paste this. Do not pick `value` from the
  dynamic content list.

```
body('Get_RF_items')?['value']
```

This matters. Choosing `value` from dynamic content makes Power Automate wrap the action in an
Apply to each, so the filter runs once per row and returns an array of arrays. Everything
downstream then fails with a message about array elements needing an integer index. If you
already have a stray **For each** around this action, delete it and set From with the
expression above.

- **Edit in advanced mode**:

```
@not(equals(item()?['<RoleStatus>']?['Value'], '5. Role Withdrawn'))
```

Substitute your internal column name. The value has to match exactly, number prefix included,
so `5. Role Withdrawn` not `Role Withdrawn`.

## 4. Select → rename `Select_stages`

**Data Operation → Select**

- From (fx): `body('Filter_open_roles')`
- Click the **T** icon on the right of the Map box to switch it to text mode, then (fx):

```
item()?['<RoleStatus>']?['Value']
```

The T icon matters. In key-value mode the output comes back with keys called `field_1` and the
next action cannot read it.

## 4b. Select → rename `Select_cost_centres`

Cost Centre is a **multi-select** choice column, so it comes back as an array of objects rather
than a single one. `item()?['<CostCentre>']?['Value']` fails on it with a message about array
elements needing an integer index. Index into it instead:

- From (fx): `body('Filter_open_roles')`
- Map in text mode (fx):

```
coalesce(item()?['<CostCentre>']?[0]?['Value'], 'Unassigned')
```

That takes the first cost centre on each role, which is enough to build the list of distinct
values. Counting handles the rest of them in step 6.

## 5. Compose → rename `Distinct_stages` and `Distinct_cost_centres`

Two Compose actions. Inputs (fx):

```
union(body('Select_stages'), body('Select_stages'))
```

```
union(body('Select_cost_centres'), body('Select_cost_centres'))
```

Union against itself is how you deduplicate in Power Automate.

## 5b. Count the roles at each stage

**Initialize variable** `Pipeline`, type Array, value `[]`, at the top level of the flow.

**Apply to each** → rename `For_each_stage`, over (fx) `outputs('Distinct_stages')`.
Settings → Concurrency Control **On**, Degree of Parallelism `1`.

Inside it, **Filter array** → rename `Filter_stage_roles`, From (fx) `body('Filter_open_roles')`,
advanced mode:

```
@equals(item()?['<RoleStatus>']?['Value'], items('For_each_stage'))
```

Then **Append to array variable** → `Pipeline`, value (fx):

```
json(concat('{"stage":"', items('For_each_stage'), '","count":', string(length(body('Filter_stage_roles'))), '}'))
```

This gives a count for every stage, so Search & Secure, Search & Prepare and Role On Hold all
come through without naming them anywhere in the flow. The dashboard picks out the three it
reports on and ignores the number prefixes.

## 6. Build the counts

**Initialize variable** `CostCentres`, type Array, value `[]`. This has to sit at the top level
of the flow, above the loop, because Power Automate will not initialise a variable inside one.

**Apply to each** → rename `For_each_cc`, over (fx) `outputs('Distinct_cost_centres')`.
Settings → Concurrency Control **On**, Degree of Parallelism `1`. Without this the appends run
in parallel and silently lose entries.

Inside it:

**Filter array** → rename `Filter_cc_roles`, From (fx) `body('Filter_open_roles')`, advanced mode:

```
@contains(string(item()?['<CostCentre>']), items('For_each_cc'))
```

`string()` turns the multi-select array into JSON text and `contains` searches inside it, so a
role tagged to three cost centres is counted in all three. That means the cost centre counts add
up to more than `openRoles`, which is the right behaviour for a dashboard but does mean the
column will not reconcile to the total.

**Append to array variable** → `CostCentres`, value (fx):

```
json(concat('{"code":"', items('For_each_cc'), '","openRoles":', string(length(body('Filter_cc_roles'))), '}'))
```

## 7. Compose → rename `Recruitment_JSON`

From here to the end, every action sits **after** `For_each_cc`, at the top level of the flow,
not inside the loop. Inside the loop they run once per cost centre and commit a half-built file
each time.

Paste as plain text, not as an expression:

```json
{
  "recruitment": {
    "openRoles": @{length(body('Filter_open_roles'))},
    "filledMonth": 0,
    "avgDaysOpen": "0.0",
    "avgDaysToHire": "0.0"
  },
  "pipeline": @{variables('Pipeline')},
  "costCentres": @{variables('CostCentres')}
}
```

`pipeline` and `costCentres` have no quotes around them. They are already arrays, and quoting
them makes them strings the dashboard cannot read.

## 8. HTTP → rename `Get_current_file`

- Method `GET`
- URI: `https://api.github.com/repos/hreiha/pc-dashboard/contents/recruitment.json`
- Headers:

| Key | Value |
| --- | --- |
| `Authorization` | `Bearer YOUR_GITHUB_PAT` |
| `Accept` | `application/vnd.github+json` |
| `X-GitHub-Api-Version` | `2022-11-28` |
| `User-Agent` | `adp-pc-dashboard` |

## 9. HTTP → rename `Commit_recruitment_json`

- Method `PUT`, same URI and headers
- Body (plain text):

```json
{
  "message": "Recruitment forecast @{formatDateTime(utcNow(), 'yyyy-MM-dd HH:mm')} UTC",
  "content": "@{base64(string(outputs('Recruitment_JSON')))}",
  "sha": "@{body('Get_current_file')?['sha']}",
  "branch": "main"
}
```

The `sha` is what makes this an update rather than a rejected create, which is why the GET has
to run immediately before the PUT.

## 10. Send an email (V2) → rename `Notify_failure`

To yourself. Three dots → **Configure run after** → untick *is successful*, tick *has failed*
and *has timed out*.

---

## Testing

Run the flow. It should commit `recruitment.json`, which triggers a Vercel deploy. Open roles
appear on the dashboard within a couple of minutes.

Check the open role count against the list itself before trusting it. A mistyped column name in
a Filter array returns every row rather than an error, so a wrong count is the failure mode, not
a red cross.

## Adding the rest later

`filledMonth`, `avgDaysOpen` and `avgDaysToHire` are stubbed at zero. Each needs its own loop to
sum the calculated Days Posted and Days to Hire columns, since Power Automate has no `sum()`.
Get open roles working first. The dashboard renders a zero without complaint, so there is no
rush.

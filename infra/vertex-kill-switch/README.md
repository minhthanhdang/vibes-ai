# Vertex AI billing kill switch

Disables `aiplatform.googleapis.com` in `mtd-hackathons` when Vertex AI spend reaches the monthly budget. The rest of the project keeps running.

## Flow

Budget `vertex-ai-kill-switch` (A$50/month, scoped to this project + Vertex AI service only)
→ Pub/Sub topic `vertex-budget-kill`
→ Cloud Function `vertex-kill-switch` (us-central1)
→ disables Vertex AI API when `costAmount >= budgetAmount`

Budget ID: `019bafd3-599e-4cac-856e-7e69d8c40e00` on billing account `01202B-A941A0-6A8B07`.
Email alerts also go to billing admins at 50% / 90% / 100%.

## Change the budget amount

```sh
gcloud billing budgets update 019bafd3-599e-4cac-856e-7e69d8c40e00 \
  --billing-account=01202B-A941A0-6A8B07 --budget-amount=100AUD
```

## After it fires

App calls to Vertex fail with `SERVICE_DISABLED`. Run `./reenable.sh`, and raise the budget first — billing alerts repeat several times a day, so with spend still over budget the switch fires again.

## Redeploy the function

`./deploy.sh`

## Quota caps (real-time brake)

Billing data lags hours, so the budget alone cannot stop a fast runaway. These per-project overrides on `aiplatform.googleapis.com` throttle immediately with `429 RESOURCE_EXHAUSTED`:

| Model (`src/server/google/vertex.ts`) | base_model dimension | Quota | Default | Set to |
| --- | --- | --- | --- | --- |
| `gemini-3.1-pro-preview` | `gemini-3.1-pro-preview-cider-qcd` | requests/min | 250 | 60 |
| `gemini-3.7-flash` | `gemini-3.7-flash-qcd` | input tokens/min | 50,000,000 | 5,000,000 |
| `gemini-3.7-flash` | `gemini-3.7-flash-qcd` | input tokens/day | 5,000,000,000 | 100,000,000 |

`gemini-3-pro-image` has no adjustable quota (dynamic shared quota) — the kill switch is its only guard.

Edit at `https://console.cloud.google.com/apis/api/aiplatform.googleapis.com/quotas?project=mtd-hackathons`, filtering by the base_model dimension. The console lists the service as **Agent Platform API**. Raising a value back to its default needs no approval; going above the default does.

New models start at the default quota, so add overrides whenever `vertex.ts` adopts one.

## Caveats

- Budget resets each calendar month.
- Output tokens are not covered by any quota above; only input tokens and request counts are.

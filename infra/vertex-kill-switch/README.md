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

## Caveats

- Billing data lags hours; a fast runaway can overshoot before the alert lands. Real-time protection = quota caps on `aiplatform.googleapis.com` (IAM & Admin → Quotas).
- Budget resets each calendar month.

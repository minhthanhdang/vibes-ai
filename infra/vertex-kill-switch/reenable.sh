#!/usr/bin/env bash
set -euo pipefail

gcloud services enable aiplatform.googleapis.com --project=mtd-hackathons
echo "Vertex AI re-enabled. Raise the budget before traffic resumes, or the next alert fires the switch again:"
echo "  gcloud billing budgets update 019bafd3-599e-4cac-856e-7e69d8c40e00 --billing-account=01202B-A941A0-6A8B07 --budget-amount=<NEW_AMOUNT>AUD"

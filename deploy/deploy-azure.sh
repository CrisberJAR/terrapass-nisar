#!/usr/bin/env bash
# TerraPass v3 · deploy to Azure App Service (Linux, Node 24) — bash / Azure Cloud Shell version
# Usage: ./deploy/deploy-azure.sh [app-name] [location] [sku]
set -euo pipefail
APP="${1:-terrapass-nisar-$RANDOM}"; LOC="${2:-eastus}"; SKU="${3:-B1}"; RG="rg-terrapass"
cd "$(dirname "$0")/.."
az account show >/dev/null 2>&1 || az login
az group create -n "$RG" -l "$LOC" -o none
az appservice plan create -n "$APP-plan" -g "$RG" -l "$LOC" --sku "$SKU" --is-linux -o none
az webapp create -n "$APP" -g "$RG" -p "$APP-plan" --runtime "NODE:24-lts" -o none
az webapp config appsettings set -n "$APP" -g "$RG" --settings SCM_DO_BUILD_DURING_DEPLOYMENT=true NODE_ENV=production \
  ${SUPABASE_URL:+SUPABASE_URL=$SUPABASE_URL} ${SUPABASE_PUBLISHABLE_KEY:+SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY} -o none
az webapp config set -n "$APP" -g "$RG" --startup-file "npm start" -o none
az webapp update -n "$APP" -g "$RG" --https-only true -o none
rm -f /tmp/terrapass.zip && zip -qr /tmp/terrapass.zip server.js package.json package-lock.json public
az webapp deploy -n "$APP" -g "$RG" --src-path /tmp/terrapass.zip --type zip -o none
echo "Deployed -> https://$APP.azurewebsites.net"


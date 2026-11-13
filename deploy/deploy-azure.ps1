<#
  TerraPass v3 · One-command deployment to Azure App Service (Linux, Node 24)

  Requirements:
    1. Azure CLI  ->  winget install -e --id Microsoft.AzureCLI   (then reopen the terminal)
    2. An Azure subscription (Azure for Students works: https://azure.microsoft.com/free/students)

  Usage (from the project root):
    powershell -ExecutionPolicy Bypass -File .\deploy\deploy-azure.ps1
    powershell -ExecutionPolicy Bypass -File .\deploy\deploy-azure.ps1 -AppName terrapass-nisar-123 -Location brazilsouth -Sku B1

  Optional Supabase settings (otherwise the app runs Cal/Val in local mode):
    -SupabaseUrl https://xxxx.supabase.co -SupabaseKey sb_publishable_xxx
#>
param(
  [string]$AppName = "terrapass-nisar-$((Get-Random -Maximum 99999))",
  [string]$ResourceGroup = "rg-terrapass",
  [string]$Location = "eastus",
  [ValidateSet("F1", "B1", "B2", "S1", "P0v3")] [string]$Sku = "B1",
  [string]$SupabaseUrl = "",
  [string]$SupabaseKey = ""
)
$ErrorActionPreference = "Stop"
function Check([string]$step) { if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: $step (exit $LASTEXITCODE)" -ForegroundColor Red; exit 1 } }
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "`n== TerraPass v3 -> Azure App Service ==" -ForegroundColor Cyan
if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
  Write-Host "Azure CLI not found. Install it with:  winget install -e --id Microsoft.AzureCLI" -ForegroundColor Yellow
  exit 1
}

# 1) Login (opens the browser once)
$acct = az account show 2>$null | ConvertFrom-Json
if (-not $acct) { az login | Out-Null; $acct = az account show | ConvertFrom-Json }
Write-Host "Subscription: $($acct.name)" -ForegroundColor Green

# 2) Resource group + Linux plan + Web App (Node 20 LTS)
Write-Host "Creating resource group '$ResourceGroup' in $Location ..."
az group create --name $ResourceGroup --location $Location --output none
$plan = "$AppName-plan"
Write-Host "Creating App Service plan '$plan' ($Sku, Linux) ..."
az appservice plan create --name $plan --resource-group $ResourceGroup --location $Location --sku $Sku --is-linux --output none; Check "app service plan"
Write-Host "Creating Web App '$AppName' (NODE:24-lts) ..."
az webapp create --name $AppName --resource-group $ResourceGroup --plan $plan --runtime "NODE:24-lts" --output none; Check "web app"

# 3) Configuration
$settings = @("SCM_DO_BUILD_DURING_DEPLOYMENT=true", "WEBSITE_NODE_DEFAULT_VERSION=~24", "NODE_ENV=production")
if ($SupabaseUrl) { $settings += "SUPABASE_URL=$SupabaseUrl" }
if ($SupabaseKey) { $settings += "SUPABASE_PUBLISHABLE_KEY=$SupabaseKey" }
az webapp config appsettings set --name $AppName --resource-group $ResourceGroup --settings $settings --output none; Check "app settings"
az webapp config set --name $AppName --resource-group $ResourceGroup --startup-file "npm start" --http20-enabled true --output none
if ($Sku -ne "F1") { az webapp config set --name $AppName --resource-group $ResourceGroup --always-on true --output none }
az webapp update --name $AppName --resource-group $ResourceGroup --https-only true --output none

# 4) Package (without node_modules; Oryx runs npm install on Azure) and deploy
$zip = Join-Path $env:TEMP "terrapass-deploy.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host "Packaging ..."
# tar.exe (built into Windows 10/11) writes forward-slash paths; Compress-Archive in PS 5.1 does not (breaks Linux)
& "$env:SystemRoot\System32\tar.exe" -a -c -f $zip server.js package.json package-lock.json public
Write-Host "Deploying (this takes 1-3 minutes) ..."
az webapp deploy --name $AppName --resource-group $ResourceGroup --src-path $zip --type zip --output none; Check "zip deploy"

$url = "https://$AppName.azurewebsites.net"
Write-Host "`nDeployed! -> $url" -ForegroundColor Green
Write-Host "Health check: $url/api/health"
Write-Host "30-second film: $url/promo.html"
Write-Host "Logs: az webapp log tail --name $AppName --resource-group $ResourceGroup"
Write-Host "Delete everything later: az group delete --name $ResourceGroup --yes`n"



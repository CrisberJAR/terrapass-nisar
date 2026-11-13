// TerraPass v3 · Infrastructure as Code (Azure Bicep)
// Deploy:  az group create -n rg-terrapass -l eastus
//          az deployment group create -g rg-terrapass -f infra/main.bicep -p appName=terrapass-nisar-123
@description('Globally unique web app name (becomes <appName>.azurewebsites.net)')
param appName string
param location string = resourceGroup().location
@allowed([ 'F1', 'B1', 'B2', 'S1', 'P0v3' ])
param sku string = 'B1'
param supabaseUrl string = ''
@secure()
param supabaseKey string = ''

resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${appName}-plan'
  location: location
  kind: 'linux'
  sku: { name: sku }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|24-lts'
      appCommandLine: 'npm start'
      alwaysOn: sku != 'F1'
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      appSettings: [
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'NODE_ENV', value: 'production' }
        { name: 'SUPABASE_URL', value: supabaseUrl }
        { name: 'SUPABASE_PUBLISHABLE_KEY', value: supabaseKey }
      ]
    }
  }
}

output url string = 'https://${app.properties.defaultHostName}'


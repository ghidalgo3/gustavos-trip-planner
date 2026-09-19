targetScope = 'resourceGroup'

@description('Prefix for generated resource names. Combined with a resource-group hash for global uniqueness.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'tripplanner'

@description('Azure region for all resources. The project target is East US 2.')
param location string = 'eastus2'

param imageName string = 'tripplanner-api'
param appServicePlanSku string = 'B1'

param tags object = {
  workload: 'gustavo-trip-planner'
  managedBy: 'bicep'
}

var sanitizedPrefix = toLower(replace(replace(namePrefix, '-', ''), '_', ''))
var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = 'acr${sanitizedPrefix}${uniqueSuffix}'
var webAppName = '${namePrefix}-api-${uniqueSuffix}'
var staticWebAppName = '${namePrefix}-web-${uniqueSuffix}'
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: { name: appServicePlanSku }
  properties: { reserved: true }
}

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageName}:release'
      acrUseManagedIdentityCreds: true
      healthCheckPath: '/health'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      cors: {
        allowedOrigins: ['https://${staticWebApp.properties.defaultHostname}']
        supportCredentials: true
      }
      appSettings: [
        { name: 'WEBSITES_PORT', value: '8080' }
        { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
        { name: 'DOCKER_REGISTRY_SERVER_URL', value: 'https://${acr.properties.loginServer}' }
        { name: 'ClientOrigins__0', value: 'https://${staticWebApp.properties.defaultHostname}' }
      ]
    }
  }
}

resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, webApp.id, acrPullRoleDefinitionId)
  scope: acr
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output webAppName string = webApp.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output staticWebAppName string = staticWebApp.name
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'

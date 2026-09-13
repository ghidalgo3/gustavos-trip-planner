targetScope = 'resourceGroup'

@description('Prefix for generated resource names. Combined with a hash of the resource group id to stay globally unique.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'tripplanner'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Container repository name inside the registry.')
param imageName string = 'tripplanner-api'

@description('Container image tag to run. The deploy script passes the git short SHA.')
param imageTag string = 'latest'

@description('App Service plan SKU. B1 is the cheapest tier that supports alwaysOn.')
param appServicePlanSku string = 'B1'

@description('Tags applied to every resource.')
param tags object = {
  workload: 'gustavo-trip-planner'
  managedBy: 'bicep'
}

// Registry names allow only lowercase alphanumerics.
var sanitizedPrefix = toLower(replace(replace(namePrefix, '-', ''), '_', ''))
var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = 'acr${sanitizedPrefix}${uniqueSuffix}'
var webAppName = '${namePrefix}-${uniqueSuffix}'
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d' // AcrPull
)

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    // The Web App pulls with its managed identity, so no admin user is needed and
    // no registry password is ever stored in app settings or CI secrets.
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  tags: tags
  kind: 'linux'
  sku: {
    name: appServicePlanSku
  }
  properties: {
    reserved: true // required for Linux plans
  }
}

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  tags: tags
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageName}:${imageTag}'
      acrUseManagedIdentityCreds: true
      healthCheckPath: '/health'
      alwaysOn: true
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      appSettings: [
        {
          // App Service probes this port inside the container; it must match
          // ASPNETCORE_HTTP_PORTS in src/TripPlanner.Api/Dockerfile.
          name: 'WEBSITES_PORT'
          value: '8080'
        }
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: 'Production'
        }
        {
          name: 'DOCKER_REGISTRY_SERVER_URL'
          value: 'https://${acr.properties.loginServer}'
        }
      ]
    }
  }
}

// Lets the Web App's system-assigned identity pull images from the registry.
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

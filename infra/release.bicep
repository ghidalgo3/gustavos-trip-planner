targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string = 'tripplanner'
param imageName string = 'tripplanner-api'
param imageTag string

param googleClientId string = ''
param microsoftClientId string = ''

var sanitizedPrefix = toLower(replace(replace(namePrefix, '-', ''), '_', ''))
var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = 'acr${sanitizedPrefix}${uniqueSuffix}'
var keyVaultName = 'kv${take(sanitizedPrefix, 9)}${uniqueSuffix}'
var webAppName = '${namePrefix}-api-${uniqueSuffix}'
var postgresServerName = 'psql-${namePrefix}-${uniqueSuffix}'
var azureMapsAccountName = '${namePrefix}-maps-${uniqueSuffix}'
var azureMapsSasIdentityName = '${namePrefix}-maps-sas-${uniqueSuffix}'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource webApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: webAppName
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresServerName
}

resource azureMapsAccount 'Microsoft.Maps/accounts@2023-06-01' existing = {
  name: azureMapsAccountName
}

resource azureMapsSasIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: azureMapsSasIdentityName
}

resource webConfig 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'web'
  parent: webApp
  properties: {
    linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageName}:${imageTag}'
    acrUseManagedIdentityCreds: true
    healthCheckPath: '/health'
    alwaysOn: true
    ftpsState: 'Disabled'
    minTlsVersion: '1.2'
    http20Enabled: true
    cors: {
      allowedOrigins: [
        'https://${webApp.properties.defaultHostName}'
        'http://localhost:5173'
      ]
      supportCredentials: true
    }
  }
}

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'appsettings'
  parent: webApp
  properties: {
    WEBSITES_PORT: '8080'
    WEBSITES_ENABLE_APP_SERVICE_STORAGE: 'true'
    ASPNETCORE_ENVIRONMENT: 'Production'
    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'
    ClientOrigins__0: 'https://${webApp.properties.defaultHostName}'
    ClientOrigins__1: 'http://localhost:5173'
    ConnectionStrings__TripPlanner: 'Host=${postgresServer.properties.fullyQualifiedDomainName};Port=5432;Database=tripplanner;Username=${webApp.name};SSL Mode=Require;Trust Server Certificate=false'
    Database__UseAzureManagedIdentity: 'true'
    AzureMaps__Endpoint: 'https://atlas.microsoft.com'
    AzureMaps__ResourceId: azureMapsAccount.id
    AzureMaps__SasPrincipalId: azureMapsSasIdentity.properties.principalId
    Authentication__Google__ClientId: googleClientId
    Ignav__ApiKey: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=ignav-api-key)'
    OpenAI__ApiKey: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=openai-api-key)'
    Authentication__Google__ClientSecret: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=google-client-secret)'
    Authentication__Microsoft__ClientId: microsoftClientId
    Authentication__Microsoft__ClientSecret: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=microsoft-client-secret)'
    Authentication__DataProtectionKeysPath: '/home/data-protection-keys'
  }
}

resource authSettings 'Microsoft.Web/sites/config@2022-09-01' = {
  name: 'authsettingsV2'
  parent: webApp
  properties: {
    platform: { enabled: false }
  }
  dependsOn: [appSettings]
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'

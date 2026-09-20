targetScope = 'resourceGroup'

@minLength(3)
@maxLength(16)
param namePrefix string = 'tripplanner'
param imageName string = 'tripplanner-api'
param imageTag string

@description('Enable App Service authentication after both provider registrations are ready.')
param authenticationEnabled bool = false
param googleClientId string = ''
param microsoftClientId string = ''

var sanitizedPrefix = toLower(replace(replace(namePrefix, '-', ''), '_', ''))
var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = 'acr${sanitizedPrefix}${uniqueSuffix}'
var keyVaultName = 'kv${take(sanitizedPrefix, 9)}${uniqueSuffix}'
var webAppName = '${namePrefix}-api-${uniqueSuffix}'
var staticWebAppName = '${namePrefix}-web-${uniqueSuffix}'
var microsoftPersonalAccountsIssuer = '${environment().authentication.loginEndpoint}9188040d-6c67-4c5b-b112-36a304b66dad/v2.0'

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource staticWebApp 'Microsoft.Web/staticSites@2025-03-01' existing = {
  name: staticWebAppName
}

resource webApp 'Microsoft.Web/sites@2023-12-01' existing = {
  name: webAppName
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
        'https://${staticWebApp.properties.defaultHostname}'
        'http://localhost:5173'
      ]
      supportCredentials: true
    }
  }
}

resource appSettings 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'appsettings'
  parent: webApp
  properties: union({
    WEBSITES_PORT: '8080'
    ASPNETCORE_ENVIRONMENT: 'Production'
    DOCKER_REGISTRY_SERVER_URL: 'https://${acr.properties.loginServer}'
    ClientOrigins__0: 'https://${staticWebApp.properties.defaultHostname}'
    ClientOrigins__1: 'http://localhost:5173'
  }, authenticationEnabled ? {
    GOOGLE_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=google-client-secret)'
    MICROSOFT_PROVIDER_AUTHENTICATION_SECRET: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=microsoft-client-secret)'
  } : {})
}

resource authSettings 'Microsoft.Web/sites/config@2022-09-01' = {
  name: 'authsettingsV2'
  parent: webApp
  properties: union({
    platform: { enabled: authenticationEnabled }
    globalValidation: {
      requireAuthentication: false
      unauthenticatedClientAction: 'AllowAnonymous'
    }
    httpSettings: { requireHttps: true }
  }, authenticationEnabled ? {
    identityProviders: {
      google: {
        enabled: true
        registration: {
          clientId: googleClientId
          clientSecretSettingName: 'GOOGLE_PROVIDER_AUTHENTICATION_SECRET'
        }
        login: { scopes: ['openid', 'profile', 'email'] }
      }
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: microsoftClientId
          clientSecretSettingName: 'MICROSOFT_PROVIDER_AUTHENTICATION_SECRET'
          openIdIssuer: microsoftPersonalAccountsIssuer
        }
        login: {
          loginParameters: ['scope=openid profile email']
        }
        validation: {
          allowedAudiences: [microsoftClientId]
        }
      }
    }
    login: {
      allowedExternalRedirectUrls: [
        'https://${staticWebApp.properties.defaultHostname}'
        'http://localhost:5173'
      ]
      tokenStore: { enabled: true }
    }
  } : {})
  dependsOn: [appSettings]
}

output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'

targetScope = 'resourceGroup'

@description('Prefix for generated resource names. Combined with a resource-group hash for global uniqueness.')
@minLength(3)
@maxLength(16)
param namePrefix string = 'tripplanner'

@description('Default Azure region for the application resources. The project target is East US 2.')
param location string = 'eastus2'

@description('Azure Maps and its SAS identity region. Azure Maps is unavailable in East US 2.')
param azureMapsLocation string = 'eastus'

param appServicePlanSku string = 'B1'

@description('Object ID of the user who manages application credentials in Key Vault.')
param keyVaultOperatorPrincipalId string


param tags object = {
  workload: 'gustavo-trip-planner'
  managedBy: 'bicep'
}

var sanitizedPrefix = toLower(replace(replace(namePrefix, '-', ''), '_', ''))
var uniqueSuffix = uniqueString(resourceGroup().id)
var acrName = 'acr${sanitizedPrefix}${uniqueSuffix}'
var keyVaultName = 'kv${take(sanitizedPrefix, 9)}${uniqueSuffix}'
var webAppName = '${namePrefix}-api-${uniqueSuffix}'
var postgresServerName = 'psql-${namePrefix}-${uniqueSuffix}'
var postgresAdminIdentityName = '${namePrefix}-postgres-admin-${uniqueSuffix}'
var azureMapsAccountName = '${namePrefix}-maps-${uniqueSuffix}'
var azureMapsSasIdentityName = '${namePrefix}-maps-sas-${uniqueSuffix}'
// Consent to in-country processing required for Korean address requests.
var azureMapsProcessingLocations = [
  { locationName: 'Korea Central' }
]
var applicationInsightsName = '${namePrefix}-insights-${uniqueSuffix}'

// Workspace-backed Application Insights for browser behavior and HTTP traces.
resource telemetryWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-telemetry-${uniqueSuffix}'
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource applicationInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: applicationInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: telemetryWorkspace.id
    IngestionMode: 'LogAnalytics'
  }
}
var acrPullRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '7f951dda-4ed3-4680-a7ca-43fe172d538d'
)
var keyVaultSecretsOfficerRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
)
var keyVaultSecretsUserRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '4633458b-17de-408a-b874-0445c86b69e6'
)
var azureMapsSearchReaderRoleDefinitionId = subscriptionResourceId(
  'Microsoft.Authorization/roleDefinitions',
  '6be48352-4f82-47c9-ad5e-0acacefdb005'
)
var azureMapsSasIssuerRoleDefinitionId = guid(
  subscription().id,
  resourceGroup().id,
  'trip-planner-azure-maps-sas-issuer'
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

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  tags: tags
  properties: {
    tenantId: tenant().tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: true
    enablePurgeProtection: true
    softDeleteRetentionInDays: 90
    publicNetworkAccess: 'Enabled'
  }
}

resource postgresServer 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: postgresServerName
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '18'
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
    network: {
      publicNetworkAccess: 'Enabled'
    }
    storage: {
      autoGrow: 'Enabled'
      storageSizeGB: 32
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2024-08-01' = {
  name: 'tripplanner'
  parent: postgresServer
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresAdminIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: postgresAdminIdentityName
  location: location
  tags: tags
}

resource postgresExtensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'azure.extensions'
  parent: postgresServer
  properties: {
    source: 'user-override'
    value: 'POSTGIS,PG_CRON'
  }
}

resource postgresPreloadLibraries 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'shared_preload_libraries'
  parent: postgresServer
  properties: {
    source: 'user-override'
    value: 'pg_cron,pg_stat_statements'
  }
  dependsOn: [postgresExtensions]
}

resource postgresCronDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  name: 'cron.database_name'
  parent: postgresServer
  properties: {
    source: 'user-override'
    value: postgresDatabase.name
  }
  dependsOn: [postgresPreloadLibraries]
}

resource postgresAzureFirewallRule 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  name: 'AllowAzureServices'
  parent: postgresServer
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
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

resource azureMapsSasIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: azureMapsSasIdentityName
  location: azureMapsLocation
  tags: tags
}

resource azureMapsAccount 'Microsoft.Maps/accounts@2024-07-01-preview' = {
  name: azureMapsAccountName
  location: azureMapsLocation
  tags: tags
  kind: 'Gen2'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${azureMapsSasIdentity.id}': {}
    }
  }
  sku: {
    name: 'G2'
  }
  properties: {
    disableLocalAuth: false
    locations: azureMapsProcessingLocations
  }
}

module azureMapsCors './azure-maps-cors.bicep' = {
  name: 'azure-maps-cors'
  params: {
    accountName: azureMapsAccount.name
    location: azureMapsLocation
    sasIdentityResourceId: azureMapsSasIdentity.id
    processingLocations: azureMapsProcessingLocations
    allowedOrigins: [
      'https://${webApp.properties.defaultHostName}'
      'http://localhost:5173'
    ]
    tags: tags
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
  }
}

module postgresEntraAdministrator './postgres-entra-admin.bicep' = {
  name: 'postgres-entra-administrator'
  params: {
    postgresServerName: postgresServer.name
    principalId: postgresAdminIdentity.properties.principalId
    principalName: postgresAdminIdentity.name
    tenantId: tenant().tenantId
  }
}

module postgresAppEntraAdministrator './postgres-entra-admin.bicep' = {
  name: 'postgres-app-entra-administrator'
  params: {
    postgresServerName: postgresServer.name
    principalId: webApp.identity.principalId
    principalName: webApp.name
    tenantId: tenant().tenantId
  }
}

resource postgresRoleSetup 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: '${namePrefix}-postgres-roles-${uniqueSuffix}'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${postgresAdminIdentity.id}': {}
    }
  }
  properties: {
    azCliVersion: '2.74.0'
    timeout: 'PT20M'
    cleanupPreference: 'OnSuccess'
    retentionInterval: 'PT1H'
    environmentVariables: [
      { name: 'ADMIN_CLIENT_ID', value: postgresAdminIdentity.properties.clientId }
      { name: 'ADMIN_NAME', value: postgresAdminIdentity.name }
      { name: 'POSTGRES_HOST', value: postgresServer.properties.fullyQualifiedDomainName }
      { name: 'APP_ROLE', value: webApp.name }
      { name: 'CONTRIBUTOR_NAME', value: 'gustavo_planner_contributor' }
      { name: 'USER_PRINCIPAL_ID', value: keyVaultOperatorPrincipalId }
      { name: 'USER_DATABASE_ROLE', value: 'gustavo_hidalgo' }
    ]
    scriptContent: replace('''
      set -euo pipefail
      az login --identity --client-id "$ADMIN_CLIENT_ID" --allow-no-subscriptions >/dev/null
      access_token="$(az account get-access-token --resource https://ossrdbms-aad.database.windows.net --query accessToken -o tsv)"
      python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --upgrade
      python3 -m pip install --quiet --root-user-action=ignore --target /tmp/postgres-role-deps 'psycopg[binary]'
      export PYTHONPATH=/tmp/postgres-role-deps
      export PGPASSWORD="$access_token"
      printf '%s' '__ROLE_SETUP_B64__' | base64 -d > /tmp/postgres-role-setup.py
      python3 /tmp/postgres-role-setup.py
    ''', '__ROLE_SETUP_B64__', base64(loadTextContent('./postgres-role-setup.py')))
    forceUpdateTag: 'gustavo-planner-contributor-v8'
  }
  dependsOn: [
    postgresDatabase
    postgresCronDatabase
    postgresEntraAdministrator
    postgresAppEntraAdministrator
    postgresAzureFirewallRule
    webApp
  ]
}

resource azureMapsSasIdentitySearchReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(azureMapsAccount.id, azureMapsSasIdentity.id, azureMapsSearchReaderRoleDefinitionId)
  scope: azureMapsAccount
  properties: {
    principalId: azureMapsSasIdentity.properties.principalId
    roleDefinitionId: azureMapsSearchReaderRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

// Search Reader does not authorize the route matrix API. Keep the added data
// permission limited to reading route calculations, without storage writes.
resource azureMapsRouteReaderRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, resourceGroup().id, 'trip-planner-maps-route-reader')
  properties: {
    roleName: 'Trip Planner Azure Maps Route Reader'
    description: 'Allows walking and road travel estimates for activity planning.'
    type: 'CustomRole'
    permissions: [{
      actions: []
      notActions: []
      dataActions: ['Microsoft.Maps/accounts/services/route/read']
      notDataActions: []
    }]
    assignableScopes: [resourceGroup().id]
  }
}

resource azureMapsSasIdentityRouteReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(azureMapsAccount.id, azureMapsSasIdentity.id, azureMapsRouteReaderRole.id)
  scope: azureMapsAccount
  properties: {
    principalId: azureMapsSasIdentity.properties.principalId
    roleDefinitionId: azureMapsRouteReaderRole.id
    principalType: 'ServicePrincipal'
  }
}

// Search Reader does not include coordinate-based timezone lookup.
resource azureMapsTimeZoneReaderRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, resourceGroup().id, 'trip-planner-maps-timezone-reader')
  properties: {
    roleName: 'Trip Planner Azure Maps Timezone Reader'
    description: 'Allows resolving destination timezones from coordinates.'
    type: 'CustomRole'
    permissions: [{
      actions: []
      notActions: []
      dataActions: ['Microsoft.Maps/accounts/services/timezone/read']
      notDataActions: []
    }]
    assignableScopes: [resourceGroup().id]
  }
}

resource azureMapsSasIdentityTimeZoneReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(azureMapsAccount.id, azureMapsSasIdentity.id, azureMapsTimeZoneReaderRole.id)
  scope: azureMapsAccount
  properties: {
    principalId: azureMapsSasIdentity.properties.principalId
    roleDefinitionId: azureMapsTimeZoneReaderRole.id
    principalType: 'ServicePrincipal'
  }
}

resource azureMapsSasIssuerRoleDefinition 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: azureMapsSasIssuerRoleDefinitionId
  properties: {
    roleName: 'Trip Planner Azure Maps SAS Issuer'
    description: 'Allows the Trip Planner API to issue Azure Maps SAS tokens.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Maps/accounts/read'
          'Microsoft.Maps/accounts/listSas/action'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [resourceGroup().id]
  }
}

resource webAppAzureMapsSasIssuer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(azureMapsAccount.id, webApp.id, azureMapsSasIssuerRoleDefinition.id)
  scope: azureMapsAccount
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: azureMapsSasIssuerRoleDefinition.id
    principalType: 'ServicePrincipal'
  }
}

resource webAppLogs 'Microsoft.Web/sites/config@2023-12-01' = {
  name: 'logs'
  parent: webApp
  properties: {
    applicationLogs: {
      fileSystem: {
        level: 'Information'
      }
    }
    detailedErrorMessages: {
      enabled: true
    }
    failedRequestsTracing: {
      enabled: false
    }
    httpLogs: {
      fileSystem: {
        // Calendar subscription paths carry bearer tokens. App Service cannot
        // redact individual path segments, so request-path logs stay disabled.
        enabled: false
        retentionInDays: 1
        retentionInMb: 35
      }
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

resource webAppKeyVaultSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, webApp.id, keyVaultSecretsUserRoleDefinitionId)
  scope: keyVault
  properties: {
    principalId: webApp.identity.principalId
    roleDefinitionId: keyVaultSecretsUserRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

resource secretManagerKeyVaultSecretsOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, keyVaultOperatorPrincipalId, keyVaultSecretsOfficerRoleDefinitionId)
  scope: keyVault
  properties: {
    principalId: keyVaultOperatorPrincipalId
    roleDefinitionId: keyVaultSecretsOfficerRoleDefinitionId
    principalType: 'User'
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri
output webAppName string = webApp.name
output applicationInsightsName string = applicationInsights.name
output webAppUrl string = 'https://${webApp.properties.defaultHostName}'
output postgresServerName string = postgresServer.name
output postgresContributorRoleName string = 'gustavo_planner_contributor'
output postgresUserRoleName string = 'gustavo_hidalgo'
output azureMapsAccountName string = azureMapsAccount.name
output azureMapsAccountResourceId string = azureMapsAccount.id
output azureMapsSasPrincipalId string = azureMapsSasIdentity.properties.principalId

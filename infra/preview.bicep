targetScope = 'resourceGroup'

param location string = resourceGroup().location
param deployPrincipalId string
param deployPrincipalName string

var suffix = uniqueString(resourceGroup().id)

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'acrtrippreview${suffix}'
  location: location
  sku: { name: 'Basic' }
  tags: { workload: 'tripplanner-preview' }
  properties: { adminUserEnabled: false }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-trippreview-${suffix}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  tags: { workload: 'tripplanner-preview' }
  properties: {
    version: '18'
    storage: { storageSizeGB: 32, autoGrow: 'Enabled' }
    backup: { backupRetentionDays: 7, geoRedundantBackup: 'Disabled' }
    network: { publicNetworkAccess: 'Enabled' }
    authConfig: {
      activeDirectoryAuth: 'Enabled'
      passwordAuth: 'Disabled'
      tenantId: tenant().tenantId
    }
  }
}

// The slot connects with its own Entra identity. GitHub runners use temporary
// single-IP rules while copying the database.
resource azureFirewall 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2024-08-01' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: { startIpAddress: '0.0.0.0', endIpAddress: '0.0.0.0' }
}

resource extensions 'Microsoft.DBforPostgreSQL/flexibleServers/configurations@2024-08-01' = {
  parent: postgres
  name: 'azure.extensions'
  properties: { source: 'user-override', value: 'POSTGIS' }
}

module postgresAdmin 'postgres-entra-admin.bicep' = {
  name: 'preview-postgres-entra-admin'
  params: {
    postgresServerName: postgres.name
    principalId: deployPrincipalId
    principalName: deployPrincipalName
    tenantId: tenant().tenantId
  }
}

output registryId string = registry.id
output registryName string = registry.name
output registryHost string = registry.properties.loginServer
output postgresId string = postgres.id
output postgresName string = postgres.name

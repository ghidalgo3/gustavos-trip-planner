targetScope = 'resourceGroup'

param location string = resourceGroup().location
param serverSku string = 'Standard_B1ms'
param deployPrincipalId string
param deployPrincipalName string

var suffix = uniqueString(resourceGroup().id, 'preview-db')

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: 'psql-trippreview-${suffix}'
  location: location
  sku: {
    name: serverSku
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

output postgresId string = postgres.id
output postgresName string = postgres.name

targetScope = 'resourceGroup'

param location string = resourceGroup().location
param postgresServerName string
param postgresAdminIdentityName string
param productionRole string
param readerName string
param readerPrincipalId string
param slotName string
param slotPrincipalId string

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' existing = {
  name: postgresServerName
}

resource admin 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: postgresAdminIdentityName
}

resource grantReader 'Microsoft.Resources/deploymentScripts@2023-08-01' = {
  name: 'tripplanner-preview-reader'
  location: location
  kind: 'AzureCLI'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${admin.id}': {} }
  }
  properties: {
    azCliVersion: '2.74.0'
    timeout: 'PT15M'
    cleanupPreference: 'OnSuccess'
    retentionInterval: 'PT1H'
    forceUpdateTag: 'shared-preview-databases-v1'
    environmentVariables: [
      { name: 'ADMIN_CLIENT_ID', value: admin.properties.clientId }
      { name: 'PGUSER', value: admin.name }
      { name: 'PGHOST', value: postgres.properties.fullyQualifiedDomainName }
      { name: 'PRODUCTION_ROLE', value: productionRole }
      { name: 'READER_NAME', value: readerName }
      { name: 'READER_PRINCIPAL_ID', value: readerPrincipalId }
      { name: 'SLOT_NAME', value: slotName }
      { name: 'SLOT_PRINCIPAL_ID', value: slotPrincipalId }
    ]
    scriptContent: replace('''
      set -euo pipefail
      az login --identity --client-id "$ADMIN_CLIENT_ID" --allow-no-subscriptions >/dev/null
      PGPASSWORD="$(az account get-access-token --resource-type oss-rdbms --query accessToken -o tsv)"
      export PGPASSWORD PGSSLMODE=require
      python3 -m pip --version >/dev/null 2>&1 || python3 -m ensurepip --upgrade
      python3 -m pip install --quiet --root-user-action=ignore --target /tmp/preview-reader-deps 'psycopg[binary]'
      export PYTHONPATH=/tmp/preview-reader-deps
      printf '%s' '__READER_B64__' | base64 -d > /tmp/preview-reader.py
      python3 /tmp/preview-reader.py
    ''', '__READER_B64__', base64(loadTextContent('./preview-reader.py')))
  }
}

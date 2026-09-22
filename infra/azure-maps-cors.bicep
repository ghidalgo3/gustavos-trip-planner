targetScope = 'resourceGroup'

param accountName string
param location string
param sasIdentityResourceId string
param allowedOrigins array
param tags object

resource azureMapsAccount 'Microsoft.Maps/accounts@2023-06-01' = {
  name: accountName
  location: location
  tags: tags
  kind: 'Gen2'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${sasIdentityResourceId}': {}
    }
  }
  sku: {
    name: 'G2'
  }
  properties: {
    disableLocalAuth: false
    cors: {
      corsRules: [
        {
          allowedOrigins: allowedOrigins
        }
      ]
    }
  }
}

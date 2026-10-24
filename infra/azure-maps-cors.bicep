targetScope = 'resourceGroup'

param accountName string
param location string
param sasIdentityResourceId string
param processingLocations array
param allowedOrigins array
param tags object

resource azureMapsAccount 'Microsoft.Maps/accounts@2024-07-01-preview' = {
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
    locations: processingLocations
    cors: {
      corsRules: [
        {
          allowedOrigins: allowedOrigins
        }
      ]
    }
  }
}

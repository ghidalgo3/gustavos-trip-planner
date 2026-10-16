-- Generated from OAuthDbContext and OpenIddict 7.7.2; applied by the existing SQL migrator.
DO $EF$
BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname = 'gustavo_planner') THEN
        CREATE SCHEMA gustavo_planner;
    END IF;
END $EF$;


CREATE TABLE gustavo_planner."OpenIddictApplications" (
    "Id" text NOT NULL,
    "ApplicationType" character varying(50),
    "ClientId" character varying(100),
    "ClientSecret" text,
    "ClientType" character varying(50),
    "ConcurrencyToken" character varying(50),
    "ConsentType" character varying(50),
    "DisplayName" text,
    "DisplayNames" text,
    "JsonWebKeySet" text,
    "Permissions" text,
    "PostLogoutRedirectUris" text,
    "Properties" text,
    "RedirectUris" text,
    "Requirements" text,
    "Settings" text,
    CONSTRAINT "PK_OpenIddictApplications" PRIMARY KEY ("Id")
);


CREATE TABLE gustavo_planner."OpenIddictScopes" (
    "Id" text NOT NULL,
    "ConcurrencyToken" character varying(50),
    "Description" text,
    "Descriptions" text,
    "DisplayName" text,
    "DisplayNames" text,
    "Name" character varying(200),
    "Properties" text,
    "Resources" text,
    CONSTRAINT "PK_OpenIddictScopes" PRIMARY KEY ("Id")
);


CREATE TABLE gustavo_planner."OpenIddictAuthorizations" (
    "Id" text NOT NULL,
    "ApplicationId" text,
    "ConcurrencyToken" character varying(50),
    "CreationDate" timestamp with time zone,
    "Properties" text,
    "Scopes" text,
    "Status" character varying(50),
    "Subject" character varying(400),
    "Type" character varying(50),
    CONSTRAINT "PK_OpenIddictAuthorizations" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OpenIddictAuthorizations_OpenIddictApplications_Application~" FOREIGN KEY ("ApplicationId") REFERENCES gustavo_planner."OpenIddictApplications" ("Id")
);


CREATE TABLE gustavo_planner."OpenIddictTokens" (
    "Id" text NOT NULL,
    "ApplicationId" text,
    "AuthorizationId" text,
    "ConcurrencyToken" character varying(50),
    "CreationDate" timestamp with time zone,
    "ExpirationDate" timestamp with time zone,
    "Payload" text,
    "Properties" text,
    "RedemptionDate" timestamp with time zone,
    "ReferenceId" character varying(100),
    "Status" character varying(50),
    "Subject" character varying(400),
    "Type" character varying(150),
    CONSTRAINT "PK_OpenIddictTokens" PRIMARY KEY ("Id"),
    CONSTRAINT "FK_OpenIddictTokens_OpenIddictApplications_ApplicationId" FOREIGN KEY ("ApplicationId") REFERENCES gustavo_planner."OpenIddictApplications" ("Id"),
    CONSTRAINT "FK_OpenIddictTokens_OpenIddictAuthorizations_AuthorizationId" FOREIGN KEY ("AuthorizationId") REFERENCES gustavo_planner."OpenIddictAuthorizations" ("Id")
);


CREATE UNIQUE INDEX "IX_OpenIddictApplications_ClientId" ON gustavo_planner."OpenIddictApplications" ("ClientId");


CREATE INDEX "IX_OpenIddictAuthorizations_ApplicationId_Status_Subject_Type" ON gustavo_planner."OpenIddictAuthorizations" ("ApplicationId", "Status", "Subject", "Type");


CREATE UNIQUE INDEX "IX_OpenIddictScopes_Name" ON gustavo_planner."OpenIddictScopes" ("Name");


CREATE INDEX "IX_OpenIddictTokens_ApplicationId_Status_Subject_Type" ON gustavo_planner."OpenIddictTokens" ("ApplicationId", "Status", "Subject", "Type");


CREATE INDEX "IX_OpenIddictTokens_AuthorizationId" ON gustavo_planner."OpenIddictTokens" ("AuthorizationId");


CREATE UNIQUE INDEX "IX_OpenIddictTokens_ReferenceId" ON gustavo_planner."OpenIddictTokens" ("ReferenceId");

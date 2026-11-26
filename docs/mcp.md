# ChatGPT MCP access and Activity Log

The API hosts a stateless Streamable HTTP MCP server at `/mcp`, using the official
C# MCP SDK. Its tools read and manage trips, destination visits, activities, activity preferences and plans, assessments, proposals, operations, and personal calendar subscriptions.
They call the same handlers as the REST API, enforcing existing membership,
Planner/owner permissions, validation, destination context versions, and activity
ETags. MCP requests require OAuth bearer tokens; website cookies cannot authorize
MCP calls. Tool input cannot choose the acting user.

MCP server instructions, tool descriptions and input schemas distinguish activity
ideas from scheduling. Agents should first create or reuse an undated idea such as
**Insadong crafts, tea, and Jogyesa**, then read `get_activity_plan` and use
`replace_activity_plan` to select and place its ID on the requested visit/date.
Requested times and dates belong in plan `rules` (`fixedDate`/`fixedStart`), with
ordered activity IDs in `days`; `Yes` alone means selected, not scheduled.
`days[].stayId` is the destination visit ID from `context.visits`, not the hotel ID.
Names and descriptions should not carry itinerary dates or day numbers. These are
agent instructions; existing activity names are preserved, and genuine dated event
names remain valid.

OpenIddict provides an OAuth authorization server alongside the existing Google
and Microsoft sign-in. ChatGPT and Muse use separate registered public clients
(`chatgpt` and `muse`, no client secrets), authorization-code flow with S256 PKCE,
exact callback allowlists, explicit CSRF-protected consent, and tokens bound to the
canonical `/mcp` resource.
`tripplanner.read` permits reads; `tripplanner.write` permits reads and writes that
the connected user is authorized to perform. Request `offline_access` for refresh
tokens. Access tokens last 15 minutes; refresh tokens last 30 days. Reference access
tokens and OAuth protocol state persist in PostgreSQL. Token revocation is checked
on each MCP request. Profile → **Connected agents** can revoke all MCP agent tokens
for the current user without removing their Activity Log.

Profile → **Activity Log** shows compact rows, loads five changes at a time, and
offers **Load more activity** for older entries. The **Activity source** filter
selects all changes, API (website and API-client changes), or MCP (ChatGPT and other
MCP agents). `GET /user/activity-log?skip=0&source=MCP` returns `{ entries, hasMore }`;
`source` is optional (`API` or `MCP`), and filtering happens before pagination.

## Production setup

One-time production setup:

```zsh
./scripts/secrets init-mcp
./scripts/release
```

`init-mcp` creates a 3072-bit RSA signing/encryption certificate in Key Vault as
`mcp-signing-certificate`, using private temporary files that are removed afterward.
It leaves an existing certificate unchanged. The certificate expires after 730 days;
rotate before expiry. Replacing this certificate invalidates existing encrypted
credentials and users must reconnect. The release requires this secret, enables
MCP, and sets the issuer to the application's public HTTPS URL. Production refuses
to start MCP without persistent keys. No external identity-provider subscription is
needed, and existing Google/Microsoft callback registrations stay the same.

## Connect ChatGPT or Muse

In ChatGPT on the web, add a custom MCP server/plugin with:

| Setting | Value |
| --- | --- |
| Server URL | `https://<api-app>.azurewebsites.net/mcp` |
| Authentication | OAuth |
| OAuth client ID | `chatgpt` |
| Client secret | Leave empty (public client with PKCE) |
| Scopes, if requested | `tripplanner.read tripplanner.write offline_access` |
| Authorization discovery | `https://<api-app>.azurewebsites.net/.well-known/openid-configuration` |
| Protected-resource discovery | `https://<api-app>.azurewebsites.net/.well-known/oauth-protected-resource/mcp` |

The default registered callback is
`https://chatgpt.com/connector_platform_oauth_redirect`. Use the **exact** callback
shown by ChatGPT; if it differs, set `MCP_REDIRECT_URI` when running `scripts/release`.
Create/install the plugin, connect your TripPlanner account, then use it in a
conversation. After choosing **Allow access** or **Cancel**, TripPlanner shows the
consent result. Select **Return to ChatGPT** to finish connecting or canceling;
approval alone does not complete the OAuth handoff. Workspace restrictions can
limit custom MCP access. This registers a private integration; public directory
distribution is a separate workflow. See
[OpenAI's connection guide](https://developers.openai.com/api/docs/guides/custom-mcp-server)
and [OAuth requirements](https://developers.openai.com/plugins/build/auth).

For Muse, use the same MCP server URL and OAuth discovery URLs, client ID `muse`,
and no client secret (token endpoint authentication method `none`). Its exact
registered callback is `https://agent.meta.ai/api/hatch/oauth/callback`. Request
`openid offline_access tripplanner.read tripplanner.write` using response type
`code`, authorization-code flow with S256 PKCE, and the canonical `/mcp` resource.
Refresh tokens use the `refresh_token` grant. After **Allow access** or **Cancel**,
Muse shows **Access approved** or **Access not granted**, with **Return to Muse**
to finish the OAuth handoff. This avoids browser restrictions on cross-site
redirects after the consent form POST. Both clients are registered or updated at API startup, including
after a release; adding Muse does not change ChatGPT's registration.

## Server configuration

Configuration binds to `McpOptions`: `Mcp:Enabled`, `Mcp:Issuer`, `Mcp:Certificate`
(base64 PFX), `Mcp:RedirectUris` (ChatGPT callbacks), and `Mcp:AgentClients`
(additional public MCP clients, defaulting to Muse with the callback above).
Agent client IDs must be unique across MCP and native clients, and MCP callbacks
must be exact HTTPS URLs. Development Compose enables MCP through Vite
at `http://localhost:5173/mcp` with ephemeral OAuth keys, so restarting invalidates
development tokens. `LOCAL_MCP_ISSUER` can override the development issuer. For
ChatGPT testing, use a publicly reachable HTTPS host/tunnel and register its login
callbacks with Google/Microsoft; a production ChatGPT client cannot reach localhost.
Vite proxies `/mcp`, `/oauth`, and `/.well-known` to the API.

## Native OAuth clients

Native clients use the same issuer with public client registrations in
`Mcp:NativeClients` (the shared OAuth issuer must be enabled with `Mcp:Enabled`).
`infra/release.bicep` registers `tripplanner-ios` (display name `TripPlanner iOS`)
with the exact callback `tripplanner:/oauth/callback` on each release. For example:

```json
{
  "Mcp": {
    "Enabled": true,
    "Issuer": "https://your-tripplanner-host/",
    "NativeClients": [{
      "ClientId": "tripplanner-ios",
      "DisplayName": "TripPlanner iOS",
      "RedirectUris": ["tripplanner:/oauth/callback"]
    }]
  }
}
```

Use the system authentication browser and authorization code flow with PKCE S256,
`state`, an exact registered callback, and `resource=https://your-tripplanner-host/api`.
Request `tripplanner.read` and, when needed, `tripplanner.write offline_access`.
Exchange/refresh at `/oauth/token` with the public `client_id` and no client secret;
keep refresh tokens in the platform's secure credential store. Send the access
token in `Authorization: Bearer ...` for REST requests. Cookies, an Origin header,
and browser CORS behavior are not part of this contract. REST authentication
failures return `401/403` instead of HTML login redirects. API and MCP token
audiences are separate. OAuth server metadata is at `/.well-known/oauth-authorization-server` and API resource metadata
at `/.well-known/oauth-protected-resource/api`. Native clients should persist the
last successful document per account/trip and follow the same explicit conflict
refresh protocol as the web app. Offline writes are not queued.

## Trip permissions and Activity Log

See [MCP planning and evaluations](mcp_planning.md) for agent workflows and the behavioral test runner.

**Profile → Activity Log** shows new successful trip mutations, newest first, with
the authorizing user, client/source, trip name, resource, action, and timestamp.
Website changes, agent changes, and activities saved by the background assistant
are attributed separately. The `ChatGPT` and `Muse` labels identify the registered
OAuth client; they are not derived from a caller-supplied header. Logs are visible to the
actor, trip owner, and current trip members. Former members lose visibility into
other people's actions; actors retain their own history. Historical names and
actors survive trip deletion. Existing history is not backfilled.

ChatGPT acts with the connected user's trip permissions: owners and planners can
modify trips after granting `tripplanner.write`; travellers remain read-only.
Trip lists and details both return `canPlan` for that user, so agents can reliably
distinguish editable trips from read-only shares. A read-only OAuth token is never
silently upgraded: write tools return an OAuth reauthorization challenge. Reconnect
with `tripplanner.read tripplanner.write offline_access` to grant write access.

`AuditedPlannerDb` decorates the shared `IPlannerDb` write interface. PostgreSQL
mutations and log inserts share an ambient transaction, so a failed audit insert
rolls back the write. Rejected writes are not logged. The log is append-only via
database triggers and stores no OAuth credentials, provider payloads, image uploads,
or AI prompts. New trip write methods must be added to its explicit action map.
Migrations `0009` and `0010` add the log and OpenIddict's schema through the existing
SQL migrator; no schemas need to be dropped.

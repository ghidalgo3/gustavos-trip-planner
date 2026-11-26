# Authentication

Authentication is handled by the API's ASP.NET Google and OpenID Connect middleware in both production and development. Azure App Service Authentication is explicitly disabled. The API stores provider tokens in its encrypted HTTP-only authentication cookie so it can retrieve profile images without persisting image URLs. Google and Microsoft sign-ins persist across browser restarts for 30 days. Sliding expiration renews the cookie when a request arrives after more than half its lifetime has elapsed; 30 days without renewal requires signing in again. Signing out clears the cookie. The production container serves the React application and API from one origin, allowing a `SameSite=Lax`, `Secure` persistent cookie; development uses equivalent settings compatible with HTTP localhost. Data Protection keys persist in App Service's mounted `/home` storage and a local Docker volume so sessions survive container replacement. Provider secrets remain server-side in both environments. Existing session cookies become persistent after the next sign-in.

Register both callback URLs for each provider on the same OAuth application:

| Provider | Production callback | Local callback |
| --- | --- | --- |
| Google | `https://<api-app>.azurewebsites.net/.auth/callback/google` | `http://localhost:5173/.auth/callback/google` |
| Microsoft | `https://<api-app>.azurewebsites.net/.auth/callback/microsoft` | `http://localhost:5173/.auth/callback/microsoft` |

The API owns both environments' callbacks. Vite proxies the localhost callback paths from port 5173 to the API container. The browser starts sign-in at `/.auth/login/google` or `/.auth/login/aad`; those entry points are separate from the callback URIs registered with each provider.

The sign-in screen uses the providers' official light-theme SVG buttons stored under `src/TripPlanner.Web/public/auth`. Keep their artwork and aspect ratios unchanged when adjusting the surrounding layout.

After running `scripts/buildout`, store the four provider values in Azure Key Vault:

```zsh
./scripts/secrets set-auth
./scripts/secrets status
```

The prompts do not echo secret values. `scripts/release` requires `google-client-id`, `google-client-secret`, `microsoft-client-id`, `microsoft-client-secret`, `ignav-api-key`, and `openai-api-key`. The Web App reads the secrets through versionless Key Vault references using its managed identity, so credentials are not copied into Bicep parameters or plain App Service settings. Rotate one value with `./scripts/secrets set microsoft-client-secret` (or another supported name).

The Microsoft provider is restricted to personal Microsoft accounts through the consumer-account issuer. In the Entra application registration, add both Microsoft callback URLs above to the **Web** platform, leave implicit grant options disabled, and grant the delegated Microsoft Graph `User.Read` permission used to retrieve the profile image. Provider secrets must be rotated before their configured expiration.

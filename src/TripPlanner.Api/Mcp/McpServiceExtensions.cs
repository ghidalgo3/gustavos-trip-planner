using System.Security.Cryptography.X509Certificates;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModelContextProtocol.AspNetCore;
using Npgsql;
using OpenIddict.Abstractions;
using OpenIddict.Server;
using OpenIddict.Server.AspNetCore;
using OpenIddict.Validation.AspNetCore;
using TripPlanner.Api.Database;
using TripPlanner.Api.Endpoints;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Options;
using TripPlanner.Api.Telemetry;
using static OpenIddict.Abstractions.OpenIddictConstants;

namespace TripPlanner.Api.Mcp;

public static class McpServiceExtensions
{
    public const string ReadScope = "tripplanner.read";
    public const string WriteScope = "tripplanner.write";
    public const string Policy = "McpUser";
    public const string ClientId = "chatgpt";

    public static void UseMcpSecurity(this WebApplication app)
    {
        var options = app.Services.GetRequiredService<IOptions<McpOptions>>().Value;
        var issuer = new Uri(options.Issuer!);
        app.Use(
            async (context, next) =>
            {
                if (!context.Request.Path.StartsWithSegments("/mcp"))
                {
                    await next();
                    return;
                }
                context.Response.Headers.CacheControl = "no-store";
                context.Response.OnStarting(() =>
                {
                    if (context.Response.StatusCode is 401 or 403)
                    {
                        context.Response.Headers.Append(
                            "WWW-Authenticate",
                            $"Bearer resource_metadata=\"{new Uri(issuer, "/.well-known/oauth-protected-resource/mcp")}\", scope=\"{ReadScope} {WriteScope}\""
                        );
                    }

                    return Task.CompletedTask;
                });
                if (
                    context.Request.Headers.Origin.Count > 0
                    && context.Request.Headers.Origin.ToString()
                        != issuer.GetLeftPart(UriPartial.Authority)
                )
                {
                    context.Response.StatusCode = 403;
                    return;
                }
                await next();
            }
        );
    }

    public static bool AddTripPlannerMcp(this WebApplicationBuilder builder)
    {
        builder.Services.Configure<McpOptions>(
            builder.Configuration.GetSection(McpOptions.SectionName)
        );
        var configuration =
            builder.Configuration.GetSection(McpOptions.SectionName).Get<McpOptions>() ?? new();
        if (!configuration.Enabled)
        {
            return false;
        }

        if (
            !Uri.TryCreate(configuration.Issuer, UriKind.Absolute, out var issuer)
            || (
                issuer.Scheme != "https"
                && !(builder.Environment.IsDevelopment() && issuer.IsLoopback)
            )
        )
        {
            throw new InvalidOperationException(
                "Mcp:Issuer must be the public HTTPS application URL."
            );
        }

        if (
            configuration.RedirectUris.Length == 0
            || configuration.RedirectUris.Any(value =>
                !Uri.TryCreate(value, UriKind.Absolute, out var uri)
                || uri.Scheme != "https"
                || uri.Fragment.Length != 0
            )
        )
        {
            throw new InvalidOperationException(
                "Mcp:RedirectUris must contain exact HTTPS OAuth callback URLs."
            );
        }

        builder.Services.AddAntiforgery();
        builder.Services.AddDbContext<OAuthDbContext>(
            (services, options) =>
                options.UseNpgsql(services.GetRequiredService<NpgsqlDataSource>()).UseOpenIddict()
        );
        builder
            .Services.AddOpenIddict()
            .AddCore(options =>
            {
                options.UseEntityFrameworkCore().UseDbContext<OAuthDbContext>();
                // Revocation must take effect across App Service instances immediately.
                options.DisableEntityCaching();
            })
            .AddServer(options =>
            {
                options.SetIssuer(issuer);
                options.SetAuthorizationEndpointUris("/oauth/authorize");
                options.SetTokenEndpointUris("/oauth/token");
                options.SetRevocationEndpointUris("/oauth/revoke");
                options.AllowAuthorizationCodeFlow().AllowRefreshTokenFlow();
                options.RequireProofKeyForCodeExchange();
                options.RegisterScopes(ReadScope, WriteScope, Scopes.OfflineAccess);
                options.RegisterResources(new Uri(issuer, "/mcp").AbsoluteUri);
                options.Configure(configuration =>
                {
                    configuration.CodeChallengeMethods.Remove(CodeChallengeMethods.Plain);
                    configuration.PromptValues.Clear();
                    configuration.PromptValues.Add(PromptValues.Consent);
                    configuration.PromptValues.Add(PromptValues.None);
                    configuration.ClientAuthenticationMethods.Clear();
                    configuration.ClientAuthenticationMethods.Add(ClientAuthenticationMethods.None);
                });
                options.SetAccessTokenLifetime(TimeSpan.FromMinutes(15));
                options.SetRefreshTokenLifetime(TimeSpan.FromDays(30));
                options.UseReferenceAccessTokens();
                options.AddEventHandler<OpenIddictServerEvents.ApplyAuthorizationResponseContext>(
                    handler =>
                        handler
                            .SetOrder(
                                OpenIddictServerAspNetCoreHandlers
                                    .Authentication
                                    .ProcessFormPostResponse
                                    .Descriptor
                                    .Order - 500
                            )
                            .UseInlineHandler(OAuthEndpoints.ApplyConsentResponseAsync)
                );
                if (!string.IsNullOrWhiteSpace(configuration.Certificate))
                {
                    var certificate = X509CertificateLoader.LoadPkcs12(
                        Convert.FromBase64String(configuration.Certificate),
                        null,
                        X509KeyStorageFlags.EphemeralKeySet
                    );
                    options
                        .AddSigningCertificate(certificate)
                        .AddEncryptionCertificate(certificate);
                }
                else if (builder.Environment.IsDevelopment())
                {
                    options.AddEphemeralSigningKey().AddEphemeralEncryptionKey();
                }
                else
                {
                    throw new InvalidOperationException(
                        "Mcp:Certificate must be a persistent RSA PFX from Key Vault."
                    );
                }

                var host = options
                    .UseAspNetCore()
                    .EnableAuthorizationEndpointPassthrough()
                    .EnableTokenEndpointPassthrough();
                if (builder.Environment.IsDevelopment())
                {
                    host.DisableTransportSecurityRequirement();
                }
            })
            .AddValidation(options =>
            {
                options.UseLocalServer();
                options.AddAudiences(new Uri(issuer, "/mcp").AbsoluteUri);
                options.EnableTokenEntryValidation();
                options.UseAspNetCore();
            });
        builder.Services.AddAuthorization(options =>
            options.AddPolicy(
                Policy,
                policy =>
                    policy
                        .AddAuthenticationSchemes(
                            OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme
                        )
                        .RequireAuthenticatedUser()
                        .RequireAssertion(context =>
                            context.User.HasScope(ReadScope) || context.User.HasScope(WriteScope)
                        )
            )
        );
        builder.Services.AddTransient<McpExecutionAdapter>();
        builder
            .Services.AddMcpServer(options =>
            {
                options.ServerInfo = new() { Name = "TripPlanner", Version = "1.0.0" };
                options.Filters.Request.CallToolFilters.Add(next =>
                    async (request, cancellationToken) =>
                    {
                        if (ValidatedMcpTool.IsKnownTool(request.Params?.Name))
                        {
                            return await next(request, cancellationToken);
                        }
                        // Never put an arbitrary client-supplied tool name into telemetry.
                        return await OperationTelemetry.TraceToolAsync(
                            "unknown_tool",
                            async () => await next(request, cancellationToken),
                            cancellationToken
                        );
                    }
                );
                options.ServerInstructions =
                    "Manage the connected user's trips. Read a resource before replacing it. Destination timezones are derived automatically from city coordinates; use the returned city timezone for planning and do not ask the user to supply one. Use returned IDs and concurrency versions; never invent IDs. Changes appear in the user's Activity Log. "
                    + "Separate activity ideas (what to do) from the activity plan (when to do it). First use create_activity to create an undated idea with its name, place, duration and other details, or reuse an existing idea instead of duplicating it. Do not prefix names with itinerary dates, clock times or day numbers, or use descriptions to encode scheduling. For example, name the idea 'Insadong crafts, tea, and Jogyesa', not 'Dec 30 — Insadong crafts, tea and Jogyesa'. Dates that are part of an event's actual name may remain. "
                    + "If the user requests a date or time, create the idea first, then reread get_activity_plan and place its returned ID using replace_activity_plan: include it in selectedActivityIds and the appropriate days entry with stayId from context.visits, local date and ordered activityIds. stayId identifies the destination visit, not accommodation. Add rules with activityId and fixedDate/fixedStart for requested scheduling anchors. Planned state alone selects an activity; it does not schedule it. Preserve unrelated plan fields and restrictions. "
                    + "Duration and cost research are previews: show sources, estimates and pricing conditions before applying accepted values and their evidence with update_activity. Clear durationEvidence or costEvidence when manually changing the corresponding value. Location proposals are candidate pins, not verified entrances: show the source and request user acceptance before saving their geometry with update_activity. Activity planning proposals are previews: never apply without the user choosing one. Preserve unrelated plan fields and explicit restrictions. Use replace_activity_plan with the proposal ID, choice ID, current ETag and context version to apply a reviewed choice. Reread after 409/412 errors. Poll list_operations/get_operation and retrieve results through the planning tools. Personal preferences always refer to the connected user; other travellers' raw profile preferences are private. Calendar subscription URLs are bearer credentials returned only at creation; do not repeat them in diagnostics.";
            })
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools(ValidatedMcpTool.CreateTools());
        return true;
    }

    public static async Task InitializeMcpAsync(this WebApplication app)
    {
        // Validate keys and protocol options before accepting any traffic.
        _ = app
            .Services.GetRequiredService<IOptions<OpenIddict.Server.OpenIddictServerOptions>>()
            .Value;
        await using var scope = app.Services.CreateAsyncScope();
        var manager = scope.ServiceProvider.GetRequiredService<IOpenIddictApplicationManager>();
        var options = scope.ServiceProvider.GetRequiredService<IOptions<McpOptions>>().Value;
        var descriptor = new OpenIddictApplicationDescriptor
        {
            ClientId = ClientId,
            ClientType = ClientTypes.Public,
            ConsentType = ConsentTypes.Explicit,
            DisplayName = "ChatGPT",
            Permissions =
            {
                Permissions.Endpoints.Authorization,
                Permissions.Endpoints.Token,
                Permissions.Endpoints.Revocation,
                Permissions.GrantTypes.AuthorizationCode,
                Permissions.GrantTypes.RefreshToken,
                Permissions.ResponseTypes.Code,
                Permissions.Prefixes.Scope + ReadScope,
                Permissions.Prefixes.Scope + WriteScope,
                Permissions.Prefixes.Resource
                    + new Uri(new Uri(options.Issuer!), "/mcp").AbsoluteUri,
            },
            Requirements = { Requirements.Features.ProofKeyForCodeExchange },
        };
        foreach (var uri in options.RedirectUris)
        {
            descriptor.RedirectUris.Add(new Uri(uri));
        }

        var existing = await manager.FindByClientIdAsync(ClientId);
        if (existing is null)
        {
            await manager.CreateAsync(descriptor);
        }
        else
        {
            await manager.UpdateAsync(existing, descriptor);
        }
    }
}

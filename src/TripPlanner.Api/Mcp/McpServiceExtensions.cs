using System.Security.Cryptography.X509Certificates;
using Microsoft.AspNetCore.Authentication.Cookies;
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
using TripPlanner.Api.Instructions;
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

        foreach (var client in configuration.NativeClients)
        {
            if (
                string.IsNullOrWhiteSpace(client.ClientId)
                || client.ClientId == ClientId
                || client.RedirectUris.Length == 0
                || configuration.NativeClients.Count(c => c.ClientId == client.ClientId) != 1
                || client.RedirectUris.Any(value =>
                    !Uri.TryCreate(value, UriKind.Absolute, out var uri)
                    || uri.Fragment.Length > 0
                    || uri.Scheme is "javascript" or "data" or "file"
                    || uri.Scheme == "http"
                        && !(builder.Environment.IsDevelopment() && uri.IsLoopback)
                )
            )
            {
                throw new InvalidOperationException(
                    "Native OAuth clients require unique IDs and exact HTTPS, private-scheme, or development loopback callback URIs."
                );
            }
        }

        builder
            .Services.AddAuthentication(auth =>
            {
                auth.DefaultAuthenticateScheme = "TripPlannerClient";
                auth.DefaultChallengeScheme = "TripPlannerClient";
                auth.DefaultForbidScheme = "TripPlannerClient";
            })
            .AddPolicyScheme(
                "TripPlannerClient",
                "Cookie or native bearer",
                options =>
                {
                    options.ForwardDefaultSelector = context =>
                        context
                            .Request.Headers.Authorization.ToString()
                            .StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                            ? OpenIddictValidationAspNetCoreDefaults.AuthenticationScheme
                            : CookieAuthenticationDefaults.AuthenticationScheme;
                }
            );

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
                options.RegisterResources(
                    new Uri(issuer, "/mcp").AbsoluteUri,
                    new Uri(issuer, "/api").AbsoluteUri
                );
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
                options.AddAudiences(
                    new Uri(issuer, "/mcp").AbsoluteUri,
                    new Uri(issuer, "/api").AbsoluteUri
                );
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
                            context.User.HasAudience(new Uri(issuer, "/mcp").AbsoluteUri)
                            && (
                                context.User.HasScope(ReadScope)
                                || context.User.HasScope(WriteScope)
                            )
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
                options.ServerInstructions = McpInstructions.ServerInstructions;
            })
            .WithHttpTransport(options => options.SessionMode = HttpServerSessionMode.Stateless)
            .WithTools(ValidatedMcpTool.CreateTools())
            .WithPrompts<TravelPlanningPrompts>();
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
        foreach (var client in options.NativeClients)
        {
            var native = new OpenIddictApplicationDescriptor
            {
                ClientId = client.ClientId,
                ClientType = ClientTypes.Public,
                ConsentType = ConsentTypes.Explicit,
                DisplayName = client.DisplayName,
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
                        + new Uri(new Uri(options.Issuer!), "/api").AbsoluteUri,
                },
                Requirements = { Requirements.Features.ProofKeyForCodeExchange },
            };
            foreach (var redirect in client.RedirectUris)
            {
                native.RedirectUris.Add(new Uri(redirect));
            }
            var registered = await manager.FindByClientIdAsync(client.ClientId);
            if (registered is null)
            {
                await manager.CreateAsync(native);
            }
            else
            {
                await manager.UpdateAsync(registered, native);
            }
        }
    }
}

using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using OpenIddict.Abstractions;
using OpenIddict.Validation.AspNetCore;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Mcp;
using TripPlanner.Api.Options;
using AuthenticationOptions = TripPlanner.Api.Options.AuthenticationOptions;
using AuthenticationSchemeOptions = Microsoft.AspNetCore.Authentication.AuthenticationSchemeOptions;

namespace TripPlanner.Api.Authentication;

public static class AuthenticationServiceExtensions
{
    public const string CurrentUserPolicy = "CurrentUser";

    public static bool AddTripPlannerAuthentication(this WebApplicationBuilder builder)
    {
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<ICurrentUser, CurrentUser>();
        builder.Services.AddAuthentication();
        builder.Services.AddAuthorization(options =>
            options.AddPolicy(
                CurrentUserPolicy,
                policy =>
                    policy.RequireAssertion(async context =>
                        AuthenticatedUserProfile.FromPrincipal(context.User) is not null
                        && await AllowsRestAccessAsync(context)
                    )
            )
        );
        builder.Services.Configure<AuthenticationOptions>(
            builder.Configuration.GetSection(AuthenticationOptions.SectionName)
        );
        AuthenticationOptions options =
            builder
                .Configuration.GetSection(AuthenticationOptions.SectionName)
                .Get<AuthenticationOptions>()
            ?? new();
        ReviewerAccess.Validate(
            options,
            builder.Configuration.GetValue<bool>($"{McpOptions.SectionName}:Enabled")
        );

        if (options.UseAppServiceAuthentication)
        {
            builder
                .Services.AddAuthentication(AppServiceAuthenticationHandler.SchemeName)
                .AddScheme<AuthenticationSchemeOptions, AppServiceAuthenticationHandler>(
                    AppServiceAuthenticationHandler.SchemeName,
                    configureOptions: null
                );
            // The App Service front end owns /.auth/login and /.auth/logout.
            return false;
        }

        if (options.HasAnyProviderSetting && !options.IsEnabled)
        {
            throw new InvalidOperationException(
                "Google and Microsoft client IDs and secrets must all be configured together."
            );
        }

        if (!string.IsNullOrWhiteSpace(options.DataProtectionKeysPath))
        {
            Directory.CreateDirectory(options.DataProtectionKeysPath);
            builder
                .Services.AddDataProtection()
                .SetApplicationName("TripPlanner.Api")
                .PersistKeysToFileSystem(new DirectoryInfo(options.DataProtectionKeysPath));
        }

        if (!options.IsEnabled)
        {
            return false;
        }

        builder
            .Services.AddAuthentication(auth =>
            {
                auth.DefaultAuthenticateScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                auth.DefaultSignInScheme = CookieAuthenticationDefaults.AuthenticationScheme;
                auth.DefaultChallengeScheme = CookieAuthenticationDefaults.AuthenticationScheme;
            })
            .AddCookie(cookie =>
            {
                cookie.Cookie.Name = "tripplanner.auth";
                cookie.Cookie.HttpOnly = true;
                cookie.Cookie.SameSite = SameSiteMode.Lax;
                cookie.ExpireTimeSpan = TimeSpan.FromDays(30);
                cookie.SlidingExpiration = true;
                // REST callers receive status codes, never an HTML login redirect.
                cookie.Events.OnRedirectToLogin = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                    return Task.CompletedTask;
                };
                cookie.Events.OnRedirectToAccessDenied = context =>
                {
                    context.Response.StatusCode = StatusCodes.Status403Forbidden;
                    return Task.CompletedTask;
                };
                cookie.Events.OnValidatePrincipal = async context =>
                {
                    if (!ReviewerAccess.Allows(options.ReviewerAccess, context.Principal))
                    {
                        context.RejectPrincipal();
                        await context.HttpContext.SignOutAsync(context.Scheme.Name);
                    }
                };
                cookie.Cookie.SecurePolicy = builder.Environment.IsDevelopment()
                    ? CookieSecurePolicy.SameAsRequest
                    : CookieSecurePolicy.Always;
            })
            .AddGoogle(
                "google",
                google =>
                {
                    google.ClientId = options.Google.ClientId!;
                    google.ClientSecret = options.Google.ClientSecret!;
                    google.CallbackPath = "/.auth/callback/google";
                    google.SaveTokens = true;
                    google.CorrelationCookie.SameSite = SameSiteMode.Lax;
                    google.CorrelationCookie.SecurePolicy = builder.Environment.IsDevelopment()
                        ? CookieSecurePolicy.SameAsRequest
                        : CookieSecurePolicy.Always;
                    google.Events.OnCreatingTicket = context =>
                    {
                        AddProviderClaim(context.Principal?.Identity, "google");
                        if (options.ReviewerAccess.Required)
                        {
                            ReviewerAccess.AddVerifiedGoogleEmail(context.Principal, context.User);
                        }
                        return Task.CompletedTask;
                    };
                    google.Events.OnTicketReceived = EnforceReviewerAccess;
                }
            )
            .AddOpenIdConnect(
                "aad",
                microsoft =>
                {
                    microsoft.Authority =
                        "https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0";
                    microsoft.ClientId = options.Microsoft.ClientId!;
                    microsoft.ClientSecret = options.Microsoft.ClientSecret!;
                    microsoft.CallbackPath = "/.auth/callback/microsoft";
                    microsoft.ResponseType = "code";
                    microsoft.ResponseMode = "query";
                    microsoft.SaveTokens = true;
                    microsoft.CorrelationCookie.SameSite = SameSiteMode.Lax;
                    microsoft.CorrelationCookie.SecurePolicy = builder.Environment.IsDevelopment()
                        ? CookieSecurePolicy.SameAsRequest
                        : CookieSecurePolicy.Always;
                    microsoft.NonceCookie.SameSite = SameSiteMode.Lax;
                    microsoft.NonceCookie.SecurePolicy = builder.Environment.IsDevelopment()
                        ? CookieSecurePolicy.SameAsRequest
                        : CookieSecurePolicy.Always;
                    microsoft.Scope.Add("email");
                    microsoft.Scope.Add("User.Read");
                    microsoft.TokenValidationParameters.NameClaimType = "name";
                    microsoft.Events.OnTokenValidated = AddMicrosoftProviderClaim;
                    microsoft.Events.OnTicketReceived = EnforceReviewerAccess;
                }
            );

        return true;

        async Task EnforceReviewerAccess(TicketReceivedContext context)
        {
            if (!ReviewerAccess.Allows(options.ReviewerAccess, context.Principal))
            {
                context.HandleResponse();
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                context.Response.Headers.CacheControl = "no-store";
                context.Response.ContentType = "text/plain; charset=utf-8";
                string message = "This account is not approved for the test environment.";
                if (ReviewerAccess.GetMicrosoftObjectId(context.Principal) is { } objectId)
                {
                    message += $" Your Microsoft account object ID is {objectId}.";
                }
                await context.Response.WriteAsync(message, context.HttpContext.RequestAborted);
            }
        }
    }

    private static async Task<bool> AllowsRestAccessAsync(AuthorizationHandlerContext context)
    {
        if (
            context.Resource is not HttpContext http
            || !http
                .Request.Headers.Authorization.ToString()
                .StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
        )
        {
            return true;
        }
        var options = http.RequestServices.GetRequiredService<IOptions<McpOptions>>().Value;
        if (!options.Enabled || !Uri.TryCreate(options.Issuer, UriKind.Absolute, out var issuer))
        {
            return false;
        }
        if (
            !Guid.TryParse(
                context.User.GetClaim(OpenIddictConstants.Claims.Subject),
                out var subject
            )
            || await http
                .RequestServices.GetRequiredService<TripPlanner.Api.Database.IPlannerDb>()
                .GetUserAsync(subject, http.RequestAborted)
                is not { } user
            || !string.Equals(
                user.Email,
                AuthenticatedUserProfile.FromPrincipal(context.User)?.Email,
                StringComparison.OrdinalIgnoreCase
            )
        )
        {
            return false;
        }
        bool read =
            HttpMethods.IsGet(http.Request.Method) || HttpMethods.IsHead(http.Request.Method);
        return context.User.HasAudience(new Uri(issuer, "/api").AbsoluteUri)
            && (
                context.User.HasScope(McpServiceExtensions.WriteScope)
                || read && context.User.HasScope(McpServiceExtensions.ReadScope)
            );
    }

    private static Task AddMicrosoftProviderClaim(TokenValidatedContext context)
    {
        AddProviderClaim(context.Principal?.Identity, "microsoft");
        return Task.CompletedTask;
    }

    private static void AddProviderClaim(
        System.Security.Principal.IIdentity? identity,
        string provider
    )
    {
        if (identity is ClaimsIdentity claimsIdentity)
        {
            claimsIdentity.AddClaim(new Claim("provider", provider));
        }
    }
}

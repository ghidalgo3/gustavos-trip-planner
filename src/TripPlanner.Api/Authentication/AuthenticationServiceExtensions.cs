using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication.OAuth;
using Microsoft.AspNetCore.Authentication.OpenIdConnect;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.Extensions.Options;
using TripPlanner.Api.Authentication;
using TripPlanner.Api.Options;

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
                    policy.RequireAssertion(context =>
                        AuthenticatedUserProfile.FromPrincipal(context.User) is not null
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
                    google.Events.OnCreatingTicket = AddGoogleProviderClaim;
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
                }
            );

        return true;
    }

    private static Task AddGoogleProviderClaim(OAuthCreatingTicketContext context)
    {
        AddProviderClaim(context.Principal?.Identity, "google");
        return Task.CompletedTask;
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

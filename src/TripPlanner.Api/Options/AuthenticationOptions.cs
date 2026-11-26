namespace TripPlanner.Api.Options;

public sealed class AuthenticationOptions
{
    public const string SectionName = "Authentication";

    public bool UseAppServiceAuthentication { get; init; }

    public bool LocalUsersEnabled { get; init; }

    public OAuthProviderOptions Google { get; init; } = new();

    public OAuthProviderOptions Microsoft { get; init; } = new();

    public ReviewerAccessOptions ReviewerAccess { get; init; } = new();

    public string? DataProtectionKeysPath { get; init; }

    public bool IsEnabled =>
        !string.IsNullOrWhiteSpace(Google.ClientId)
        && !string.IsNullOrWhiteSpace(Google.ClientSecret)
        && !string.IsNullOrWhiteSpace(Microsoft.ClientId)
        && !string.IsNullOrWhiteSpace(Microsoft.ClientSecret);

    public bool HasAnyProviderSetting =>
        !string.IsNullOrWhiteSpace(Google.ClientId)
        || !string.IsNullOrWhiteSpace(Google.ClientSecret)
        || !string.IsNullOrWhiteSpace(Microsoft.ClientId)
        || !string.IsNullOrWhiteSpace(Microsoft.ClientSecret);
}

public sealed class ReviewerAccessOptions
{
    public bool Required { get; init; }

    public string[] GoogleEmails { get; init; } = [];

    public Guid[] MicrosoftObjectIds { get; init; } = [];
}

public sealed class OAuthProviderOptions
{
    public string? ClientId { get; init; }

    public string? ClientSecret { get; init; }
}

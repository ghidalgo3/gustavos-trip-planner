namespace TripPlanner.Api.Options;

public sealed class McpOptions
{
    public const string SectionName = "Mcp";
    public bool Enabled { get; init; }
    public string? Issuer { get; init; }
    public string? Certificate { get; init; }
    public string[] RedirectUris { get; init; } =
    ["https://chatgpt.com/connector_platform_oauth_redirect"];
    public PublicOAuthClient[] AgentClients { get; init; } = [];
    public PublicOAuthClient[] NativeClients { get; init; } = [];
}

public sealed class PublicOAuthClient
{
    public string ClientId { get; init; } = "";
    public string DisplayName { get; init; } = "TripPlanner mobile";
    public string[] RedirectUris { get; init; } = [];
}

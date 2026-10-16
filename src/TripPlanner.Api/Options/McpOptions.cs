namespace TripPlanner.Api.Options;

public sealed class McpOptions
{
    public const string SectionName = "Mcp";
    public bool Enabled { get; init; }
    public string? Issuer { get; init; }
    public string? Certificate { get; init; }
    public string[] RedirectUris { get; init; } =
    ["https://chatgpt.com/connector_platform_oauth_redirect"];
}

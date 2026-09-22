namespace TripPlanner.Api.Options;

public sealed class WebOptions
{
    public const string ClientOriginsSectionName = "ClientOrigins";

    public string[] ClientOrigins { get; set; } = ["http://localhost:5173"];
}

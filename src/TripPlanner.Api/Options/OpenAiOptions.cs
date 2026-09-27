namespace TripPlanner.Api.Options;

public sealed class OpenAiOptions
{
    public const string SectionName = "OpenAI";
    public string? ApiKey { get; init; }
    public string Model { get; init; } = "gpt-6-luna";
}

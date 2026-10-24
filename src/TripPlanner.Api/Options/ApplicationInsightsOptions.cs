using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.Options;

public sealed class ApplicationInsightsOptions
{
    public const string SectionName = "ApplicationInsights";

    [MaxLength(4096)]
    public string? ConnectionString { get; set; }
}

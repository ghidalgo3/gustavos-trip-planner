using System.ComponentModel;
using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Spatial;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Instructions;
using TripPlanner.Api.Serialization;

namespace TripPlanner.Api.Models;

public sealed record GeoJsonPoint(
    [property: AllowedValues("Point")] string Type,
    [property:
        Coordinates,
        JsonPropertyName("coordinates"),
        JsonConverter(typeof(CoordinatesConverter))
    ]
        GeographyPoint Position
);

public sealed record GeoJsonFeature<T>(
    string Type,
    string Id,
    GeoJsonPoint? Geometry,
    T Properties
);

public sealed record GeoJsonCollection<T>(
    string Type,
    IReadOnlyList<GeoJsonFeature<T>> Features,
    IReadOnlyList<DestinationRouteItem>? Route = null
);

public sealed record DestinationRouteItem(string DestinationId, Guid StayId);

public sealed record DestinationStay(
    Guid Id,
    int Order,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    string ArrivalAt,
    string DepartureAt
)
{
    public GeoJsonFeature<StayLocationProperties>? StayLocation { get; init; }
}

public sealed record DestinationVisit(
    Guid TripId,
    string CityId,
    Guid StayId,
    int Order,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate
);

public sealed record DestinationProperties(
    string Name,
    string CountryCode,
    string? TimeZone,
    string ContextVersion,
    DateOnly? ArrivalDate,
    DateOnly? DepartureDate,
    IReadOnlyList<DestinationStay> Stays,
    bool IsActive = true
)
{
    public JsonElement Constraints { get; init; } = JsonSerializer.SerializeToElement(new { });
}

public sealed record DestinationPlace(
    Guid TripId,
    string CityId,
    string Name,
    string CountryCode,
    string TimeZone,
    double Longitude,
    double Latitude,
    string ContextVersion = ""
)
{
    public JsonElement Constraints { get; init; } = JsonSerializer.SerializeToElement(new { });
}

public sealed record ActivityCost(
    [property: JsonRequired, Range(typeof(decimal), "0", "79228162514264337593543950335")]
        decimal Amount,
    [property: Required, RegularExpression("^[A-Za-z]{3}$")] string Currency,
    [property: AllowedValues("perPerson", "total")] string Basis
);

public sealed record ActivityLink(
    [property: HttpUrl, StringLength(2048, MinimumLength = 1)] string Url,
    [property: StringLength(200)] string? Label = null
);

public sealed record ActivityProperties(
    [property:
        Required,
        StringLength(200, MinimumLength = 1),
        Description(McpInstructions.Fields.ActivityName)
    ]
        string Name,
    [property: DurationRange(1, 10080), JsonConverter(typeof(IsoDurationConverter))]
        TimeSpan? Duration,
    [property: StringLength(10000), Description(McpInstructions.Fields.ActivityDescription)]
        string Description,
    ActivityCost? Cost,
    [property:
        JsonRequired,
        EnumDataType(typeof(ActivityState)),
        Description(McpInstructions.Fields.ActivityState)
    ]
        ActivityState State,
    [property:
        Required,
        StringItems(@"\S", 200),
        UniqueItems,
        Description(McpInstructions.Fields.ActivityKinds)
    ]
        IReadOnlyList<string> Kinds,
    [property: StringLength(200)] string? PlaceName = null
)
{
    [Required(AllowEmptyStrings = true), StringLength(10000)]
    [Description(McpInstructions.Fields.ActivityNotes)]
    public string Notes { get; init; } = "";

    [StringLength(2000)]
    [Description(McpInstructions.Fields.ActivityAddress)]
    public string? Address { get; init; }

    [Required, AllowedValues("Unknown", "Required", "NotRequired")]
    [Description(McpInstructions.Fields.TicketRequirement)]
    public string TicketRequirement { get; init; } = "Unknown";

    [MaxLength(20)]
    public IReadOnlyList<ActivityLink> Links { get; init; } = [];

    public ActivityResearchEvidence? DurationEvidence { get; init; }
    public ActivityResearchEvidence? CostEvidence { get; init; }

    public ActivityLocationSuggestion? LocationSuggestion { get; init; }

    [Description(McpInstructions.Fields.LocationVerification)]
    public ActivityLocationVerification? LocationVerification { get; init; }
}

[JsonConverter(typeof(StringEnumConverter<ActivityLocationPrecision>))]
public enum ActivityLocationPrecision
{
    VerifiedEntrance,
    VerifiedVenue,
    RepresentativeArea,
    Unresolved,
    Nonphysical,
}

public sealed record ActivityLocationVerification(
    [property: JsonRequired, EnumDataType(typeof(ActivityLocationPrecision))]
        ActivityLocationPrecision Precision,
    [property: StringLength(2000), Description(McpInstructions.Fields.LocationVerificationMethod)]
        string? Method,
    [property:
        StringLength(2000),
        Description(
            "Remaining uncertainty, or the specific reason an Unresolved entry lacks a reliable location."
        )
    ]
        string? Uncertainty,
    [property:
        Required,
        MaxLength(20),
        UniqueItems,
        Description(McpInstructions.Fields.LocationVerificationSources)
    ]
        IReadOnlyList<string> SourceUrls
);

public sealed record ActivityResearchEvidence(
    [property: Required, StringLength(2000)] string Notes,
    [property: Required] ActivityLink Source,
    DateTimeOffset ResearchedAt
);

// A researched point is separate from Geometry until the user accepts it.
public sealed record ActivityLocationSuggestion(
    [property: Required, StringLength(200)] string VenueName,
    [property: Required] GeoJsonPoint Geometry,
    [property: Required] ActivityLink Source,
    DateTimeOffset RetrievedAt
);

public sealed record Activity(
    Guid Id,
    Guid TripId,
    string CityId,
    GeoJsonPoint? Geometry,
    ActivityProperties Properties,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    Guid? SourceOperationId = null
)
{
    public GeoJsonFeature<ActivityProperties> ToFeature() =>
        new("Feature", Id.ToString("D"), Geometry, Properties);
}

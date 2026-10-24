using System.Text.Json;
using TripPlanner.Api.Database;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Destinations;

namespace TripPlanner.Api.Services.Flights;

public sealed class DestinationFlightPlanning(
    IPlannerDb database,
    DestinationService destinations,
    AirportCatalog airports
)
{
    public async Task<PlanningDocument> GetAsync(Guid viewerId, Trip trip, CancellationToken token)
    {
        var saved = PlanningDocument.FromJson(trip.FlightConstraints);
        var snapshot = await destinations.GetAsync(viewerId, trip, token);
        if (snapshot.Collection.Features.Count == 0)
        {
            return saved; // Preserve the existing API contract for older flight-only trips.
        }

        var owner = await database.GetUserAsync(trip.OwnerUserId, token);
        var parties = await database.GetPartiesAsync(viewerId, trip.Id, token);
        var visits = snapshot
            .Collection.Features.SelectMany(city =>
                city.Properties.Stays.Select(stay => new { City = city, Stay = stay })
            )
            .OrderBy(item => item.Stay.ArrivalDate ?? item.Stay.DepartureDate ?? DateOnly.MaxValue)
            .ThenBy(item => item.Stay.Order)
            .ToArray();
        var planned = visits
            .Select(
                (item, index) =>
                {
                    var point = item.City.Geometry!.Position;
                    var nearby = airports
                        .HomeAirports(
                            new(item.City.Properties.Name, point.Longitude, point.Latitude)
                        )
                        .Where(airport =>
                            airport.Country.Equals(
                                item.City.Properties.CountryCode,
                                StringComparison.OrdinalIgnoreCase
                            )
                        )
                        .ToArray();
                    SearchLocation? location =
                        nearby.Length == 0
                            ? null
                            : new(
                                nearby[0].Code,
                                nearby[0].TimeZone,
                                item.City.Properties.Name,
                                nearby.Select(airport => airport.Code).ToArray()
                            );
                    var constraints = item.City.Properties.Constraints;
                    return new PlannedVisit
                    {
                        Id = item.Stay.Id,
                        Location = location,
                        PresentFrom = item.Stay.ArrivalDate,
                        PresentThrough = item.Stay.DepartureDate,
                        ArrivalFlexibilityDays = Flexibility(constraints, "arrivalFlexibilityDays"),
                        DepartureFlexibilityDays = Flexibility(
                            constraints,
                            "departureFlexibilityDays"
                        ),
                        AfterVisitIds = index > 0 ? [visits[index - 1].Stay.Id] : [],
                    };
                }
            )
            .ToArray();
        int span =
            visits
                .Where(item => item.Stay.DepartureDate is not null)
                .Select(item => item.Stay.DepartureDate!.Value.DayNumber)
                .DefaultIfEmpty(0)
                .Max()
            - visits
                .Where(item => item.Stay.ArrivalDate is not null)
                .Select(item => item.Stay.ArrivalDate!.Value.DayNumber)
                .DefaultIfEmpty(0)
                .Min();
        return saved with
        {
            Destination = null,
            TravelDates = null,
            Visits = planned,
            SearchLimits = new()
            {
                FlexibilityDays = 0,
                MaxTripDays = Math.Clamp(Math.Max(span + 14, planned.Length + 1), 21, 36890),
            },
            AiPrompt = null,
            Constraints = saved
                .Constraints.Where(constraint =>
                    constraint.Type is "nonstop" or "avoidLayover" or "travelTogether"
                )
                .ToArray(),
            Parties = parties
                .Select(party =>
                {
                    var settings =
                        saved.Parties.FirstOrDefault(item => item.PartyId == party.Id)
                        ?? new PartySearchSettings
                        {
                            PartyId = party.Id,
                            PreferredAirlines = owner?.PreferredAirlines ?? [],
                        };
                    return settings with
                    {
                        Origin = owner is null ? null : airports.SuggestOrigin([owner]),
                        PreferredAirport = owner?.PreferredAirport,
                    };
                })
                .ToArray(),
        };
    }

    private static int Flexibility(JsonElement constraints, string name) =>
        constraints.ValueKind == JsonValueKind.Object
        && constraints.TryGetProperty(name, out var value)
            ? value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out int days)
                ? days
                : -1
            : 0;
}

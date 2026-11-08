using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Spatial;
using TripPlanner.Api.Database;
using TripPlanner.Api.DTO;
using TripPlanner.Api.Models;
using TripPlanner.Api.Services.Maps;

namespace TripPlanner.Api.Services.Destinations;

public sealed record DestinationSnapshot(GeoJsonCollection<DestinationProperties> Collection)
{
    public GeoJsonFeature<DestinationProperties>? Find(string cityId) =>
        Collection.Features.FirstOrDefault(f => f.Id == cityId);
}

public sealed class DestinationService(IPlannerDb database, IAzureMapsClient maps)
{
    public async Task<DestinationSnapshot> GetAsync(
        Guid viewerUserId,
        Trip trip,
        CancellationToken cancellationToken
    )
    {
        var stayLocations = await database.GetStayLocationsAsync(
            viewerUserId,
            trip.Id,
            cancellationToken
        );
        var visits = await database.GetDestinationVisitsAsync(
            viewerUserId,
            trip.Id,
            cancellationToken
        );
        var places = await database.GetDestinationPlacesAsync(
            viewerUserId,
            trip.Id,
            cancellationToken
        );
        // Fill older missing zones in the representation without making a GET mutate shared data.
        places = await Task.WhenAll(
            places.Select(place => ResolveTimeZoneAsync(place, cancellationToken))
        );
        return Describe(places, visits, stayLocations);
    }

    public static DestinationSnapshot Describe(
        IReadOnlyList<DestinationPlace> places,
        IReadOnlyList<DestinationVisit> visits,
        IReadOnlyDictionary<Guid, GeoJsonFeature<StayLocationProperties>> stayLocations
    )
    {
        var features = visits
            .GroupBy(v => v.CityId)
            .Select(group =>
            {
                var place = places.Single(p => p.CityId == group.Key);
                var stays = group
                    .OrderBy(v => v.Order)
                    .Select(v => new DestinationStay(
                        v.StayId,
                        v.Order,
                        v.ArrivalDate,
                        v.DepartureDate,
                        v.ArrivalDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? "",
                        v.DepartureDate?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) ?? ""
                    )
                    {
                        StayLocation = stayLocations.GetValueOrDefault(v.StayId),
                    })
                    .ToArray();
                return new GeoJsonFeature<DestinationProperties>(
                    "Feature",
                    place.CityId,
                    new(
                        "Point",
                        GeographyPoint.Create(latitude: place.Latitude, longitude: place.Longitude)
                    ),
                    new(
                        place.Name,
                        place.CountryCode,
                        string.IsNullOrEmpty(place.TimeZone) ? null : place.TimeZone,
                        place.ContextVersion,
                        stays.Length == 1 ? stays[0].ArrivalDate : null,
                        stays.Length == 1 ? stays[0].DepartureDate : null,
                        stays
                    )
                    {
                        Constraints = place.Constraints,
                    }
                );
            })
            .ToArray();
        var route = visits
            .OrderBy(v => v.Order)
            .Select(v => new DestinationRouteItem(v.CityId, v.StayId))
            .ToArray();
        return new(new("FeatureCollection", features, route));
    }

    public async Task<DestinationPlace> ResolveTimeZoneAsync(
        DestinationPlace place,
        CancellationToken cancellationToken
    )
    {
        if (!string.IsNullOrWhiteSpace(place.TimeZone))
        {
            return place;
        }
        string? zone = await maps.ResolveTimeZoneAsync(
            GeographyPoint.Create(place.Latitude, place.Longitude),
            cancellationToken
        );
        return place with { TimeZone = zone ?? "" };
    }

    public async Task<DestinationVisit> AddAsync(
        Guid ownerUserId,
        Trip trip,
        DestinationVisitInput input,
        CancellationToken cancellationToken
    )
    {
        DestinationVisitDates.Validate(
            await database.GetDestinationVisitsAsync(ownerUserId, trip.Id, cancellationToken),
            input.ArrivalDate,
            input.DepartureDate
        );
        string city = input.Name.Trim(),
            country = input.CountryCode.Trim().ToUpperInvariant();
        string cityId = CityId(city, country);
        GeoJsonPoint? suppliedPoint =
            input.Longitude is { } longitude && input.Latitude is { } latitude
                ? new("Point", GeographyPoint.Create(latitude: latitude, longitude: longitude))
                : null;
        DestinationPlace? place;
        if (suppliedPoint is not null)
        {
            var places = await database.GetDestinationPlacesAsync(
                ownerUserId,
                trip.Id,
                cancellationToken
            );
            place = places.FirstOrDefault(candidate =>
                candidate.Name.Equals(city, StringComparison.OrdinalIgnoreCase)
                && candidate.CountryCode.Equals(country, StringComparison.OrdinalIgnoreCase)
                && DistanceKm(candidate, suppliedPoint) < 10
            );
            if (place is null && places.Any(candidate => candidate.CityId == cityId))
            {
                cityId = $"{cityId}-{CoordinateSuffix(suppliedPoint)}";
            }
        }
        else
        {
            place = await database.GetDestinationPlaceAsync(
                ownerUserId,
                trip.Id,
                cityId,
                cancellationToken
            );
        }
        if (place is null)
        {
            GeoJsonPoint? point = suppliedPoint is not null
                ? suppliedPoint
                : await maps.GeocodeCityAsync(city, country, cancellationToken);
            if (point is null)
            {
                throw new InvalidOperationException("The destination city could not be located.");
            }

            string? timeZone = string.IsNullOrWhiteSpace(input.TimeZone)
                ? await maps.ResolveTimeZoneAsync(point.Position, cancellationToken)
                : input.TimeZone.Trim();
            place = await database.SaveDestinationPlaceAsync(
                ownerUserId,
                new(
                    trip.Id,
                    cityId,
                    city,
                    country,
                    timeZone ?? "",
                    point.Position.Longitude,
                    point.Position.Latitude
                )
                {
                    Constraints =
                        input.Constraints?.Clone() ?? JsonSerializer.SerializeToElement(new { }),
                },
                cancellationToken
            );
        }
        cityId = place.CityId;
        var visit = new DestinationVisit(
            trip.Id,
            cityId,
            Guid.NewGuid(),
            0,
            input.ArrivalDate,
            input.DepartureDate
        );
        return await database.AddDestinationVisitAsync(ownerUserId, visit, cancellationToken)
            ?? throw new InvalidOperationException("The trip could not be updated.");
    }

    private static string CityId(string city, string country)
    {
        string ascii = city.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder();
        foreach (char ch in ascii)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            if (char.IsAsciiLetterOrDigit(ch))
            {
                builder.Append(char.ToLowerInvariant(ch));
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }
        return $"{builder.ToString().Trim('-')}-{country.ToLowerInvariant()}";
    }

    private static double DistanceKm(DestinationPlace place, GeoJsonPoint point)
    {
        double firstLatitude = place.Latitude * Math.PI / 180;
        double secondLatitude = point.Position.Latitude * Math.PI / 180;
        double latitudeDelta = secondLatitude - firstLatitude;
        double longitudeDelta = (point.Position.Longitude - place.Longitude) * Math.PI / 180;
        double haversine =
            Math.Pow(Math.Sin(latitudeDelta / 2), 2)
            + Math.Cos(firstLatitude)
                * Math.Cos(secondLatitude)
                * Math.Pow(Math.Sin(longitudeDelta / 2), 2);
        return 6371 * 2 * Math.Asin(Math.Min(1, Math.Sqrt(haversine)));
    }

    private static string CoordinateSuffix(GeoJsonPoint point)
    {
        string coordinates = string.Create(
            CultureInfo.InvariantCulture,
            $"{point.Position.Longitude:F4},{point.Position.Latitude:F4}"
        );
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes(coordinates));
        return Convert.ToHexString(hash.AsSpan(0, 4)).ToLowerInvariant();
    }
}

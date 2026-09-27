using System.Globalization;
using System.Text;
using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

public sealed record Airport(
    string Code,
    string Name,
    string City,
    string Country,
    double Latitude,
    double Longitude,
    string TimeZone,
    bool Major,
    string Keywords
)
{
    public SearchLocation Location => new(Code, TimeZone, $"{City} · {Name} ({Code})");
}

public sealed class AirportCatalog
{
    private readonly Airport[] _airports;
    private readonly (Airport Airport, string Text, string City)[] _search;

    public AirportCatalog()
    {
        using var stream = typeof(AirportCatalog).Assembly.GetManifestResourceStream(
            "TripPlanner.Api.Data.airports.json"
        )!;
        _airports = JsonSerializer.Deserialize<Airport[]>(stream, JsonSerializerOptions.Web)!;
        _search = _airports
            .Select(a =>
                (
                    a,
                    Normalize($"{a.Code} {a.Name} {a.City} {a.Country} {a.Keywords}"),
                    Normalize(a.City)
                )
            )
            .ToArray();
    }

    public IReadOnlyList<Airport> Search(string query)
    {
        query = Normalize(query.Trim());
        if (query.Length is < 2 or > 100)
            return [];
        var words = query.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return _search
            .Where(a => words.All(a.Text.Contains))
            .OrderBy(a =>
                a.Airport.Code.Equals(query, StringComparison.OrdinalIgnoreCase) ? 0
                : a.City == query ? 1
                : a.City.StartsWith(query, StringComparison.Ordinal) ? 2
                : 3
            )
            .ThenByDescending(a => a.Airport.Major)
            .ThenBy(a => a.Airport.Code)
            .Take(12)
            .Select(a => a.Airport)
            .ToArray();
    }

    public SearchLocation? Resolve(string query)
    {
        var normalized = Normalize(query.Trim());
        var exactAirport = _airports.FirstOrDefault(a => Normalize(a.Code) == normalized);
        if (exactAirport is not null)
            return exactAirport.Location;
        var cityAirport = _airports.FirstOrDefault(a => MatchesCity(a.City, normalized));
        if (cityAirport is not null)
            return CityLocation(cityAirport);
        return Search(query).FirstOrDefault()?.Location;
    }

    public SearchLocation? SuggestOrigin(IReadOnlyList<User> members)
    {
        if (
            members.Count == 0
            || members.Any(m =>
                m.HomeCityLocation is null || string.IsNullOrWhiteSpace(m.HomeCityName)
            )
        )
            return null;
        // Different home cities need an explicit shared departure choice.
        if (members.Select(m => Normalize(m.HomeCityName!)).Distinct().Count() != 1)
            return null;
        var point = members.OrderBy(m => m.Id).First().HomeCityLocation!;
        var nearby = _airports
            .Select(a => (Airport: a, Km: Distance(point, a)))
            .Where(a => a.Km <= 250)
            .ToArray();
        var nearest = nearby
            .OrderBy(a => a.Airport.Major && a.Km <= 75 ? 0 : 1)
            .ThenBy(a => a.Km)
            .ThenBy(a => a.Airport.Code)
            .FirstOrDefault()
            .Airport;
        return nearest is null ? null
            : string.IsNullOrWhiteSpace(nearest.City) ? nearest.Location
            : CityLocation(nearest);
    }

    private SearchLocation CityLocation(Airport airport)
    {
        if (string.IsNullOrWhiteSpace(airport.City))
            return airport.Location;
        var codes = _airports
            .Where(a =>
                MatchesCity(a.City, Normalize(airport.City).Split('(', ',')[0].Trim())
                && a.Country == airport.Country
            )
            .OrderByDescending(a => a.Major)
            .ThenBy(a => a.Code)
            .Select(a => a.Code)
            .ToArray();
        return new(
            codes[0],
            airport.TimeZone,
            $"{airport.City}, {airport.Country} ({string.Join(", ", codes)})",
            codes
        );
    }

    private static double Distance(GeographicPoint point, Airport airport)
    {
        const double radians = Math.PI / 180;
        var lat = (airport.Latitude - point.Latitude) * radians;
        var lon = (airport.Longitude - point.Longitude) * radians;
        var a =
            Math.Pow(Math.Sin(lat / 2), 2)
            + Math.Cos(point.Latitude * radians)
                * Math.Cos(airport.Latitude * radians)
                * Math.Pow(Math.Sin(lon / 2), 2);
        return 6371 * 2 * Math.Asin(Math.Sqrt(Math.Clamp(a, 0, 1)));
    }

    private static string Normalize(string value) =>
        new string(
            value
                .Normalize(NormalizationForm.FormD)
                .Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                .ToArray()
        ).ToLowerInvariant();

    private static bool MatchesCity(string airportCity, string normalizedCity)
    {
        var city = Normalize(airportCity);
        return city == normalizedCity
            || city.StartsWith(normalizedCity + " (", StringComparison.Ordinal)
            || city.StartsWith(normalizedCity + ",", StringComparison.Ordinal);
    }
}

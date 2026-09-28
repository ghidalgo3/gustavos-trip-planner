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
    public SearchLocation? CityLocation { get; init; }
    public SearchLocation Location => new(Code, TimeZone, $"{City} · {Name} ({Code})");
}

public sealed class AirportCatalog
{
    // Metropolitan catchments cross municipal boundaries (e.g. Narita serves Tokyo).
    private static readonly Dictionary<string, (string City, string[] Codes)> Metros = new()
    {
        ["TYO"] = ("Tokyo", ["HND", "NRT"]),
        ["NYC"] = ("New York", ["JFK", "LGA", "EWR"]),
        ["LON"] = ("London", ["LHR", "LGW", "LCY", "LTN", "STN", "SEN"]),
        ["PAR"] = ("Paris", ["CDG", "ORY", "BVA"]),
        ["MIL"] = ("Milan", ["MXP", "LIN", "BGY"]),
        ["WAS"] = ("Washington", ["IAD", "DCA", "BWI"]),
        ["CHI"] = ("Chicago", ["ORD", "MDW"]),
        ["SEL"] = ("Seoul", ["ICN", "GMP"]),
        ["OSA"] = ("Osaka", ["KIX", "ITM", "UKB"]),
        ["BJS"] = ("Beijing", ["PEK", "PKX"]),
        ["SHA"] = ("Shanghai", ["SHA", "PVG"]),
        ["YTO"] = ("Toronto", ["YYZ", "YTZ"]),
        ["YMQ"] = ("Montreal", ["YUL", "YHU"]),
    };
    private readonly Airport[] _airports;
    private readonly IReadOnlyDictionary<string, Airport> _byCode;
    private readonly (Airport Airport, string Text, string City)[] _search;

    public AirportCatalog()
    {
        using var stream = typeof(AirportCatalog).Assembly.GetManifestResourceStream(
            "TripPlanner.Api.Data.airports.json"
        )!;
        _airports = JsonSerializer.Deserialize<Airport[]>(stream, JsonSerializerOptions.Web)!;
        _byCode = _airports
            .GroupBy(a => a.Code, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First(),
                StringComparer.OrdinalIgnoreCase
            );
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
            .Select(a => a.Airport with { CityLocation = CityLocation(a.Airport) })
            .ToArray();
    }

    public SearchLocation? Resolve(string query)
    {
        var normalized = Normalize(query.Trim());
        var exactAirport = _airports.FirstOrDefault(a => Normalize(a.Code) == normalized);
        if (exactAirport is not null)
            return exactAirport.Location;
        var metro = Metros.FirstOrDefault(m =>
            Normalize(m.Value.City) == normalized || Normalize(m.Key) == normalized
        );
        if (metro.Key is not null)
            return CityLocation(_byCode[metro.Value.Codes[0]]);
        var cityAirport = _airports.FirstOrDefault(a => MatchesCity(a.City, normalized));
        if (cityAirport is not null)
            return CityLocation(cityAirport);
        return Search(query).FirstOrDefault()?.Location;
    }

    public Airport? FindByCode(string code) => _byCode.GetValueOrDefault(code);

    public string? CityName(string code)
    {
        var airport = FindByCode(code);
        if (airport is null)
            return null;
        var metro = Metros.Values.FirstOrDefault(group => group.Codes.Contains(airport.Code));
        if (metro.City is not null)
            return metro.City;
        return airport.City.Split(['(', ','], StringSplitOptions.TrimEntries)[0];
    }

    public bool IsInCity(string code, string city)
    {
        var airport = FindByCode(code);
        if (airport is null)
            return false;
        var parts = city.Split(',', 2, StringSplitOptions.TrimEntries);
        return (
                MatchesCity(airport.City, Normalize(parts[0]))
                || Metros.Values.Any(m =>
                    Normalize(m.City) == Normalize(parts[0]) && m.Codes.Contains(code)
                )
            )
            && (
                parts.Length < 2
                || parts[1].Length != 2
                || string.Equals(airport.Country, parts[1], StringComparison.OrdinalIgnoreCase)
            );
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

    public IReadOnlyList<Airport> HomeAirports(ProfileHomeCity city)
    {
        var point = new GeographicPoint(city.Longitude, city.Latitude);
        var name = Normalize(city.Name.Split(',')[0].Trim());
        var metro = Metros.FirstOrDefault(m =>
            Normalize(m.Value.City) == name
            && m.Value.Codes.Any(code =>
                _byCode.TryGetValue(code, out var a) && Distance(point, a) <= 250
            )
        );
        if (metro.Key is not null)
            return metro
                .Value.Codes.Where(_byCode.ContainsKey)
                .Select(code => _byCode[code])
                .ToArray();
        var matching = _airports
            .Where(a => MatchesCity(a.City, name) && Distance(point, a) <= 250)
            .ToArray();
        if (matching.Length > 0)
            return matching.OrderBy(a => a.Code).ToArray();
        var nearest = _airports
            .Where(a => a.Major)
            .OrderBy(a => Distance(point, a))
            .FirstOrDefault();
        return nearest is null || Distance(point, nearest) > 250
            ? []
            : CityLocation(nearest).AirportCodes.Select(c => _byCode[c]).ToArray();
    }

    public string SearchCode(SearchLocation location)
    {
        if (location.AirportCodes.Count == 1)
            return location.Code;
        // Use a metro query only when its full catalog group was selected.
        return Metros
                .FirstOrDefault(g =>
                    g.Value.Codes.Where(_byCode.ContainsKey)
                        .Order()
                        .SequenceEqual(location.AirportCodes.Order())
                )
                .Key
            ?? location.Code;
    }

    private SearchLocation CityLocation(Airport airport)
    {
        if (string.IsNullOrWhiteSpace(airport.City))
            return airport.Location;
        var metro = Metros.FirstOrDefault(g => g.Value.Codes.Contains(airport.Code));
        if (metro.Key is not null)
        {
            var group = metro.Value.Codes.Where(_byCode.ContainsKey).ToArray();
            return new(
                group[0],
                airport.TimeZone,
                $"{metro.Value.City}, {airport.Country} ({string.Join(", ", group)})",
                group
            );
        }
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

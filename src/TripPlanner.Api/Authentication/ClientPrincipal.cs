using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace TripPlanner.Api.Authentication;

public sealed record ClientPrincipalClaim(
    [property: JsonPropertyName("typ")] string Type,
    [property: JsonPropertyName("val")] string Value
);

public sealed record ClientPrincipal(
    [property: JsonPropertyName("auth_typ")] string? AuthType,
    [property: JsonPropertyName("name_typ")] string? NameType,
    [property: JsonPropertyName("role_typ")] string? RoleType,
    [property: JsonPropertyName("claims")] IReadOnlyList<ClientPrincipalClaim> Claims
)
{
    public string? FindFirst(params string[] claimTypes) =>
        Claims
            .FirstOrDefault(claim =>
                claimTypes.Contains(claim.Type, StringComparer.OrdinalIgnoreCase)
            )
            ?.Value;

    public static ClientPrincipal? FromHeader(string? encodedPrincipal)
    {
        if (string.IsNullOrWhiteSpace(encodedPrincipal))
        {
            return null;
        }

        try
        {
            byte[] json = Convert.FromBase64String(encodedPrincipal);
            return JsonSerializer.Deserialize<ClientPrincipal>(
                Encoding.UTF8.GetString(json),
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true }
            );
        }
        catch (FormatException)
        {
            return null;
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

using System.ComponentModel.DataAnnotations;

namespace TripPlanner.Api.DTO;

public sealed record StayAddressSearchRequest([property: Required, StringLength(200)] string Query);

using System.ComponentModel.DataAnnotations;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.DTO;

public sealed record PartyMemberRequest(
    [property: EnumDataType(typeof(PartyRole))] PartyRole Role = PartyRole.Traveller
);

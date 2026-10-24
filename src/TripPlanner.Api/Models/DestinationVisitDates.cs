namespace TripPlanner.Api.Models;

public static class DestinationVisitDates
{
    public const string OverlapMessage =
        "Destination visits can share an arrival/departure day, but cannot overlap inside another visit. End on or before its arrival, or start on or after its departure.";

    public static bool Overlap(
        DateOnly? arrival,
        DateOnly? departure,
        DateOnly? otherArrival,
        DateOnly? otherDeparture
    )
    {
        var start = arrival ?? departure;
        var end = departure ?? arrival;
        var otherStart = otherArrival ?? otherDeparture;
        var otherEnd = otherDeparture ?? otherArrival;
        return start is not null && otherStart is not null && start < otherEnd && otherStart < end;
    }

    public static void Validate(
        IEnumerable<DestinationVisit> visits,
        DateOnly? arrival,
        DateOnly? departure,
        Guid? excludedStayId = null
    )
    {
        if (
            visits.Any(v =>
                v.StayId != excludedStayId
                && Overlap(arrival, departure, v.ArrivalDate, v.DepartureDate)
            )
        )
        {
            throw new DestinationDatesOverlapException();
        }
    }
}

public sealed class DestinationDatesOverlapException()
    : InvalidOperationException(DestinationVisitDates.OverlapMessage);

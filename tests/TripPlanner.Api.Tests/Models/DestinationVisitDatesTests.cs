using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Models;

[TestClass]
public sealed class DestinationVisitDatesTests
{
    [TestMethod]
    [DataRow(5, 10, false)]
    [DataRow(15, 20, false)]
    [DataRow(10, 10, false)]
    [DataRow(15, 15, false)]
    [DataRow(11, 11, true)]
    [DataRow(5, 11, true)]
    [DataRow(14, 20, true)]
    [DataRow(10, 15, true)]
    [DataRow(5, 20, true)]
    [DataRow(11, 14, true)]
    [DataRow(null, null, false)]
    [DataRow(11, null, true)]
    [DataRow(null, 11, true)]
    [DataRow(null, 15, false)]
    public void VisitsShareOnlyBoundaries(int? from, int? to, bool conflicts)
    {
        DateOnly? start = from is { } a ? new(2027, 6, a) : null;
        DateOnly? end = to is { } b ? new(2027, 6, b) : null;
        Assert.AreEqual(
            conflicts,
            DestinationVisitDates.Overlap(start, end, new(2027, 6, 10), new(2027, 6, 15))
        );
        Assert.AreEqual(
            conflicts,
            DestinationVisitDates.Overlap(new(2027, 6, 10), new(2027, 6, 15), start, end)
        );
    }
}

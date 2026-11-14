using System.Text.Json;
using TripPlanner.Api.DTO;

namespace TripPlanner.Api.Tests.Support;

internal static class TransportationFixture
{
    public static TransportationFeatureRequest Point(string id, string name = "Station") =>
        new(
            "Feature",
            id,
            new("Point", JsonSerializer.SerializeToElement(new[] { 139.767, 35.681 })),
            new(Name: name, Address: "Station address")
        );

    public static TransportationFeatureRequest Reference(string id, string kind, Guid target) =>
        new("Feature", id, null, new(Reference: new(kind, target)));

    public static TransportationRequest Journey(
        TransportationFeatureRequest? from = null,
        TransportationFeatureRequest? to = null,
        bool route = false
    ) =>
        new(
            "FeatureCollection",
            "Train to hotel",
            "Take the airport express, then Metro A toward Central.",
            [
                from ?? Point("from"),
                to ?? Point("to", "Hotel"),
                .. route
                    ? new[]
                    {
                        new TransportationFeatureRequest(
                            "Feature",
                            "step-1",
                            new(
                                "LineString",
                                JsonSerializer.SerializeToElement(
                                    new[] { new[] { 139.767, 35.681 }, new[] { 139.77, 35.69 } }
                                )
                            ),
                            new(
                                Sequence: 0,
                                Mode: "train",
                                Line: "Airport express",
                                Direction: "Central",
                                Instructions: "Use platform 2",
                                Duration: TimeSpan.FromMinutes(20)
                            )
                        ),
                    }
                    : [],
            ],
            Mode: "transit",
            Duration: TimeSpan.FromMinutes(30)
        );
}

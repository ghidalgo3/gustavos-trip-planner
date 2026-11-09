using System.Text.Json;
using TripPlanner.Api.Models;

namespace TripPlanner.Api.Tests.Models;

[TestClass]
public sealed class ModelEnumTests
{
    [TestMethod]
    [DataRow(ActivityState.Proposed, "Proposed")]
    [DataRow(ActivityState.Planned, "Planned")]
    [DataRow(ActivityState.Rejected, "Rejected")]
    public void ActivityStates_RoundTripExistingStoredJson(ActivityState state, string name)
    {
        string json =
            $$"""{"name":"Museum","duration":"PT1H","description":"Art","cost":null,"kinds":["Culture"],"ticketRequirement":"Unknown","state":"{{name}}"}""";
        var activity = JsonSerializer.Deserialize<ActivityProperties>(
            json,
            JsonSerializerOptions.Web
        )!;
        Assert.AreEqual(state, activity.State);
        var saved = JsonSerializer.SerializeToElement(activity, JsonSerializerOptions.Web);
        Assert.AreEqual(name, saved.GetProperty("state").GetString());
    }

    [TestMethod]
    [DataRow(PartyRole.Traveller, "Traveller")]
    [DataRow(PartyRole.Planner, "Planner")]
    public void PartyRoles_RoundTripExistingStoredJson(PartyRole role, string name)
    {
        var id = Guid.NewGuid();
        string json = $$"""{"{{id}}":"{{name}}"}""";
        var roles = JsonSerializer.Deserialize<Dictionary<Guid, PartyRole>>(json)!;
        Assert.AreEqual(role, roles[id]);
        Assert.AreEqual(json, JsonSerializer.Serialize(roles));
        Assert.AreEqual(
            PartyRole.Traveller,
            new Party(Guid.NewGuid(), Guid.NewGuid(), [id]).RoleFor(id)
        );
    }

    [TestMethod]
    [DataRow(typeof(ActivityState), "0")]
    [DataRow(typeof(ActivityState), "99")]
    [DataRow(typeof(ActivityState), "\"0\"")]
    [DataRow(typeof(ActivityState), "\"planned\"")]
    [DataRow(typeof(ActivityState), "\"Booked\"")]
    [DataRow(typeof(PartyRole), "0")]
    [DataRow(typeof(PartyRole), "99")]
    [DataRow(typeof(PartyRole), "\"1\"")]
    [DataRow(typeof(PartyRole), "\"planner\"")]
    [DataRow(typeof(PartyRole), "\"Administrator\"")]
    public void Enums_RejectNumbersAndUndocumentedNames(Type type, string json)
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize(json, type));
    }

    [TestMethod]
    public void ActivityState_RemainsRequiredInJson()
    {
        Assert.Throws<JsonException>(() =>
            JsonSerializer.Deserialize<ActivityProperties>(
                """{"name":"Museum","description":"Art"}""",
                JsonSerializerOptions.Web
            )
        );
    }
}

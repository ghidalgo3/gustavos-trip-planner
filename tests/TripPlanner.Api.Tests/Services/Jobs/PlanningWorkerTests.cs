using Microsoft.Extensions.Logging.Abstractions;
using TripPlanner.Api.Models;
using TripPlanner.Api.Options;
using TripPlanner.Api.Services.Jobs;
using TripPlanner.Api.Tests.Database;
using static TripPlanner.Api.Tests.Support.OperationFixture;

namespace TripPlanner.Api.Tests.Services.Jobs;

[TestClass]
public sealed class PlanningWorkerTests
{
    [TestMethod]
    public async Task Worker_UsesFreshCacheAndRefreshesExpiredEntries()
    {
        var clock = new TestClock();
        var db = new InMemoryPlannerDb { OperationClock = clock };
        var (user, trip, party) = await Seed(db);
        var preview = Preview(party.Id, Query);
        var client = new FakeIgnav();
        var worker = new PlanningWorker(
            db,
            client,
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            clock,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        await db.CreateFlightSearchOperationAsync(user.Id, trip.Id, Guid.NewGuid(), preview);
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual(1, client.Calls);

        clock.Advance(TimeSpan.FromMinutes(59));
        var cached = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            preview
        );
        Assert.AreEqual("Completed", cached.Status);
        Assert.IsFalse(await worker.ProcessNextAsync());
        Assert.AreEqual(1, client.Calls);

        clock.Advance(TimeSpan.FromMinutes(2));
        var refresh = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            preview
        );
        Assert.AreEqual("pending", refresh.Status);
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual(2, client.Calls);
    }

    [TestMethod]
    public async Task Worker_RetriesTransientProviderFailureWithoutFailingOperation()
    {
        var clock = new TestClock();
        var db = new InMemoryPlannerDb { OperationClock = clock };
        var (user, trip, party) = await Seed(db);
        var client = new FakeIgnav(transientFailures: 1);
        var worker = new PlanningWorker(
            db,
            client,
            Microsoft.Extensions.Options.Options.Create(new IgnavOptions()),
            Microsoft.Extensions.Options.Options.Create(new PlanningOptions()),
            clock,
            NullLogger<PlanningWorker>.Instance,
            null
        );
        var operation = await db.CreateFlightSearchOperationAsync(
            user.Id,
            trip.Id,
            Guid.NewGuid(),
            Preview(party.Id, Query)
        );
        Assert.IsTrue(await worker.ProcessNextAsync());
        var retrying = (await db.GetOperationAsync(user.Id, operation.Id))!;
        Assert.AreEqual("InProgress", retrying.Status);
        Assert.AreEqual(new OperationProgress(1, 0, 0), retrying.Progress);
        Assert.IsFalse(await worker.ProcessNextAsync());
        clock.Advance(TimeSpan.FromSeconds(2));
        Assert.IsTrue(await worker.ProcessNextAsync());
        Assert.AreEqual("Completed", (await db.GetOperationAsync(user.Id, operation.Id))!.Status);
        Assert.AreEqual(2, client.Calls);
    }
}

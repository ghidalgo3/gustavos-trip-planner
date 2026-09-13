using TripPlanner.Api.Models;

namespace TripPlanner.Api.Services;

public interface ITripStore
{
    IReadOnlyCollection<Trip> GetAll();

    Trip? Get(Guid id);

    Trip Add(CreateTripRequest request);

    bool Delete(Guid id);
}

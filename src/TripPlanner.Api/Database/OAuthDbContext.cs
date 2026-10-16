using Microsoft.EntityFrameworkCore;

namespace TripPlanner.Api.Database;

// OAuth protocol state is separate from trip models and uses OpenIddict's stores.
public sealed class OAuthDbContext(DbContextOptions<OAuthDbContext> options) : DbContext(options)
{
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);
        modelBuilder.HasDefaultSchema("gustavo_planner");
        modelBuilder.UseOpenIddict();
    }
}

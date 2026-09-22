namespace TripPlanner.Api.Authentication;

public interface ICurrentUser
{
    AuthenticatedUserProfile? Profile { get; }
}

public sealed class CurrentUser(IHttpContextAccessor httpContextAccessor) : ICurrentUser
{
    public AuthenticatedUserProfile? Profile =>
        httpContextAccessor.HttpContext is { } context
            ? AuthenticatedUserProfile.FromHttpContext(context)
            : null;
}

namespace TripPlanner.Api.Tests.Verification;

internal static class VerificationProgram
{
    public static async Task<int> Main(string[] args)
    {
        if (args is ["--mcp-eval-server"])
        {
            return await McpEvalServer.Run(5188);
        }
        if (
            args is ["--mcp-eval-server", var portText]
            && int.TryParse(portText, out int port)
            && port is >= 1024 and <= 65535
        )
        {
            return await McpEvalServer.Run(port);
        }
        if (args is ["--verify-solver"])
        {
            ActivitySolverVerification.Run();
            return 0;
        }
        Console.Error.WriteLine("Use dotnet test, --mcp-eval-server [PORT], or --verify-solver.");
        return 1;
    }
}

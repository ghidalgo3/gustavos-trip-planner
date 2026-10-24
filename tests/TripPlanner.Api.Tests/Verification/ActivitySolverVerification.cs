using Google.OrTools.Sat;

namespace TripPlanner.Api.Tests.Verification;

[TestClass]
public sealed class ActivitySolverVerification
{
    [TestMethod]
    public void NativeSolver_LoadsAndFindsTheOptimalSolution() => Run();

    public static void Run()
    {
        var model = new CpModel();
        var first = model.NewBoolVar("first");
        var second = model.NewBoolVar("second");
        model.Add(first + second <= 1);
        model.Maximize(first + second * 2);
        using var solver = new CpSolver();
        if (solver.Solve(model) != CpSolverStatus.Optimal || solver.Value(second) != 1)
        {
            throw new InvalidOperationException("Native activity solver verification failed.");
        }
        Console.WriteLine("OR-Tools CP-SAT native solver loaded and verified.");
    }
}

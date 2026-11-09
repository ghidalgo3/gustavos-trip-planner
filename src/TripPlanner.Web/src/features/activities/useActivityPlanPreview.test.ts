import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  previewActivityPlan,
  type ActivityPlan,
  type PlanAssessment,
} from "./activityPlanApi";
import { useActivityPlanPreview } from "./useActivityPlanPreview";

vi.mock("./activityPlanApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./activityPlanApi")>()),
  previewActivityPlan: vi.fn(),
}));
// The hook forwards complete plans; this fixture exercises request lifecycle only.
const plan = { selectedActivityIds: ["first"] } as ActivityPlan;
const assessment = { days: [] } as unknown as PlanAssessment;

describe("live plan preview", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces edits and evaluates only the latest draft", async () => {
    vi.mocked(previewActivityPlan).mockResolvedValue(assessment);
    const { result, rerender } = renderHook(
      ({ draft }) => useActivityPlanPreview("/plan", draft, "v1", true),
      { initialProps: { draft: plan } },
    );
    await act(() => vi.advanceTimersByTimeAsync(100));
    const draft = { ...plan, selectedActivityIds: ["second"] };
    rerender({ draft });
    await act(() => vi.advanceTimersByTimeAsync(199));
    expect(previewActivityPlan).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(previewActivityPlan).toHaveBeenCalledExactlyOnceWith(
      "/plan",
      draft,
      "v1",
      expect.any(AbortSignal),
    );
    expect(result.current?.assessment).toBe(assessment);
  });

  it("ignores out-of-order responses and aborts requests when the draft changes", async () => {
    let resolveOld!: (value: PlanAssessment) => void;
    vi.mocked(previewActivityPlan)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
      )
      .mockResolvedValueOnce(assessment);
    const { result, rerender } = renderHook(
      ({ version }) => useActivityPlanPreview("/plan", plan, version, true),
      { initialProps: { version: "v1" } },
    );
    await act(() => vi.advanceTimersByTimeAsync(200));
    const oldSignal = vi.mocked(previewActivityPlan).mock.calls[0][3];
    rerender({ version: "v2" });
    expect(oldSignal.aborted).toBe(true);
    expect(result.current).toBeUndefined();
    await act(() => vi.advanceTimersByTimeAsync(200));
    await act(async () => resolveOld({ ...assessment, status: "old" }));
    expect(result.current?.assessment).toBe(assessment);
  });

  it("reports failures without retaining stale numbers and recovers on the next edit", async () => {
    vi.mocked(previewActivityPlan)
      .mockRejectedValueOnce(new Error("Inputs changed. Reload the plan."))
      .mockResolvedValueOnce(assessment);
    const { result, rerender } = renderHook(
      ({ draft }) => useActivityPlanPreview("/plan", draft, "v1", true),
      { initialProps: { draft: plan } },
    );
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(result.current?.error).toBe("Inputs changed. Reload the plan.");
    expect(result.current?.assessment).toBeUndefined();
    rerender({ draft: { ...plan, selectedActivityIds: [] } });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(result.current?.assessment).toBe(assessment);
    expect(result.current?.error).toBeUndefined();
  });

  it("does not request previews for unchanged saved plans or after unmount", async () => {
    const { rerender, unmount } = renderHook(
      ({ enabled }) => useActivityPlanPreview("/plan", plan, "v1", enabled),
      { initialProps: { enabled: false } },
    );
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(previewActivityPlan).not.toHaveBeenCalled();
    rerender({ enabled: true });
    unmount();
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(previewActivityPlan).not.toHaveBeenCalled();
  });

  it("retains live timing without another preview when only a day name changes", async () => {
    vi.mocked(previewActivityPlan).mockResolvedValue(assessment);
    const draft = {
      ...plan,
      days: [
        { stayId: "visit", date: "2027-06-10", name: null, activityIds: [] },
      ],
    } as unknown as ActivityPlan;
    const { result, rerender } = renderHook(
      ({ draft }) => useActivityPlanPreview("/plan", draft, "v1", true),
      { initialProps: { draft } },
    );
    await act(() => vi.advanceTimersByTimeAsync(200));
    rerender({
      draft: { ...draft, days: [{ ...draft.days[0], name: "EPCOT Visit" }] },
    });
    await act(() => vi.advanceTimersByTimeAsync(500));
    expect(previewActivityPlan).toHaveBeenCalledTimes(1);
    expect(result.current?.assessment).toBe(assessment);
  });
});

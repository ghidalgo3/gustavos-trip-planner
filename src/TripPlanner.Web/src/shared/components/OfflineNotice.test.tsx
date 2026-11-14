import { act, fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import OfflineNotice from "./OfflineNotice";

test("offline notices wait 30 seconds, cancel on recovery, and restart for a new outage", () => {
  vi.useFakeTimers();
  try {
    const retry = vi.fn();
    const { rerender } = render(<OfflineNotice offline onRetry={retry} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(29_999));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getByRole("status")).toHaveTextContent("Offline · View only");
    fireEvent.click(screen.getByRole("button", { name: "Retry connection" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(<OfflineNotice offline={false} onRetry={retry} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<OfflineNotice offline onRetry={retry} />);
    act(() => vi.advanceTimersByTime(20_000));
    rerender(<OfflineNotice offline={false} onRetry={retry} />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<OfflineNotice offline onRetry={retry} />);
    act(() => vi.advanceTimersByTime(29_999));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.getAllByRole("status")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

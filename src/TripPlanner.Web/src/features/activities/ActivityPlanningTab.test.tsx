import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { expect, test, vi } from "vitest";
import ActivityPlanningTab from "./ActivityPlanningTab";
import type { Trip } from "../../api/api";

const lifecycle = vi.hoisted(() => ({ mounted: vi.fn(), disposed: vi.fn() }));
vi.mock("./ActivityPlanning", () => ({
  default: function Planning({ active }: { active: boolean }) {
    const [draft, setDraft] = useState("");
    useEffect(() => {
      lifecycle.mounted();
      return lifecycle.disposed;
    }, []);
    return (
      <input
        aria-label="Draft"
        value={draft}
        disabled={!active}
        onChange={(event) => setDraft(event.target.value)}
      />
    );
  },
}));

test("visiting other trip tabs retains the activity workspace and draft until leaving the trip", () => {
  const props = {
    trip: { id: "trip" } as Trip,
    readOnly: false,
  };
  const { rerender, unmount } = render(
    <ActivityPlanningTab {...props} active={false} />,
  );
  expect(lifecycle.mounted).not.toHaveBeenCalled();
  rerender(<ActivityPlanningTab {...props} active />);
  const draft = screen.getByLabelText("Draft");
  fireEvent.change(draft, { target: { value: "Museum" } });
  rerender(<ActivityPlanningTab {...props} active={false} />);
  expect(draft).not.toBeVisible();
  expect(lifecycle.disposed).not.toHaveBeenCalled();
  rerender(<ActivityPlanningTab {...props} active />);
  expect(screen.getByLabelText("Draft")).toBe(draft);
  expect(draft).toHaveValue("Museum");
  expect(lifecycle.mounted).toHaveBeenCalledTimes(1);
  unmount();
  expect(lifecycle.disposed).toHaveBeenCalledTimes(1);
});

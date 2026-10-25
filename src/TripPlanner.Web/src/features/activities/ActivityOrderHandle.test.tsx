import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ActivityOrderHandle from "./ActivityOrderHandle";

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
});

function show(disabled = false, index = 0) {
  const move = vi.fn();
  render(
    <>
      <ol>
        <li data-order-index={index}>
          <ActivityOrderHandle
            name="Museum"
            index={index}
            count={3}
            disabled={disabled}
            onMove={move}
          />
        </li>
        <li data-testid="target" data-order-index={2}>
          Garden
        </li>
      </ol>
      <ol>
        <li data-testid="other-day" data-order-index={0}>
          Other day
        </li>
      </ol>
    </>,
  );
  const handle = screen.getByRole("button", { name: "Reorder Museum" });
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = vi.fn(() => true);
  handle.releasePointerCapture = vi.fn();
  const target = screen.getByTestId("target");
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 200, 300, 100),
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => target),
  });
  return { handle, target, move };
}

test.each(["mouse", "touch"])(
  "reorders with a %s handle drag, committing only on drop",
  (pointerType) => {
    const { handle, target, move } = show();
    fireEvent.pointerDown(handle, {
      pointerId: 1,
      pointerType,
      button: 0,
      clientY: 100,
    });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 280 });
    expect(target).toHaveAttribute("data-reorder-target", "after");
    expect(move).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(move).toHaveBeenCalledExactlyOnceWith(2);
    expect(target).not.toHaveAttribute("data-reorder-target");
    expect(screen.getByRole("status")).toHaveTextContent("position 3 of 3");
  },
);

test.each(["escape", "cancel", "outside"])(
  "abandons the reorder on %s",
  (action) => {
    const { handle, target, move } = show();
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 280 });
    if (action === "escape") fireEvent.keyDown(handle, { key: "Escape" });
    else if (action === "cancel")
      fireEvent.pointerCancel(handle, { pointerId: 1 });
    else {
      vi.mocked(document.elementFromPoint).mockReturnValue(
        screen.getByTestId("other-day"),
      );
      fireEvent.pointerMove(handle, {
        pointerId: 1,
        clientX: 100,
        clientY: 300,
      });
    }
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(move).not.toHaveBeenCalled();
    expect(target).not.toHaveAttribute("data-reorder-target");
  },
);

test.each([
  [0, "ArrowDown", 1],
  [2, "ArrowUp", 1],
  [0, "ArrowUp", null],
  [2, "ArrowDown", null],
] as const)(
  "keyboard moves from %s with %s within the day's bounds",
  (index, key, expected) => {
    const { handle, move } = show(false, index);
    fireEvent.keyDown(handle, { key });
    if (expected === null) expect(move).not.toHaveBeenCalled();
    else expect(move).toHaveBeenCalledWith(expected);
  },
);

test("disabled handles cannot change the plan", () => {
  const { handle, move } = show(true);
  expect(handle).toBeDisabled();
  fireEvent.keyDown(handle, { key: "ArrowDown" });
  expect(move).not.toHaveBeenCalled();
});

test.each([
  ["empty day", 0, false],
  ["before another activity", 0, true],
  ["after another activity", 1, true],
  ["collapsed day", 1, false],
] as const)("moves a single activity to %s", (label, position, hasTarget) => {
  const move = vi.fn();
  render(
    <div data-order-agenda>
      <section data-order-day="2027-06-10">
        <ol>
          <li data-order-index={0}>
            <ActivityOrderHandle
              name="Museum"
              index={0}
              count={1}
              disabled={false}
              onMove={vi.fn()}
              onMoveToDay={move}
            />
          </li>
        </ol>
      </section>
      <section data-order-day="2027-06-15" data-testid="destination">
        <h3 data-testid="heading">Next day</h3>
        <ol hidden={label === "collapsed day"}>
          {(hasTarget || label === "collapsed day") && (
            <li data-order-index={0} data-testid="destination-card">
              Garden
            </li>
          )}
        </ol>
      </section>
    </div>,
  );
  const handle = screen.getByRole("button", { name: "Reorder Museum" });
  expect(handle).toBeEnabled();
  handle.setPointerCapture = vi.fn();
  const hit = screen.getByTestId(hasTarget ? "destination-card" : "heading");
  vi.spyOn(hit, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 300, 100),
  );
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => hit),
  });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, {
    pointerId: 1,
    clientX: 100,
    clientY: position === 0 ? 110 : 190,
  });
  expect(move).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(move).toHaveBeenCalledExactlyOnceWith("2027-06-15", position);
  expect(screen.getByTestId("destination")).not.toHaveAttribute(
    "data-reorder-target",
  );
});

test.each([
  ["before lunch", 110, 1],
  ["after lunch", 190, 2],
] as const)(
  "moves the only activity %s without changing its activity index",
  (_label, y, mealsBefore) => {
    const move = vi.fn();
    render(
      <div data-order-agenda>
        <section data-order-day="2027-06-10">
          <ol>
            <li data-order-meal="breakfast">Breakfast</li>
            <li data-order-meal="lunch" data-testid="lunch">
              Lunch
            </li>
            <li data-order-meal="dinner">Dinner</li>
            <li data-order-index={0}>
              <ActivityOrderHandle
                name="Museum"
                index={0}
                count={1}
                disabled={false}
                onMove={vi.fn()}
                onMoveToDay={move}
              />
            </li>
          </ol>
        </section>
      </div>,
    );
    const handle = screen.getByRole("button", { name: "Reorder Museum" });
    handle.setPointerCapture = vi.fn();
    const lunch = screen.getByTestId("lunch");
    vi.spyOn(lunch, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 100, 300, 100),
    );
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => lunch),
    });
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: y });
    expect(lunch).toHaveAttribute(
      "data-reorder-target",
      mealsBefore === 1 ? "before" : "after",
    );
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(move).toHaveBeenCalledExactlyOnceWith("2027-06-10", 0, mealsBefore);
  },
);

test("keyboard movement crosses meals for a single activity", () => {
  const move = vi.fn();
  render(
    <div data-order-agenda>
      <section data-order-day="2027-06-10">
        <ol>
          <li data-order-meal="breakfast">Breakfast</li>
          <li data-order-meal="lunch">Lunch</li>
          <li data-order-meal="dinner">Dinner</li>
          <li data-order-index={0}>
            <ActivityOrderHandle
              name="Museum"
              index={0}
              count={1}
              disabled={false}
              onMove={vi.fn()}
              onMoveToDay={move}
            />
          </li>
        </ol>
      </section>
    </div>,
  );
  fireEvent.keyDown(screen.getByRole("button", { name: "Reorder Museum" }), {
    key: "ArrowUp",
  });
  expect(move).toHaveBeenCalledExactlyOnceWith("2027-06-10", 0, 2);
});

test("does not accept a drop on a flight-unavailable row", () => {
  const move = vi.fn();
  render(
    <div data-order-agenda>
      <section data-order-day="2027-06-10">
        <ol>
          <li data-order-index={0}>
            <ActivityOrderHandle
              name="Museum"
              index={0}
              count={1}
              disabled={false}
              onMove={vi.fn()}
              onMoveToDay={move}
            />
          </li>
          <li data-order-unavailable data-testid="blocked">
            Unavailable during flight
          </li>
        </ol>
      </section>
    </div>,
  );
  const handle = screen.getByRole("button", { name: "Reorder Museum" });
  handle.setPointerCapture = vi.fn();
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: vi.fn(() => screen.getByTestId("blocked")),
  });
  fireEvent.pointerDown(handle, { pointerId: 1, button: 0 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100, clientY: 200 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(move).not.toHaveBeenCalled();
});

import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "../../app/ColorSchemeProvider";
import TripCalendar from "./TripCalendar";
import type { Destination } from "../activities/activitiesApi";
const destination = (
  id: string,
  name: string,
  stays: [string | null, string | null][],
): Destination => ({
  type: "Feature",
  id,
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: {
    name,
    countryCode: "",
    timeZone: null,
    contextVersion: "",
    isActive: true,
    arrivalDate: null,
    departureDate: null,
    stays: stays.map(([arrivalDate, departureDate], order) => ({
      id: `${id}-${order}`,
      order,
      arrivalDate,
      departureDate,
      arrivalAt: "",
      departureAt: "",
    })),
  },
});
const destinations = [
  destination("paris", "Paris", [
    ["2027-06-10", "2027-06-14"],
    ["2027-07-01", "2027-07-03"],
  ]),
  destination("rome", "Rome", [["2027-06-14", "2027-06-18"]]),
];
function show(
  arrival = "2027-06-12",
  departure = "",
  cities = destinations,
  excludeStayId?: string,
) {
  const onChange = vi.fn();
  function Calendar() {
    const [dates, setDates] = useState([arrival, departure]);
    return (
      <TripCalendar
        arrivalDate={dates[0]}
        departureDate={dates[1]}
        destinations={cities}
        excludeStayId={excludeStayId}
        onChange={(start, end) => {
          onChange(start, end);
          setDates([start, end]);
        }}
      />
    );
  }
  render(
    <ColorSchemeProvider>
      <Calendar />
    </ColorSchemeProvider>,
  );
  return {
    calendar: screen.getByRole("group", { name: "Destination dates" }),
    onChange,
  };
}

test("one calendar highlights other cities, overlapping days, and repeat visits with a color legend", () => {
  const { calendar } = show();
  expect(within(calendar).queryByText("Visit dates · Optional")).toBeNull();
  expect(within(calendar).queryByText(/Choose.*date/)).toBeNull();
  expect(within(calendar).queryByText(/Visits can share/)).toBeNull();
  const boundary = within(calendar).getByRole("button", {
    name: "Jun 14, 2027 · Paris, Rome",
  });
  expect(
    boundary.querySelectorAll(".trip-calendar-range-marks i"),
  ).toHaveLength(2);
  const legend = within(calendar).getByRole("list", {
    name: "Other destination dates",
  });
  expect(within(legend).getAllByText("Paris")).toHaveLength(2);
  expect(legend).toHaveTextContent("Jul 1, 2027 – Jul 3, 2027");
  fireEvent.click(within(calendar).getByRole("button", { name: "Next month" }));
  expect(
    within(calendar).getByRole("button", { name: "Jul 2, 2027 · Paris" }),
  ).toBeVisible();
});

test.each([
  [10, 14],
  [10, 10],
  [14, 10, 12],
])("selects an ordered date range using %j", (...days) => {
  const { calendar, onChange } = show("", "", destinations, "paris-0");
  for (const day of days)
    fireEvent.click(
      within(calendar).getByRole("button", {
        name: new RegExp(`^Jun ${day}, 2027`),
      }),
    );
  const start = days.length === 3 ? days[1] : days[0];
  const end = days.at(-1)!;
  expect(onChange).toHaveBeenLastCalledWith(
    `2027-06-${start}`,
    `2027-06-${end}`,
  );
  expect(within(calendar).getAllByText("Paris")).toHaveLength(1);
  expect(
    within(calendar).getAllByRole("button", { pressed: true }),
  ).toHaveLength(end - start + 1);
});

test("editing a completed range starts a new selection and dates can be cleared", () => {
  const { calendar, onChange } = show("2027-06-12", "2027-06-14", [
    destination("paris", "Paris", [[null, "2027-06-15"]]),
  ]);
  expect(
    within(calendar).getByRole("button", { name: "Jun 15, 2027 · Paris" }),
  ).toBeVisible();
  fireEvent.click(
    within(calendar).getByRole("button", { name: "Jun 16, 2027" }),
  );
  expect(onChange).toHaveBeenLastCalledWith("2027-06-16", "");
  fireEvent.click(
    within(calendar).getByRole("button", { name: "Clear dates" }),
  );
  expect(onChange).toHaveBeenLastCalledWith("", "");
});

test("keyboard navigation selects a range across month boundaries", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  const { calendar, onChange } = show("2027-06-30", "", []);
  const lastDay = within(calendar).getByRole("button", {
    name: "Jun 30, 2027",
  });
  act(() => lastDay.focus());
  fireEvent.keyDown(lastDay, { key: "ArrowRight" });
  const next = await within(calendar).findByRole("button", {
    name: "Jul 1, 2027",
  });
  await waitFor(() => expect(next).toHaveFocus());
  fireEvent.click(next);
  expect(onChange).toHaveBeenCalledWith("2027-06-30", "2027-07-01");
});
test.each([false, true])(
  "marks today's local date alongside city highlights and selection=%s",
  (selected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2027, 5, 14, 12));
    const { calendar } = show(
      selected ? "2027-06-12" : "",
      selected ? "2027-06-16" : "",
    );
    const today = within(calendar).getByRole("button", {
      name: "Jun 14, 2027 · Paris, Rome",
    });
    expect(today).toHaveAttribute("aria-current", "date");
    expect(today).toHaveAttribute("aria-pressed", String(selected));
    expect(today.querySelectorAll(".trip-calendar-range-marks i")).toHaveLength(
      2,
    );
    fireEvent.click(
      within(calendar).getByRole("button", { name: "Next month" }),
    );
    expect(calendar.querySelector('[aria-current="date"]')).toBeNull();
  },
);
test.each([
  [9, 10, true],
  [15, 18, true],
  [10, 10, true],
  [15, 15, true],
  [9, 16, false],
  [10, 15, false],
  [10, 11, false],
])(
  "allows only shared boundary dates: %s–%s, allowed=%s",
  (start, end, allowed) => {
    const { calendar, onChange } = show("", "", [
      destination("paris", "Paris", [["2027-06-10", "2027-06-15"]]),
    ]);
    const day = (value: number) =>
      within(calendar).getByRole("button", {
        name: new RegExp(`^Jun ${value}, 2027`),
      });
    fireEvent.click(day(start));
    expect(day(end).getAttribute("aria-disabled")).toBe(
      allowed ? null : "true",
    );
    fireEvent.click(day(end));
    expect(onChange).toHaveBeenLastCalledWith(
      `2027-06-${String(start).padStart(2, "0")}`,
      allowed ? `2027-06-${String(end).padStart(2, "0")}` : "",
    );
  },
);

test("interior days cannot be selected, including during a repeat visit edit", () => {
  const { calendar, onChange } = show("", "", destinations, "paris-1");
  const interior = within(calendar).getByRole("button", {
    name: "Jun 12, 2027 · Paris",
  });
  expect(interior).toHaveAttribute("aria-disabled", "true");
  fireEvent.click(interior);
  expect(onChange).not.toHaveBeenCalled();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ColorSchemeProvider from "./ColorSchemeProvider";
import TripDatePicker from "./TripDatePicker";
import type { Destination } from "./activitiesApi";
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
async function open() {
  const trigger = screen.getByRole("button", { name: "Choose arrival date" });
  act(() => trigger.focus());
  fireEvent.click(trigger);
  return screen.findByLabelText("Arrival date calendar");
}
test("highlights other cities' inclusive stays, shared boundary days, and repeat visits with a color legend", async () => {
  render(
    <ColorSchemeProvider>
      <TripDatePicker
        label="Arrival date"
        value="2027-06-12"
        onChange={vi.fn()}
        destinations={destinations}
      />
    </ColorSchemeProvider>,
  );
  const calendar = await open();
  const boundary = within(calendar).getByRole("button", {
    name: /Jun 14, 2027 · Paris, Rome/,
  });
  expect(
    boundary.querySelectorAll(".trip-calendar-range-marks i"),
  ).toHaveLength(2);
  expect(boundary.style.background).not.toBe("");
  expect(
    within(calendar).getByRole("button", { name: /Jun 10, 2027 · Paris/ }),
  ).toBeInTheDocument();
  const legend = within(calendar).getByRole("list", {
    name: "Other destination dates",
  });
  expect(within(legend).getAllByText("Paris")).toHaveLength(2);
  expect(legend).toHaveTextContent("Jul 1, 2027 – Jul 3, 2027");
  expect(within(legend).getByText("Rome")).toBeInTheDocument();
  fireEvent.click(within(calendar).getByRole("button", { name: "Next month" }));
  expect(
    within(calendar).getByRole("button", { name: /Jul 2, 2027 · Paris/ }),
  ).toBeInTheDocument();
});
test("excludes the edited city and enforces the earliest departure date without blocking other cities", async () => {
  const onChange = vi.fn();
  render(
    <ColorSchemeProvider>
      <TripDatePicker
        label="Arrival date"
        value="2027-06-14"
        min="2027-06-14"
        onChange={onChange}
        destinations={destinations}
        excludeCityId="paris"
      />
    </ColorSchemeProvider>,
  );
  const calendar = await open();
  expect(within(calendar).queryByText("Paris")).not.toBeInTheDocument();
  expect(
    within(calendar).getByRole("button", { name: "Jun 13, 2027" }),
  ).toBeDisabled();
  fireEvent.click(
    within(calendar).getByRole("button", { name: "Jun 14, 2027 · Rome" }),
  );
  expect(onChange).toHaveBeenCalledWith("2027-06-14");
});
test("partially dated visits highlight the known date and dates can be cleared", async () => {
  const onChange = vi.fn();
  render(
    <ColorSchemeProvider>
      <TripDatePicker
        label="Arrival date"
        value="2027-06-12"
        onChange={onChange}
        destinations={[destination("paris", "Paris", [[null, "2027-06-15"]])]}
      />
    </ColorSchemeProvider>,
  );
  const calendar = await open();
  expect(
    within(calendar).getByRole("button", { name: "Jun 15, 2027 · Paris" }),
  ).toBeInTheDocument();
  fireEvent.click(within(calendar).getByRole("button", { name: "Clear date" }));
  expect(onChange).toHaveBeenCalledWith("");
});

test("calendar keyboard navigation crosses month boundaries and selects the focused date", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  const onChange = vi.fn();
  render(
    <ColorSchemeProvider>
      <TripDatePicker
        label="Arrival date"
        value="2027-06-30"
        onChange={onChange}
        destinations={[]}
      />
    </ColorSchemeProvider>,
  );
  const calendar = await open();
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
  expect(onChange).toHaveBeenCalledWith("2027-07-01");
});
afterEach(() => vi.unstubAllGlobals());

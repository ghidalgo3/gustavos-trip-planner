import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import TripMetadataEditor from "./TripMetadataEditor";
import { getTrip, updateTrip, type Trip } from "../../api/api";
vi.mock("../../api/api", () => ({ updateTrip: vi.fn(), getTrip: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const trip: Trip = {
  id: "trip",
  ownerUserId: "owner",
  name: "Europe",
  description: "Museums",
  constraints: { budget: 500 },
  createdAt: "",
  updatedAt: "",
};

test("independent metadata fields save on blur using confirmed values for other fields", async () => {
  vi.mocked(updateTrip).mockImplementation(async (_user, _id, input) => ({
    ...trip,
    ...input,
  }));
  render(
    <TripMetadataEditor
      trip={trip}
      userId="owner"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Trip name" });
  const description = screen.getByRole("textbox", { name: "Description" });
  fireEvent.change(name, { target: { value: "Japan" } });
  fireEvent.change(description, { target: { value: "Gardens" } });
  expect(updateTrip).not.toHaveBeenCalled();
  fireEvent.blur(name);
  await waitFor(() => expect(name).toBeEnabled());
  expect(updateTrip).toHaveBeenLastCalledWith("owner", "trip", {
    name: "Japan",
    description: "Museums",
  });
  expect(description).toHaveValue("Gardens");
  fireEvent.blur(description);
  await waitFor(() => expect(description).toBeEnabled());
  expect(updateTrip).toHaveBeenLastCalledWith("owner", "trip", {
    name: "Japan",
    description: "Gardens",
  });
  expect(
    screen.queryByRole("button", { name: "Save changes" }),
  ).not.toBeInTheDocument();
});

test("an invalid name remains a draft while a valid independent description can save", async () => {
  vi.mocked(updateTrip).mockImplementation(async (_user, _id, input) => ({
    ...trip,
    ...input,
  }));
  const close = vi.fn();
  render(
    <TripMetadataEditor
      trip={trip}
      userId="owner"
      onSaved={vi.fn()}
      onClose={close}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Trip name" });
  fireEvent.change(name, { target: { value: "" } });
  fireEvent.blur(name);
  expect(updateTrip).not.toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveTextContent("Enter a trip name");
  const description = screen.getByRole("textbox", { name: "Description" });
  fireEvent.change(description, { target: { value: "Gardens" } });
  fireEvent.blur(description);
  await waitFor(() => expect(description).toBeEnabled());
  expect(updateTrip).toHaveBeenCalledWith("owner", "trip", {
    name: "Europe",
    description: "Gardens",
  });
  expect(name).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(close).not.toHaveBeenCalled();
});

test("failed writes preserve the draft, disable controls while saving, and offer retry", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(updateTrip)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    )
    .mockResolvedValueOnce({ ...trip, name: "Japan" });
  render(
    <TripMetadataEditor
      trip={trip}
      userId="owner"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Trip name" });
  fireEvent.change(name, { target: { value: "Japan" } });
  fireEvent.blur(name);
  expect(name).toBeDisabled();
  expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();
  reject(new Error("Offline"));
  const retry = await screen.findByRole("button", {
    name: "Retry trip changes",
  });
  expect(name).toHaveValue("Japan");
  fireEvent.click(retry);
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("Trip changes saved."),
  );
  expect(updateTrip).toHaveBeenCalledTimes(2);
});

test("conflicts preserve edits until explicit refresh and never replay them", async () => {
  const { ResourceConflictError } = await import("../../api/tripSnapshot");
  vi.mocked(updateTrip).mockRejectedValue(
    new ResourceConflictError("Trip changed", 412),
  );
  vi.mocked(getTrip).mockResolvedValue({
    ...trip,
    name: "Another planner's name",
  });
  render(
    <TripMetadataEditor
      trip={trip}
      userId="owner"
      onSaved={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  const name = screen.getByRole("textbox", { name: "Trip name" });
  fireEvent.change(name, { target: { value: "My unsaved name" } });
  fireEvent.blur(name);
  fireEvent.click(await screen.findByRole("button", { name: "Refresh trip" }));
  await waitFor(() => expect(name).toHaveValue("Another planner's name"));
  expect(screen.getByText("My unsaved name")).toBeInTheDocument();
  expect(updateTrip).toHaveBeenCalledTimes(1);
  expect(getTrip).toHaveBeenCalledWith("owner", "trip", undefined, true);
});

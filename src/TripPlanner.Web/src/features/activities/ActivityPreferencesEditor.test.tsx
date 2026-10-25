import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import ActivityPreferencesEditor from "./ActivityPreferencesEditor";
import { planningRequest } from "./activityPlanApi";

vi.mock("./activityPlanApi", () => ({ planningRequest: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const value = {
  data: { instructions: "Museums", defaults: null },
  etag: '"1"',
};

test.each([
  "/user/activity-preferences",
  "/trips/trip/activity-preferences",
  "/trips/trip/destinations/paris/activity-preferences",
])(
  "independent text saves on blur with the complete resource and concurrency token: %s",
  async (path) => {
    vi.mocked(planningRequest)
      .mockResolvedValueOnce(value)
      .mockResolvedValueOnce({
        data: { ...value.data, instructions: "Gardens" },
        etag: '"2"',
      });
    render(<ActivityPreferencesEditor path={path} label="Interests" />);
    fireEvent.click(screen.getByRole("button", { name: "Interests" }));
    const input = await screen.findByRole("textbox", { name: "Interests" });
    fireEvent.change(input, { target: { value: "Gardens" } });
    expect(planningRequest).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Save preferences" }),
    ).not.toBeInTheDocument();
    fireEvent.blur(input);
    await waitFor(() =>
      expect(planningRequest).toHaveBeenCalledWith(path, {
        method: "PUT",
        etag: '"1"',
        body: { instructions: "Gardens", defaults: null },
      }),
    );
    expect(await screen.findByText("Preferences saved.")).toBeVisible();
    fireEvent.blur(input);
    expect(planningRequest).toHaveBeenCalledTimes(2);
  },
);

test("a failed automatic save retains the draft across collapse and can retry", async () => {
  vi.mocked(planningRequest)
    .mockResolvedValueOnce(value)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValueOnce({
      ...value,
      data: { ...value.data, instructions: "Gardens" },
    });
  render(<ActivityPreferencesEditor path="/preferences" label="Interests" />);
  const toggle = screen.getByRole("button", { name: "Interests" });
  fireEvent.click(toggle);
  const input = await screen.findByRole("textbox");
  fireEvent.change(input, { target: { value: "Gardens" } });
  fireEvent.blur(input);
  await screen.findByRole("button", { name: "Retry preferences" });
  expect(screen.getByRole("textbox")).toHaveValue("Gardens");
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect(screen.getByRole("textbox")).toHaveValue("Gardens");
  fireEvent.click(screen.getByRole("button", { name: "Retry preferences" }));
  expect(await screen.findByText("Preferences saved.")).toBeVisible();
  expect(planningRequest).toHaveBeenCalledTimes(3);
});

test("read-only and unchanged interests never write", async () => {
  vi.mocked(planningRequest).mockResolvedValue(value);
  render(
    <ActivityPreferencesEditor
      path="/preferences"
      label="Interests"
      readOnly
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Interests" }));
  const input = await screen.findByRole("textbox");
  fireEvent.blur(input);
  expect(input).toHaveAttribute("readonly");
  expect(planningRequest).toHaveBeenCalledTimes(1);
});

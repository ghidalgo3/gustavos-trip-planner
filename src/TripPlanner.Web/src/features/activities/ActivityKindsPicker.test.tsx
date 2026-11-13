import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, test, vi } from "vitest";
import ActivityKindsPicker from "./ActivityKindsPicker";
import { listActivityKinds, type ActivityKindPage } from "./activityKindsApi";

vi.mock("./activityKindsApi", () => ({ listActivityKinds: vi.fn() }));
beforeEach(() => vi.mocked(listActivityKinds).mockReset());

function show(disabled = false) {
  function Editor() {
    const [value, setValue] = useState<string[]>(["Art"]);
    return (
      <ActivityKindsPicker
        value={value}
        onChange={setValue}
        disabled={disabled}
      />
    );
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <Editor />
    </FluentProvider>,
  );
  return screen.getByRole("combobox", { name: "Kinds" });
}

test("browses owned kinds on focus, searches while typing, and accepts suggestions or new labels", async () => {
  vi.mocked(listActivityKinds).mockResolvedValue({
    kinds: ["Art", "Architecture"],
    hasMore: false,
  });
  const input = show();
  expect(listActivityKinds).not.toHaveBeenCalled();
  fireEvent.focus(input);
  fireEvent.click(await screen.findByRole("option", { name: "Architecture" }));
  expect(listActivityKinds).toHaveBeenCalledWith(
    { search: "" },
    expect.any(AbortSignal),
  );
  expect(screen.getByLabelText("Remove Architecture")).toBeVisible();
  expect(input).toHaveValue("");
  expect(screen.getByLabelText("Remove Art")).toBeVisible();
  fireEvent.click(screen.getByLabelText("Remove Art"));
  expect(screen.queryByLabelText("Remove Art")).not.toBeInTheDocument();
  fireEvent.change(input, { target: { value: "Nightlife" } });
  await waitFor(() =>
    expect(listActivityKinds).toHaveBeenLastCalledWith(
      { search: "Nightlife" },
      expect.any(AbortSignal),
    ),
  );
  expect(input).toHaveValue("Nightlife");
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  expect(screen.getByLabelText("Remove Nightlife")).toBeVisible();
  expect(input).toHaveAttribute("maxlength", "200");
});

test("debounces searches, shows a kind skeleton, and discards late responses", async () => {
  let finish!: (page: ActivityKindPage) => void;
  vi.mocked(listActivityKinds)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ kinds: ["Nightlife"], hasMore: false });
  const input = show();
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: "a" } });
  fireEvent.change(input, { target: { value: "ar" } });
  expect(screen.getByLabelText("Loading kind suggestions")).toBeVisible();
  await waitFor(() => expect(listActivityKinds).toHaveBeenCalledTimes(1));
  expect(listActivityKinds).toHaveBeenLastCalledWith(
    { search: "ar" },
    expect.any(AbortSignal),
  );
  const signal = vi.mocked(listActivityKinds).mock.calls[0][1]!;
  fireEvent.change(input, { target: { value: "night" } });
  expect(signal.aborted).toBe(true);
  expect(
    await screen.findByRole("option", { name: "Nightlife" }),
  ).toBeVisible();
  finish({ kinds: ["Architecture"], hasMore: false });
  await waitFor(() =>
    expect(
      screen.queryByRole("option", { name: "Architecture" }),
    ).not.toBeInTheDocument(),
  );
  expect(input).toHaveValue("night");
});

test("failed suggestions preserve custom text and can be retried", async () => {
  vi.mocked(listActivityKinds)
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ kinds: ["Custom label"], hasMore: false });
  const input = show();
  fireEvent.change(input, { target: { value: "Custom label" } });
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry kind suggestions" }),
  );
  expect(input).toHaveValue("Custom label");
  fireEvent.click(await screen.findByRole("option", { name: "Custom label" }));
  expect(input).toHaveValue("");
  expect(screen.getByLabelText("Remove Custom label")).toBeVisible();
});

test("disabled fields never request suggestions", async () => {
  const input = show(true);
  expect(input).toBeDisabled();
  fireEvent.focus(input);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(listActivityKinds).not.toHaveBeenCalled();
});

test("commits custom text on leaving the picker without adding blanks or duplicate tags", () => {
  vi.mocked(listActivityKinds).mockResolvedValue({ kinds: [], hasMore: false });
  const input = show();
  fireEvent.change(input, { target: { value: "Street photography" } });
  fireEvent.blur(input, { relatedTarget: document.body });
  expect(screen.getByLabelText("Remove Street photography")).toBeVisible();
  fireEvent.change(input, { target: { value: "Art" } });
  fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
  expect(screen.getAllByLabelText("Remove Art")).toHaveLength(1);
});

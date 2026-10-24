import { act, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import AsyncAutocomplete from "./AsyncAutocomplete";

test.each([false, true])(
  "autocomplete uses skeletons until results or an error arrive (failure: %s)",
  async (fail) => {
    let resolve!: (items: string[]) => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<string[]>((success, failure) => {
      resolve = success;
      reject = failure;
    });
    const search = vi.fn(() => pending);
    const { container } = render(
      <FluentProvider theme={webLightTheme}>
        <AsyncAutocomplete
          label="City"
          placeholder="Find a city"
          inputValue="Pa"
          search={search}
          getOptionValue={(value) => value}
          getOptionText={(value) => value}
          onInputChange={vi.fn()}
          onOptionSelect={vi.fn()}
          debounceMs={0}
        />
      </FluentProvider>,
    );
    const skeleton = await screen.findByRole("status", {
      name: "Searching City",
    });
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".fui-Skeleton")).not.toBeNull();
    expect(container.querySelector(".fui-Spinner")).toBeNull();
    await act(async () => {
      if (fail) reject(new Error("City search unavailable"));
      else resolve(["Paris"]);
    });
    expect(screen.queryByRole("status", { name: "Searching City" })).toBeNull();
    if (fail) expect(screen.getByText("City search unavailable")).toBeVisible();
    else
      expect(
        await screen.findByRole("option", { name: "Paris" }),
      ).toBeVisible();
  },
);

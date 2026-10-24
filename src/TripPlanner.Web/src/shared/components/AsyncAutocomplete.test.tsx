import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test, vi } from "vitest";
import AsyncAutocomplete from "./AsyncAutocomplete";

test.each(["button", "keyboard"])(
  "a selected city can reopen its existing suggestions using the %s without another search",
  async (method) => {
    const search = vi.fn(() => Promise.resolve(["Paris", "Rome"]));
    function CityPicker() {
      const [query, setQuery] = useState("Pa");
      const [selected, setSelected] = useState<string>();
      return (
        <AsyncAutocomplete
          label="City"
          placeholder="Find a city"
          inputValue={query}
          selectedOptionValue={selected}
          selectedOptionLabel={selected}
          search={search}
          getOptionValue={(value) => value}
          getOptionText={(value) => value}
          onInputChange={(value) => {
            setQuery(value);
            setSelected(undefined);
          }}
          onOptionSelect={(value) => {
            setSelected(value);
            setQuery(value);
          }}
          debounceMs={0}
        />
      );
    }
    render(
      <FluentProvider theme={webLightTheme}>
        <CityPicker />
      </FluentProvider>,
    );
    fireEvent.click(await screen.findByRole("option", { name: "Paris" }));
    const input = screen.getByRole("combobox", { name: "City" });
    expect(input).toHaveValue("Paris");
    expect(screen.queryByRole("option", { name: "Paris" })).toBeNull();
    if (method === "button")
      fireEvent.mouseDown(screen.getByRole("button", { name: "Open City" }));
    else fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(await screen.findByRole("option", { name: "Paris" })).toBeVisible();
    expect(screen.getByRole("option", { name: "Rome" })).toBeVisible();
    expect(input).toHaveValue("Paris");
    expect(search).toHaveBeenCalledTimes(1);
  },
);

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
    expect(skeleton.querySelectorAll(".search-result-skeleton")).toHaveLength(
      2,
    );
    expect(skeleton.querySelector(".skeleton-panel")).toBeNull();
    expect(skeleton.querySelector(".flight-grid-card")).toBeNull();
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

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useSearchParams } from "react-router";
import { afterEach, expect, test, vi } from "vitest";
import ScrollPositionRestoration from "./ScrollPositionRestoration";

afterEach(() => {
  sessionStorage.clear();
  Reflect.deleteProperty(document.documentElement, "scrollHeight");
  vi.restoreAllMocks();
});

test("restores a saved flight-page position after refresh", async () => {
  sessionStorage.setItem("tripplanner:scroll:/trips/one/flights", "800");
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 2000,
  });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  render(
    <MemoryRouter initialEntries={["/trips/one/flights"]}>
      <ScrollPositionRestoration />
    </MemoryRouter>,
  );
  await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(0, 800));
});

test("destination tab changes preserve the current viewport instead of restoring per-city offsets", async () => {
  sessionStorage.setItem(
    "tripplanner:scroll:/trips/one/activities?destination=rome",
    "1500",
  );
  Object.defineProperty(document.documentElement, "scrollHeight", {
    configurable: true,
    value: 3000,
  });
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  function Tabs() {
    const [query, setQuery] = useSearchParams();
    return (
      <>
        <button
          onClick={() =>
            setQuery({ destination: "rome" }, { preventScrollReset: true })
          }
        >
          Rome
        </button>
        <span>{query.get("destination")}</span>
      </>
    );
  }
  render(
    <MemoryRouter initialEntries={["/trips/one/activities?destination=paris"]}>
      <ScrollPositionRestoration />
      <Tabs />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Rome" }));
  await waitFor(() => expect(screen.getByText("rome")).toBeInTheDocument());
  await new Promise((resolve) => window.requestAnimationFrame(resolve));
  expect(scrollTo).not.toHaveBeenCalled();
});

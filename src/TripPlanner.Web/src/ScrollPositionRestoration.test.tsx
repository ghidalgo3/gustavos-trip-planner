import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

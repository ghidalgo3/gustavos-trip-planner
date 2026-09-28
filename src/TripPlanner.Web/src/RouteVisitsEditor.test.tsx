import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test } from "vitest";
import RouteVisitsEditor from "./RouteVisitsEditor";
import type { PlanningDocument } from "./planningApi";

test("edits nights and required stays without requiring flight dates", () => {
  const draft: PlanningDocument = {
    schemaVersion: 1,
    destination: null,
    parties: [],
    constraints: [],
    visits: [
      {
        id: "phuket",
        location: { code: "HKT", timeZone: "Asia/Bangkok", label: "Phuket" },
        nights: null,
        presentFrom: "2030-05-02",
        presentThrough: "2030-05-05",
        afterVisitIds: [],
      },
      {
        id: "hongkong",
        location: {
          code: "HKG",
          timeZone: "Asia/Hong_Kong",
          label: "Hong Kong",
        },
        nights: 4,
        presentFrom: null,
        presentThrough: null,
        afterVisitIds: ["phuket"],
      },
    ],
  };
  function Editor() {
    const [document, setDocument] = useState(draft);
    return (
      <>
        <RouteVisitsEditor document={document} onChange={setDocument} />
        <output>{JSON.stringify(document)}</output>
      </>
    );
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <Editor />
    </FluentProvider>,
  );
  expect(
    screen.getByRole("spinbutton", { name: "Visit 2 nights" }),
  ).toHaveValue(4);
  expect(screen.getByLabelText("Visit 1 required from")).toHaveValue(
    "2030-05-02",
  );
  expect(
    screen.getByRole("spinbutton", {
      name: "Flexibility around required stays",
    }),
  ).toHaveValue(5);
  fireEvent.change(screen.getByRole("spinbutton", { name: "Visit 2 nights" }), {
    target: { value: "5" },
  });
  expect(screen.getByRole("status")).toHaveTextContent('"nights":5');
  expect(screen.getByRole("status")).not.toHaveTextContent("travelDates");
  expect(
    screen.getByLabelText("Selected visits before visit 2"),
  ).toHaveTextContent("Visit 1: Phuket");
  fireEvent.click(screen.getByRole("button", { name: "Remove visit 1" }));
  expect(screen.getByRole("status")).toHaveTextContent('"afterVisitIds":[]');
});

test("selects multiple preceding visits and removes them with tags", async () => {
  const draft: PlanningDocument = {
    schemaVersion: 1,
    destination: null,
    parties: [],
    constraints: [],
    visits: [
      {
        id: "phuket",
        location: { code: "HKT", timeZone: "Asia/Bangkok", label: "Phuket" },
        nights: 4,
        presentFrom: null,
        presentThrough: null,
        afterVisitIds: [],
      },
      {
        id: "hongkong",
        location: {
          code: "HKG",
          timeZone: "Asia/Hong_Kong",
          label: "Hong Kong",
        },
        nights: 4,
        presentFrom: null,
        presentThrough: null,
        afterVisitIds: [],
      },
      {
        id: "tokyo",
        location: { code: "HND", timeZone: "Asia/Tokyo", label: "Tokyo" },
        nights: 4,
        presentFrom: null,
        presentThrough: null,
        afterVisitIds: [],
      },
    ],
  };
  function Editor() {
    const [document, setDocument] = useState(draft);
    return (
      <>
        <RouteVisitsEditor document={document} onChange={setDocument} />
        <output>{JSON.stringify(document)}</output>
      </>
    );
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <Editor />
    </FluentProvider>,
  );
  const combobox = screen.getByRole("combobox", {
    name: "Visits before visit 3",
  });
  fireEvent.click(combobox);
  expect(combobox).toHaveAttribute("aria-expanded", "true");
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Visit 1: Phuket" }),
  );
  expect(
    screen.getByLabelText("Selected visits before visit 3"),
  ).toHaveTextContent("Visit 1: Phuket");
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Visit 2: Hong Kong" }),
  );
  const tags = screen.getByLabelText("Selected visits before visit 3");
  expect(tags).toHaveTextContent("Visit 1: Phuket");
  expect(tags).toHaveTextContent("Visit 2: Hong Kong");
  expect(screen.getByRole("status")).toHaveTextContent(
    '"afterVisitIds":["phuket","hongkong"]',
  );
  fireEvent.click(
    within(tags).getByRole("button", { name: /Visit 1: Phuket/ }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    '"afterVisitIds":["hongkong"]',
  );
});

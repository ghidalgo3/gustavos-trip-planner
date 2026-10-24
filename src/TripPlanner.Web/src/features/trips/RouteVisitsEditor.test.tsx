import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test } from "vitest";
import RouteVisitsEditor from "./RouteVisitsEditor";
import type { PlanningDocument } from "../flights/planningApi";

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
    screen.getByRole("spinbutton", { name: "Destination 2 nights" }),
  ).toHaveValue(4);
  expect(screen.getByLabelText("Destination 1 required from")).toHaveValue(
    "2030-05-02",
  );
  expect(
    screen.getByRole("spinbutton", {
      name: "Flexibility around required stays",
    }),
  ).toHaveValue(5);
  fireEvent.change(
    screen.getByRole("spinbutton", { name: "Destination 2 nights" }),
    {
      target: { value: "5" },
    },
  );
  expect(screen.getByRole("status")).toHaveTextContent('"nights":5');
  expect(screen.getByRole("status")).not.toHaveTextContent("travelDates");
  fireEvent.click(screen.getByRole("button", { name: "Remove destination 1" }));
  expect(screen.getByRole("status")).toHaveTextContent('"afterVisitIds":[]');
});

test("keeps destination order fixed and allows more than three visits", () => {
  function Editor() {
    const [document, setDocument] = useState<PlanningDocument>({
      schemaVersion: 1,
      destination: null,
      parties: [],
      constraints: [],
      visits: Array.from({ length: 3 }, (_, index) => ({
        id: String(index),
        location: null,
        nights: 2,
        presentFrom: null,
        presentThrough: null,
        afterVisitIds: [],
      })),
    });
    return <RouteVisitsEditor document={document} onChange={setDocument} />;
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <Editor />
    </FluentProvider>,
  );
  for (let index = 4; index <= 8; index++) {
    fireEvent.click(screen.getByRole("button", { name: "Add destination" }));
    expect(
      screen.getByRole("spinbutton", { name: `Destination ${index} nights` }),
    ).toBeVisible();
  }
  expect(
    screen.queryByRole("combobox", { name: /Destinations before/ }),
  ).toBeNull();
});

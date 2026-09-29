import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { expect, test } from "vitest";
import AirlineCombobox from "./AirlineCombobox";

test("searches names and selects multiple airline codes", async () => {
  function Editor() {
    const [codes, setCodes] = useState<string[]>([]);
    return <AirlineCombobox value={codes} onChange={setCodes} />;
  }
  render(
    <FluentProvider theme={webLightTheme}>
      <Editor />
    </FluentProvider>,
  );
  const search = screen.getByRole("combobox", {
    name: "Search preferred airlines",
  });
  fireEvent.change(search, { target: { value: "Delta" } });
  fireEvent.click(search);
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", {
      name: "Delta Air Lines (DL)",
    }),
  );
  expect(screen.getByLabelText("Preferred airlines")).toHaveTextContent(
    "Delta Air Lines (DL)",
  );
  fireEvent.change(search, { target: { value: "Air France" } });
  fireEvent.click(
    await screen.findByRole("menuitemcheckbox", { name: "Air France (AF)" }),
  );
  const selected = screen.getByLabelText("Preferred airlines");
  expect(selected).toHaveTextContent("Delta Air Lines (DL)");
  expect(selected).toHaveTextContent("Air France (AF)");
});

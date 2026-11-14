import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

test("the consolidated document retains distributed software notices", () => {
  const licenses = readFileSync("public/notices/software-licenses.txt", "utf8");
  for (const notice of [
    "Flagpack",
    "Copyright (c) 2021 Yummygum",
    "airportsdata",
    "@fluentui/react-components",
    "react",
    "suncalc",
    "All rights reserved.",
    "Apache License",
    "Permission is hereby granted, free of charge",
  ])
    expect(licenses).toContain(notice);
  expect(licenses).not.toContain("Npgsql");
  expect(licenses).not.toContain("License: 0BSD");
});

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Fluent UI's focus management reads this browser global directly.
Object.defineProperty(globalThis, "NodeFilter", { value: window.NodeFilter });

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

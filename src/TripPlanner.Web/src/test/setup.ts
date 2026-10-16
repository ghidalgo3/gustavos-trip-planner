import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Fluent UI's focus management reads this browser global directly.
Object.defineProperty(globalThis, "NodeFilter", { value: window.NodeFilter });

beforeEach(() => {
  // jsdom has no layout: offsetParent is always null and the body has no size.
  // Tabster interprets both as hidden content, so dialogs focus their container
  // instead of a control and can later be marked aria-hidden. Supply visible-page
  // geometry while preserving display:none checks and real focus management.
  Object.defineProperty(document.body, "getBoundingClientRect", {
    configurable: true,
    value: () => new DOMRect(0, 0, window.innerWidth, window.innerHeight),
  });
  Object.defineProperty(HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get(this: HTMLElement) {
      if (
        !this.isConnected ||
        this === this.ownerDocument.body ||
        window.getComputedStyle(this).position === "fixed" ||
        window.getComputedStyle(this).display === "none"
      )
        return null;
      for (
        let element: HTMLElement | null = this.parentElement;
        element;
        element = element.parentElement
      ) {
        if (window.getComputedStyle(element).display === "none") return null;
      }
      return this.parentElement;
    },
  });
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => window.setTimeout(resolve, 0));
});

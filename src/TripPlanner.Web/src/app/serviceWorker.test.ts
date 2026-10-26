/// <reference types="node" />
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, test, vi } from "vitest";

type WorkerEvent = {
  request: { method: string; url: string; mode: string };
  respondWith: ReturnType<typeof vi.fn>;
  waitUntil: ReturnType<typeof vi.fn>;
};
function worker() {
  const handlers = new Map<string, (event: WorkerEvent) => void>();
  const cache = {
    put: vi.fn(),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn(),
  };
  const caches = { open: vi.fn().mockResolvedValue(cache), match: vi.fn() };
  const fetch = vi.fn();
  runInNewContext(readFileSync("public/sw.js", "utf8"), {
    self: {
      location: { origin: "https://planner.test" },
      addEventListener: (name: string, handler: (event: WorkerEvent) => void) =>
        handlers.set(name, handler),
    },
    fetch,
    caches,
    URL,
    Response,
  });
  function navigate(path: string) {
    const event: WorkerEvent = {
      request: {
        method: "GET",
        url: `https://planner.test${path}`,
        mode: "navigate",
      },
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };
    handlers.get("fetch")!(event);
    return event;
  }
  return { fetch, cache, caches, navigate };
}
test.each([
  "/oauth/authorize",
  "/.auth/login/google",
  "/user",
  "/trips/11111111-1111-1111-1111-111111111111/snapshot",
])("private navigation %s never enters the shell cache", (path) => {
  const app = worker();
  expect(app.navigate(path).respondWith).not.toHaveBeenCalled();
  expect(app.fetch).not.toHaveBeenCalled();
  expect(app.cache.put).not.toHaveBeenCalled();
});
test("offline trip navigation serves the last complete application shell", async () => {
  const app = worker();
  app.fetch.mockRejectedValue(new Error("offline"));
  app.caches.match.mockResolvedValue(new Response("saved application"));
  const event = app.navigate(
    "/trips/11111111-1111-1111-1111-111111111111/activities",
  );
  const response = (await event.respondWith.mock.calls[0][0]) as Response;
  expect(await response.text()).toBe("saved application");
});
test("a failed asset download preserves the previous offline shell", async () => {
  const app = worker();
  app.fetch
    .mockResolvedValueOnce(
      new Response('<script src="/assets/index-new.js"></script>', {
        headers: { "Content-Type": "text/html" },
      }),
    )
    .mockRejectedValueOnce(new Error("offline"));
  const event = app.navigate("/");
  await event.respondWith.mock.calls[0][0];
  await expect(event.waitUntil.mock.calls[0][0]).rejects.toThrow("offline");
  expect(app.cache.put).not.toHaveBeenCalledWith(
    "/index.html",
    expect.anything(),
  );
  expect(app.cache.delete).not.toHaveBeenCalled();
});

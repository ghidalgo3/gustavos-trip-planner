import { beforeEach, expect, test, vi } from "vitest";
import { tripFetch } from "../../api/tripDocumentStore";
import { listActivityKinds } from "./activityKindsApi";

vi.mock("../../api/tripDocumentStore", () => ({ tripFetch: vi.fn() }));
beforeEach(() => vi.mocked(tripFetch).mockReset());

test("kind queries preserve literal search characters and pagination without caching account data", async () => {
  const page = { kinds: ["Art & food + 100%"], hasMore: true };
  vi.mocked(tripFetch).mockResolvedValue(new Response(JSON.stringify(page)));
  const controller = new AbortController();
  expect(
    await listActivityKinds(
      { search: "Art & food + 100%", top: 3, skip: 6 },
      controller.signal,
    ),
  ).toEqual(page);
  const [path, options] = vi.mocked(tripFetch).mock.calls[0];
  const url = new URL(String(path), "https://example.com");
  expect(url.pathname).toBe("/user/activity-kinds");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    search: "Art & food + 100%",
    top: "3",
    skip: "6",
  });
  expect(options).toMatchObject({
    credentials: "include",
    cache: "no-store",
    signal: controller.signal,
  });
});

test("failed requests expose an optional-suggestions error", async () => {
  vi.mocked(tripFetch).mockResolvedValue(new Response("", { status: 503 }));
  await expect(listActivityKinds()).rejects.toThrow(
    "Kind suggestions are unavailable.",
  );
});

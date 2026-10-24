import { afterEach, expect, test, vi } from "vitest";
import type { ITelemetryItem } from "@microsoft/applicationinsights-web";
import {
  createTelemetryClient,
  initializeTelemetry,
  isApiRequest,
  safePath,
  sanitizeTelemetry,
} from "./telemetry";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test.each([
  [
    "/user/secret-user/trips/private-trip?token=secret#private",
    "/user/:id/trips/:id",
  ],
  [
    "/trips/private-trip/destinations/private-city/activities/private-activity",
    "/trips/:id/destinations/:id/activities/:id",
  ],
])(
  "URLs omit identifiers, query strings and fragments: %s",
  (input, expected) => {
    expect(safePath(input)).toBe(expected);
  },
);

test.each([
  ["/user", true],
  ["/trips/id/flights:search", true],
  ["/users?query=someone@example.com", true],
  ["/calendars/bearer-secret.ics", false],
  ["/mapToken", false],
  ["/.auth/login/google", false],
  ["/user/avatar", false],
  ["https://atlas.microsoft.com/search?query=home", false],
  ["https://other.example/user", false],
])("only application API dependencies are collected: %s", (url, expected) => {
  expect(isApiRequest(url)).toBe(expected);
});

test("dependency telemetry keeps timing and correlation without sensitive URLs or properties", () => {
  const item: ITelemetryItem = {
    name: "dependency",
    baseType: "RemoteDependencyData",
    time: new Date().toISOString(),
    ext: {
      trace: { traceID: "trace-id", name: "private title" },
      web: { referrer: "secret" },
    },
    data: { secret: "private" },
    baseData: {
      data: `${location.origin}/users?query=someone@example.com`,
      name: "raw URL",
      duration: 123,
      id: "span-id",
      resultCode: 200,
      properties: { authorization: "secret" },
    },
  };
  expect(sanitizeTelemetry(item)).toBe(true);
  expect(item.baseData).toMatchObject({
    data: `${location.origin}/users`,
    duration: 123,
    id: "span-id",
    properties: {},
  });
  expect(item.ext?.trace.traceID).toBe("trace-id");
  expect(JSON.stringify(item)).not.toMatch(/someone@example|private|secret/);
});

test("automatic exceptions omit arbitrary messages and stack content", () => {
  const item: ITelemetryItem = {
    name: "exception",
    baseType: "ExceptionData",
    time: "",
    baseData: {
      exceptions: [
        {
          typeName: "TypeError",
          message: "bearer-secret",
          stack: "bearer-secret",
          parsedStack: [{ fileName: "bearer-secret" }],
        },
      ],
    },
  };
  expect(sanitizeTelemetry(item)).toBe(true);
  expect(JSON.stringify(item)).not.toContain("bearer-secret");
});

test.each([null, "unavailable"])(
  "missing configuration or an unavailable API leaves analytics disabled: %s",
  async (value) => {
    vi.stubGlobal(
      "fetch",
      value === "unavailable"
        ? vi.fn().mockRejectedValue(new Error("offline"))
        : vi
            .fn()
            .mockResolvedValue(
              new Response(JSON.stringify({ connectionString: value })),
            ),
    );
    await expect(initializeTelemetry()).resolves.toBeUndefined();
  },
);

test("the real SDK correlates API calls with W3C headers and excludes sensitive and third-party calls", async () => {
  const sent: { url: string; headers: Headers }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers) });
      return new Response("{}", { status: 200 });
    }),
  );
  const client = await createTelemetryClient(
    "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://example.invalid/",
  );
  const captured: ITelemetryItem[] = [];
  client.addTelemetryInitializer((item) => {
    captured.push(item);
    return false;
  });
  const traceId = "1234567890abcdef1234567890abcdef";
  client.core.getTraceCtx()?.setTraceId(traceId);
  try {
    sent.length = 0;
    await fetch("/user");
    await fetch(
      `${location.origin}/trips/private-trip/destinations?query=secret`,
    );
    await fetch("https://atlas.microsoft.com/search?query=home");
    await fetch("/calendars/bearer-secret.ics");
    await fetch("/mapToken");
    for (const call of sent.slice(0, 2)) {
      expect(call.headers.get("traceparent")).toMatch(
        new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`),
      );
      expect(call.headers.has("Request-Id")).toBe(false);
    }
    for (const call of sent.slice(2))
      expect(call.headers.has("traceparent")).toBe(false);
    await vi.waitFor(() =>
      expect(
        captured.filter((item) => item.baseType === "RemoteDependencyData"),
      ).toHaveLength(2),
    );
    expect(JSON.stringify(captured)).not.toMatch(
      /private-trip|query=|bearer-secret/,
    );
  } finally {
    client.unload(false);
  }
});

test("an explicitly configured cross-origin API also receives W3C trace headers", async () => {
  vi.resetModules();
  vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test:8443/v1");
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", fetchMock);
  const { createTelemetryClient: createClient } = await import("./telemetry");
  const client = await createClient(
    "InstrumentationKey=00000000-0000-0000-0000-000000000001;IngestionEndpoint=https://example.invalid/",
  );
  client.addTelemetryInitializer(() => false);
  try {
    await fetch("https://api.example.test:8443/v1/user", {
      credentials: "include",
    });
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("traceparent")).toMatch(
      /^00-[a-f0-9]{32}-[a-f0-9]{16}-01$/,
    );
  } finally {
    client.unload(false);
  }
});

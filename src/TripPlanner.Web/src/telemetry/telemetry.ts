import type {
  ApplicationInsights,
  ITelemetryItem,
} from "@microsoft/applicationinsights-web";

export type BehaviorEvent =
  | "sign_in_started"
  | "session_authenticated"
  | "onboarding_viewed"
  | "onboarding_completed"
  | "trip_creation_started"
  | "trip_creation_submitted"
  | "trip_creation_cancelled"
  | "trip_creation_failed"
  | "trip_created"
  | "destination_added"
  | "flight_search_started"
  | "flight_search_queued"
  | "flight_search_rejected"
  | "flight_choices_saved"
  | "activity_creation_started"
  | "activity_saved"
  | "activity_suggestions_started"
  | "activity_suggestions_completed"
  | "activity_suggestions_failed";

let insights: ApplicationInsights | undefined;
const apiBase = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");
const apiUrl = () => new URL(apiBase || "/", window.location.origin);

// Only fixed route vocabulary may leave the browser. IDs, search terms, query
// strings, fragments, titles and referrers can contain personal data or tokens.
const routeWords = new Set(
  "user users profile trips destinations activities flights party parties operations airports service constraints stays activity-log mcp-access calendar-subscriptions activity-preferences plans previews assessments proposals review suggestions locations details visits choices purchases bookingLinks search prompts results flights:search flights:prompt".split(
    " ",
  ),
);

export function safePath(path: string): string {
  return (
    "/" +
    path
      .split(/[?#]/, 1)[0]
      .split("/")
      .filter(Boolean)
      .map((part) => (routeWords.has(part) ? part : ":id"))
      .join("/")
  );
}

export function pageName(path: string): string {
  if (path === "/") return "Trips";
  if (path === "/profile") return "Profile";
  const match = /^\/trips\/[^/]+(?:\/(activities|flights|party))?\/?$/.exec(
    path,
  );
  return match ? `Trip ${match[1] ?? "overview"}` : "Other";
}

export function isApiRequest(value: string): boolean {
  try {
    const url = new URL(value, window.location.origin);
    const base = apiUrl();
    const prefix = base.pathname.replace(/\/$/, "");
    if (url.origin !== base.origin || !url.pathname.startsWith(`${prefix}/`))
      return false;
    const path = url.pathname.slice(prefix.length);
    return (
      /^\/(user|users|trips|operations|airports|service)(\/|$)/.test(path) &&
      path !== "/user/avatar"
    );
  } catch {
    return false;
  }
}

export function sanitizeTelemetry(item: ITelemetryItem): boolean {
  const data = item.baseData;
  if (!data) return false;
  // No arbitrary custom properties, DOM content or SDK exception messages.
  data.properties = {};
  item.data = {};
  Object.assign((item.tags ??= []), { "ai.cloud.role": "TripPlanner.Web" });
  if (item.ext?.web) item.ext.web = {};
  if (item.ext?.trace) {
    item.ext.trace.name = pageName(window.location.pathname);
  }
  if (item.baseType === "RemoteDependencyData") {
    const target = String(data.target ?? data.data ?? "");
    if (!isApiRequest(target)) return false;
    const url = new URL(target, window.location.origin);
    data.data = `${url.origin}${safePath(url.pathname)}`;
    data.name = safePath(url.pathname);
    // The JS SDK takes a full URL here and serializes it into target + data.
    data.target = data.data;
    delete data.correlationContext;
  } else if (
    item.baseType === "PageviewData" ||
    item.baseType === "PageviewPerformanceData"
  ) {
    data.uri = `${window.location.origin}${safePath(window.location.pathname)}`;
    data.name = pageName(window.location.pathname);
    delete data.refUri;
  } else if (item.baseType === "ExceptionData") {
    for (const exception of data.exceptions ?? []) {
      exception.message = "Client error (message omitted for privacy)";
      exception.stack = "";
      exception.parsedStack = [];
      exception.hasFullStack = false;
    }
  } else if (item.baseType !== "EventData") {
    return false;
  }
  return true;
}

export async function initializeTelemetry(): Promise<void> {
  try {
    const response = await fetch(`${apiBase}/telemetry/config`, {
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    });
    if (!response.ok) return;
    const { connectionString } = await response.json();
    if (!connectionString || insights) return;
    insights = await createTelemetryClient(connectionString);
  } catch {
    // Analytics must never prevent the application from starting.
  }
}

export async function createTelemetryClient(
  connectionString: string,
): Promise<ApplicationInsights> {
  const { ApplicationInsights, DistributedTracingModes } =
    await import("@microsoft/applicationinsights-web");
  const base = apiUrl();
  const escape = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const apiPattern = `(?:${escape(base.origin)})?${escape(base.pathname.replace(/\/$/, ""))}`;
  const client = new ApplicationInsights({
    config: {
      connectionString,
      samplingPercentage: 100,
      enableAutoRouteTracking: false,
      enableCorsCorrelation: true,
      distributedTracingMode: DistributedTracingModes.W3C,
      correlationHeaderDomains: [apiUrl().host],
      correlationHeaderExcludePatterns: [
        /\/(?:calendars|\.auth|oauth|mapToken|telemetry)(?:\/|\?|$)/,
      ],
      // Ignore third-party requests and sensitive endpoints before collection.
      excludeRequestFromAutoTrackingPatterns: [
        new RegExp(
          `^(?!${apiPattern}/(?:user|users|trips|operations|airports|service)(?:/|\\?|$))`,
          "i",
        ),
        /\/user\/avatar(?:\?|$)/,
      ],
      enableRequestHeaderTracking: false,
      enableResponseHeaderTracking: false,
      disableAjaxTracking: false,
      disableFetchTracking: false,
      enableUnhandledPromiseRejectionTracking: true,
      enableAjaxErrorStatusText: false,
      disableCookiesUsage: false,
      enableSessionStorageBuffer: false,
      extensionConfig: {
        AppInsightsCfgSyncPlugin: { blkCdnCfg: true, syncMode: 0 },
      },
      disablePageUnloadEvents: ["unload"],
    },
  });
  client.addTelemetryInitializer(sanitizeTelemetry);
  client.loadAppInsights();
  return client;
}

export function trackBehavior(name: BehaviorEvent): void {
  insights?.trackEvent({ name });
}

export function trackPage(path: string): void {
  if (!insights) return;
  // A fresh operation per navigation groups subsequent API dependencies with it.
  const trace = insights.core.getTraceCtx();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  trace?.setTraceId(
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""),
  );
  trace?.setName(pageName(path));
  insights.trackPageView({
    name: pageName(path),
    uri: `${window.location.origin}${safePath(path)}`,
  });
}

export function identifyUser(id?: string): void {
  if (id) insights?.setAuthenticatedUserContext(id);
  else insights?.clearAuthenticatedUserContext();
}

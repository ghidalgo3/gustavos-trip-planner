/* Public application shell only. Account-scoped trip data is managed by the
   application cache; cookies, consent pages and API responses never enter here. */
const shellCache = "tripplanner-shell-v2";
const publicFiles = [
  "/manifest.webmanifest",
  "/icons/trip-planner-icon.png",
  "/auth/sign-in-with-google.svg",
  "/auth/sign-in-with-microsoft.svg",
  "/artwork/cities.svg",
  "/artwork/flags.svg",
  "/artwork/city-icons-LICENSE.txt",
  "/artwork/flagpack-LICENSE.txt",
  "/notices/software-licenses.txt",
];
let shellUpdate;
async function storeShell(response) {
  if (
    !response.ok ||
    response.redirected ||
    !response.headers.get("Content-Type")?.includes("text/html")
  )
    throw new Error("The application shell is unavailable");
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(
    (match) => match[1],
  );
  if (!assets.length) throw new Error("The application shell has no assets");
  const cache = await caches.open(shellCache);
  await Promise.all(
    [...new Set([...assets, ...publicFiles])].map(async (asset) => {
      const resource = await fetch(asset, {
        cache: "reload",
        credentials: "omit",
      });
      if (!resource.ok || resource.redirected)
        throw new Error("Could not cache application assets");
      await cache.put(asset, resource);
    }),
  );
  // Switch shells only after every dependency is stored. Keep older hashed
  // assets so an already open page can still load its code while disconnected.
  await cache.put("/index.html", response.clone());
}
function refreshShell() {
  if (!shellUpdate) {
    shellUpdate = fetch("/index.html", { cache: "reload", credentials: "omit" })
      .then(storeShell)
      .finally(() => {
        shellUpdate = undefined;
      });
  }
  return shellUpdate;
}
self.addEventListener("install", (event) => {
  event.waitUntil(refreshShell().then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate" && !publicFiles.includes(url.pathname)) {
    const appPage =
      url.pathname === "/" ||
      url.pathname === "/profile" ||
      url.pathname === "/notices" ||
      /^\/trips\/[0-9a-f-]{36}(?:\/(?:activities|flights|party)(?:\/.*)?)?\/?$/i.test(
        url.pathname,
      );
    if (!appPage) return;
    // Launch without waiting for a broken or slow connection. Revalidate the
    // public shell in the background; the app independently validates sign-in.
    const cached = caches.match("/index.html", { cacheName: shellCache });
    const update = refreshShell();
    event.waitUntil(update.catch(() => undefined));
    event.respondWith(
      cached.then(async (shell) => {
        if (shell) return shell;
        await update.catch(() => undefined);
        return (
          (await caches.match("/index.html", { cacheName: shellCache })) ??
          Response.error()
        );
      }),
    );
  } else if (
    /^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname) ||
    publicFiles.includes(url.pathname)
  ) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok && !response.redirected)
          await (await caches.open(shellCache)).put(request, response.clone());
        return response;
      }),
    );
  }
});

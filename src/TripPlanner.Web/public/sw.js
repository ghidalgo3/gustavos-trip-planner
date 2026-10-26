/* Only public application assets are cached here. Trip data is cached by the
   authenticated, account-scoped snapshot client, never by this worker. */
const shellCache = "tripplanner-shell-v1";
async function storeShell(response) {
  if (
    !response.ok ||
    !response.headers.get("Content-Type")?.includes("text/html")
  )
    return;
  const cache = await caches.open(shellCache);
  const html = await response.clone().text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(
    (match) => match[1],
  );
  if (assets.length === 0) return;
  await Promise.all(
    assets.map(async (asset) => {
      const resource = await fetch(asset);
      if (!resource.ok) throw new Error("Could not cache application assets");
      await cache.put(asset, resource);
    }),
  );
  await cache.put("/index.html", response.clone());
  const keep = new Set(assets);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !keep.has(path))
      await cache.delete(request);
  }
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    fetch("/index.html", { cache: "reload" })
      .then(storeShell)
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // OAuth consent, sign-in and API navigations must never become the shell.
    const appPage =
      url.pathname === "/" ||
      url.pathname === "/profile" ||
      /^\/trips\/[0-9a-f-]{36}(?:\/(?:activities|flights|party)(?:\/.*)?)?\/?$/i.test(
        url.pathname,
      );
    if (!appPage) return;
    event.respondWith(
      fetch(request)
        .then((response) => {
          event.waitUntil(storeShell(response.clone()));
          return response;
        })
        .catch(
          async () => (await caches.match("/index.html")) ?? Response.error(),
        ),
    );
  } else if (/^\/assets\/[^/]+-[A-Za-z0-9_-]+\.(js|css)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok)
          await (await caches.open(shellCache)).put(request, response.clone());
        return response;
      }),
    );
  }
});

import { dependency } from "../scripts/config.mjs";

export async function openPlaywright(profile, url, options) {
  let playwright;
  try {
    playwright = dependency("playwright");
  } catch (error) {
    if (error.cause?.code !== "MODULE_NOT_FOUND") throw error;
    playwright = dependency("@playwright/test");
  }
  const device = profile.device && playwright.devices[profile.device];
  if (profile.device && !device)
    throw new Error(`Unknown Playwright device: ${profile.device}.`);
  const browser = await playwright[profile.browser].launch({
    headless: !options.headed,
  });
  let context;
  try {
    const { defaultBrowserType, ...deviceOptions } = device || {};
    const viewport = {
      width: profile.width ?? deviceOptions.viewport?.width ?? 1440,
      height: profile.height ?? deviceOptions.viewport?.height ?? 900,
    };
    context = await browser.newContext({
      ...deviceOptions,
      viewport,
      deviceScaleFactor: 1,
      locale: "en-US",
      timezoneId: "America/New_York",
      acceptDownloads: false,
      serviceWorkers: "block",
      storageState: options.storageState,
    });
    const blocked = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const target = new URL(request.url());
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(request.method());
      const crossOriginDocument =
        request.isNavigationRequest() && target.origin !== url.origin;
      if (
        (mutating && (!options.writable || target.origin !== url.origin)) ||
        crossOriginDocument
      ) {
        blocked.push({
          method: request.method(),
          kind: crossOriginDocument ? "cross-origin navigation" : "write",
        });
        await route.abort("blockedbyclient");
      } else if (mutating) {
        // Keep fixture writes on the loopback origin even if a response redirects.
        const response = await route.fetch({ maxRedirects: 0 });
        try {
          if (response.status() >= 300 && response.status() < 400) {
            blocked.push({ method: request.method(), kind: "write redirect" });
            await route.abort("blockedbyclient");
          } else {
            await route.fulfill({ response });
          }
        } finally {
          await response.dispose();
        }
      } else {
        await route.continue();
      }
    });
    await context.routeWebSocket("**/*", (socket) =>
      socket.close({ code: 1008, reason: "Audit connection blocked" }),
    );
    await context.addInitScript(() => {
      let count = 0;
      addEventListener(
        "keydown",
        (event) => {
          if (event.isTrusted) count++;
        },
        { capture: true },
      );
      Object.defineProperty(window, "__uxAuditKeyCount", { get: () => count });
    });
    const page = await context.newPage();
    page.on("dialog", (dialog) => dialog.dismiss());
    page.setDefaultTimeout(5000);
    const touch = deviceOptions.hasTouch === true;
    const touchSession =
      touch &&
      profile.browser === "chromium" &&
      (await context.newCDPSession(page));
    return {
      environment: {
        browser: profile.browser,
        browserVersion: browser.version(),
        viewport,
        device: profile.device ?? null,
        touch,
        touchGestures: Boolean(touchSession),
        headed: Boolean(options.headed),
        userAgent: await page.evaluate(() => navigator.userAgent),
      },
      blocked,
      async navigate(start) {
        if (start.origin !== url.origin)
          throw new Error("The starting page must use the audit origin.");
        await page.goto(start.href, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
      },
      async renderedState() {
        for (let attempt = 0; ; attempt++) {
          if (page.isClosed())
            throw new Error(
              "The audit page closed before it could be observed.",
            );
          if (new URL(page.url()).origin !== url.origin)
            throw new Error("The browser left the audit origin.");
          try {
            return await page.evaluate(observeRenderedPage);
          } catch (error) {
            if (
              attempt >= 2 ||
              !/Execution context was destroyed|Cannot find context|because of a navigation/.test(
                error.message,
              )
            )
              throw error;
            await page.waitForLoadState("domcontentloaded", { timeout: 5000 });
          }
        }
      },
      async screenshot(path) {
        if (new URL(page.url()).origin !== url.origin)
          throw new Error("The browser left the audit origin.");
        return page.screenshot({ path, caret: "hide", timeout: 10000 });
      },
      async act(action) {
        const { type, point, end, dx, dy, key, value } = action;
        switch (type) {
          case "click":
            return page.mouse.click(point.x, point.y);
          case "tap":
            if (!touch) throw new Error("Tap requires a touch profile.");
            return page.touchscreen.tap(point.x, point.y);
          case "type":
            return countKeydowns(page, () => page.keyboard.type(value));
          case "press":
            return countKeydowns(page, () => page.keyboard.press(key));
          case "back":
            return page.goBack({
              waitUntil: "domcontentloaded",
              timeout: 8000,
            });
          case "scroll":
            if (touch) return moveTouch(touchSession, point, end);
            await page.mouse.move(point.x, point.y);
            return page.mouse.wheel(dx, dy);
          case "swipe":
            return moveTouch(touchSession, point, end);
          case "drag":
            if (touch) return moveTouch(touchSession, point, end);
            await page.mouse.move(point.x, point.y);
            await page.mouse.down();
            try {
              await page.mouse.move(end.x, end.y, { steps: 12 });
            } finally {
              await page.mouse.up();
            }
        }
      },
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

async function countKeydowns(page, send) {
  const count = () =>
    page.evaluate(() => [performance.timeOrigin, window.__uxAuditKeyCount]);
  const [document, before] = await count();
  await send();
  const after = await count().catch(() => null);
  return { keydowns: after?.[0] === document ? after[1] - before : null };
}

async function moveTouch(session, point, end) {
  if (!session)
    throw new Error("This Playwright profile cannot dispatch touch gestures.");
  const dispatch = (type, touchPoints) =>
    session.send("Input.dispatchTouchEvent", { type, touchPoints });
  await dispatch("touchStart", [point]);
  try {
    for (let step = 1; step <= 12; step++) {
      await dispatch("touchMove", [
        {
          x: point.x + ((end.x - point.x) * step) / 12,
          y: point.y + ((end.y - point.y) * step) / 12,
        },
      ]);
    }
  } finally {
    await dispatch("touchEnd", []);
  }
}

// Runs inside the page. Expose rendered, in-viewport labels and controls only.
function observeRenderedPage() {
  const viewport = { width: innerWidth, height: innerHeight };
  const normalize = (text) =>
    text?.trim().replace(/\s+/g, " ").slice(0, 180) ?? "";
  function inView(rect) {
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < viewport.width &&
      rect.top < viewport.height
    );
  }
  function rendered(el) {
    return (
      el.checkVisibility({
        visibilityProperty: true,
        opacityProperty: true,
        contentVisibilityAuto: true,
      }) && !el.closest("[aria-hidden=true],[inert]")
    );
  }
  const selector =
    "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=combobox],[role=searchbox],[contenteditable=true],[tabindex]";
  const controls = [];
  for (const el of document.querySelectorAll(selector)) {
    const rect = el.getBoundingClientRect();
    if (!inView(rect) || !rendered(el)) continue;
    const left = Math.max(rect.left, 0);
    const right = Math.min(rect.right, viewport.width);
    const top = Math.max(rect.top, 0);
    const bottom = Math.min(rect.bottom, viewport.height);
    const point = {
      x: Math.round((left + right) / 2),
      y: Math.round((top + bottom) / 2),
    };
    if (!el.contains(document.elementFromPoint(point.x, point.y))) continue;
    const visibleLabel = normalize(
      el.innerText ||
        (el.value && ["button", "submit"].includes(el.type) && el.value) ||
        "",
    );
    const labelledBy = normalize(
      el
        .getAttribute("aria-labelledby")
        ?.split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent)
        .join(" "),
    );
    const labels = normalize(
      Array.from(el.labels ?? [], (label) => label.innerText).join(" "),
    );
    const accessibilityLabel =
      labelledBy ||
      normalize(el.getAttribute("aria-label")) ||
      labels ||
      visibleLabel ||
      normalize(el.querySelector("img[alt]")?.alt) ||
      normalize(el.title);
    const displayLabel = accessibilityLabel || normalize(el.placeholder);
    const role =
      el.getAttribute("role") ??
      {
        A: "link",
        BUTTON: "button",
        SELECT: "combobox",
        SUMMARY: "button",
        TEXTAREA: "textbox",
      }[el.tagName] ??
      {
        search: "searchbox",
        button: "button",
        submit: "button",
        radio: "radio",
        checkbox: "checkbox",
        range: "slider",
      }[el.type] ??
      (el.tagName === "INPUT" ? "textbox" : "control");
    const search =
      role === "searchbox" ||
      (["textbox", "combobox"].includes(role) &&
        /\b(search|find)\b/i.test(displayLabel));
    const clear =
      role === "button" &&
      /\b(clear( search)?|dismiss search|close search)\b/i.test(displayLabel);
    const componentKinds = ["interactive"];
    if (search) componentKinds.push("search");
    if (clear) componentKinds.push("search-clear");
    if (role === "button") {
      componentKinds.push("button");
      if (
        !visibleLabel ||
        (/^[.⋯…]+$/.test(visibleLabel) && accessibilityLabel !== visibleLabel)
      )
        componentKinds.push("icon-button");
    }
    controls.push({
      ref: controls.length + 1,
      role,
      label: displayLabel,
      point,
      componentKinds,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
      fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
      disabled:
        el.matches(":disabled") || el.getAttribute("aria-disabled") === "true",
      focused: el === document.activeElement,
      editable:
        el.isContentEditable ||
        el.matches(
          "textarea, input:not([type=button],[type=submit],[type=checkbox],[type=radio],[type=file],[type=range])",
        ),
      sensitive: el.matches(
        "input[type=password],input[autocomplete*=password],input[autocomplete=one-time-code]",
      ),
      accessibleName: accessibilityLabel || null,
    });
  }
  const dialog = document.querySelector(
    "dialog[open],[role=dialog],[role=alertdialog]",
  );
  const text = [];
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_TEXT,
  );
  for (
    let node = walker.nextNode();
    node && text.length < 120;
    node = walker.nextNode()
  ) {
    const value = normalize(node.textContent);
    if (!value || !rendered(node.parentElement)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    if (!inView(rect)) continue;
    const x = Math.min(
      viewport.width - 1,
      Math.max(0, (rect.left + rect.right) / 2),
    );
    const y = Math.min(
      viewport.height - 1,
      Math.max(0, (rect.top + rect.bottom) / 2),
    );
    if (node.parentElement.contains(document.elementFromPoint(x, y)))
      text.push(value);
  }
  const safeUrl = new URL(location.href);
  const hashRoute = safeUrl.hash.startsWith("#/")
    ? safeUrl.hash.split("?")[0]
    : "";
  return {
    title: document.title,
    path: hashRoute
      ? `${safeUrl.pathname.replace(/\/$/, "")}${hashRoute}`
      : safeUrl.pathname,
    viewport,
    scroll: { x: scrollX, y: scrollY },
    modal:
      dialog && rendered(dialog) && inView(dialog.getBoundingClientRect())
        ? normalize(
            dialog.getAttribute("aria-label") ||
              dialog.querySelector("h1,h2,h3,[role=heading]")?.textContent,
          ) || "Dialog"
        : null,
    text,
    controls,
  };
}

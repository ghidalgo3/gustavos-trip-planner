import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  dependency,
  loadRegistry,
} from "../.agents/skills/ux-audit/scripts/config.mjs";
import { writeJson } from "../.agents/skills/ux-audit/scripts/session.mjs";

async function main() {
  const { values } = parseArgs({
    options: {
      help: { type: "boolean", short: "h" },
      out: { type: "string" },
      "local-user": { type: "string" },
    },
  });
  if (values.help) {
    process.stdout.write(
      "Usage: scripts/ux-audit sign-in [--local-user 1|2] [--out FILE]\n",
    );
    return;
  }

  const localUser = values["local-user"];
  if (localUser !== undefined && !["1", "2"].includes(localUser)) {
    throw new Error("Choose local user 1 or 2.");
  }

  const { targetOrigin } = await loadRegistry();
  const target = new URL(targetOrigin);
  if (target.origin !== "http://localhost:5173") {
    throw new Error("Start the local Docker app at http://localhost:5173.");
  }
  const output = values.out
    ? resolve(values.out)
    : fileURLToPath(
        new URL("../artifacts/ux/auth/localhost.json", import.meta.url),
      );

  const { chromium } = dependency("@playwright/test");
  const browser = await chromium.launch({ headless: localUser !== undefined });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    if (!localUser) {
      process.stderr.write(
        "Sign in to Trip Planner in the browser window. Complete onboarding if prompted.\n",
      );
    }
    async function openSignIn() {
      await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      if (localUser) {
        await page
          .getByRole("button", { name: "Use local user" })
          .click({ timeout: 10000 });
        await page
          .getByRole("menuitem", { name: `Local user ${localUser}` })
          .click({ timeout: 10000 });
      }
    }
    await Promise.all([
      page.waitForResponse(
        async (response) => {
          const method = response.request().method();
          const userEndpoint =
            method === "GET" &&
            response.url() === new URL("/user", target).href;
          const profileEndpoint =
            method === "PUT" &&
            response.url() === new URL("/user/profile", target).href;
          if ((!userEndpoint && !profileEndpoint) || !response.ok())
            return false;
          const user = await response.json().catch(() => null);
          return (
            user?.isAuthenticated === true && user.completedOnboarding === true
          );
        },
        { timeout: localUser ? 30_000 : 300_000 },
      ),
      openSignIn(),
    ]);
    const cookies = (await context.cookies(target.origin)).filter(({ name }) =>
      /^tripplanner\.auth(?:C\d+)?$/.test(name),
    );
    if (!cookies.length)
      throw new Error("Trip Planner returned no session cookie.");

    await mkdir(dirname(output), { recursive: true, mode: 0o700 });
    await writeJson(output, { cookies, origins: [] });
    process.stdout.write(output + "\n");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`UX audit sign-in: ${error.message}\n`);
  process.exitCode = 1;
});

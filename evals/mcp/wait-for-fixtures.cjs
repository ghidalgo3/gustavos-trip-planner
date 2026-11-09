// Readiness must identify our child process, so an existing server cannot be used
// accidentally. Fixture startup never invokes a model or a production database.
const { setTimeout: delay } = require("node:timers/promises");

async function main() {
  const [base, instance, pid] = process.argv.slice(2);
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      process.kill(Number(pid), 0);
    } catch {
      throw new Error("Fixture process exited before becoming ready.");
    }
    let response;
    try {
      response = await fetch(base + "/health", {
        signal: AbortSignal.timeout(1000),
      });
    } catch {
      await delay(250);
      continue;
    }
    if (!response.ok)
      throw new Error("The fixture port is occupied by another service.");
    let health;
    try {
      health = await response.json();
    } catch {
      throw new Error("The fixture port is occupied by another service.");
    }
    if (health.instance !== instance || health.status !== "ready") {
      throw new Error("The fixture port is occupied by another service.");
    }
    process.stdout.write(JSON.stringify(health) + "\n");
    return;
  }
  throw new Error("Timed out waiting for MCP fixtures.");
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});

// Give the CLI its own process group so stopping the wrapper also stops npm's
// child processes. Only this owned group receives forwarded signals.
const { spawn } = require("node:child_process");
const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: "inherit", detached: true });
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (child.pid) {
      try {
        process.kill(-child.pid, signal);
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  });
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
});

// .opencode/plugins/graphify.js
// Auto-updates the graphify knowledge graph after every tool execution.
import { execSync } from "node:child_process";

export const GraphifyPlugin = async ({ directory }) => {
  return {
    "tool.execute.after": async () => {
      try {
        execSync("graphify update . --force", { cwd: directory, stdio: "ignore" });
      } catch (_) {}
    },
  };
};

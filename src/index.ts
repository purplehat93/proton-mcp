import { pathToFileURL } from "node:url";

import { serveStdio } from "@modelcontextprotocol/server/stdio";

import { loadHttpServerOptions, startHttpServer } from "./http.js";
import { createServer } from "./mcp.js";

export { createServer } from "./mcp.js";

async function run(): Promise<void> {
  const mode = process.argv[2] ?? "serve";

  if (mode === "stdio") {
    console.error("proton-mcp starting on stdio");
    await serveStdio(() => createServer());
    return;
  }

  if (mode !== "serve") {
    throw new Error(`Unknown mode: ${mode}. Use "serve" or "stdio".`);
  }

  const options = await loadHttpServerOptions();
  const running = await startHttpServer(options);
  console.error(
    `proton-mcp listening on ${options.host}:${running.port} (Streamable HTTP /mcp)`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`proton-mcp received ${signal}; shutting down`);
    await running.close();
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").catch((error: unknown) => {
      console.error("proton-mcp shutdown failed", error);
      process.exitCode = 1;
    });
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").catch((error: unknown) => {
      console.error("proton-mcp shutdown failed", error);
      process.exitCode = 1;
    });
  });
}

const entrypoint = process.argv[1];
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href) {
  void run().catch((error: unknown) => {
    console.error(
      "proton-mcp failed to start",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  });
}

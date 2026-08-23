import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client/streamableHttp";
import { describe, expect, it } from "vitest";

import { loadHttpServerOptions, startHttpServer } from "./http.js";

const TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz-0123456789";

async function withServer(
  fn: (baseUrl: string) => Promise<void>,
  allowedOrigins: string[] = [],
): Promise<void> {
  const running = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    allowedHosts: ["127.0.0.1"],
    allowedOrigins,
  });

  try {
    await fn(`http://127.0.0.1:${running.port}`);
  } finally {
    await running.close();
  }
}

describe("Streamable HTTP server", () => {
  it("serves an unauthenticated health endpoint", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/healthz`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ status: "ok" });
    });
  });

  it("requires a bearer token for the MCP endpoint", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, { method: "POST" });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });
  });

  it("rejects an unexpected browser Origin", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${TOKEN}`,
          origin: "https://evil.example",
        },
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "forbidden_origin",
      });
    });
  });

  it("accepts an authenticated MCP client over Streamable HTTP", async () => {
    await withServer(async (baseUrl) => {
      const client = new Client(
        { name: "proton-mcp-test", version: "0.0.0" },
        { versionNegotiation: { mode: "auto" } },
      );
      const transport = new StreamableHTTPClientTransport(
        new URL(`${baseUrl}/mcp`),
        {
          requestInit: {
            headers: { authorization: `Bearer ${TOKEN}` },
          },
        },
      );

      try {
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe("modern");
      } finally {
        await client.close();
      }
    });
  });
});

describe("loadHttpServerOptions", () => {
  it("loads the bearer token from a file and keeps secure defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "proton-mcp-"));
    const tokenFile = join(dir, "token");
    await writeFile(tokenFile, `${TOKEN}\n`, { mode: 0o600 });

    try {
      const options = await loadHttpServerOptions({
        MCP_AUTH_TOKEN_FILE: tokenFile,
      });
      expect(options.host).toBe("0.0.0.0");
      expect(options.port).toBe(3000);
      expect(options.token).toBe(TOKEN);
      expect(options.allowedHosts).toEqual(["localhost", "127.0.0.1", "[::1]"]);
      expect(options.allowedOrigins).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer as createNodeServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import type { NodeIncomingMessageLike } from "@modelcontextprotocol/node";
import { createMcpHandler } from "@modelcontextprotocol/server";

import { createServer as createMcpServer } from "./mcp.js";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const DEFAULT_TOKEN_FILE = "/run/secrets/mcp_auth_token";
const DEFAULT_ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"];

export interface HttpServerOptions {
  host: string;
  port: number;
  token: string;
  allowedHosts: string[];
  allowedOrigins: string[];
}

export interface RunningHttpServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

function splitCsv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    return closingBracket === -1 ? null : trimmed.slice(0, closingBracket + 1);
  }

  const colon = trimmed.indexOf(":");
  return colon === -1 ? trimmed : trimmed.slice(0, colon);
}

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isHostAllowed(req: IncomingMessage, allowedHosts: string[]): boolean {
  const hostname = req.headers.host
    ? normalizeHostname(req.headers.host)
    : null;
  if (!hostname) return false;
  return allowedHosts.some(
    (allowed) => normalizeHostname(allowed) === hostname,
  );
}

function isOriginAllowed(
  req: IncomingMessage,
  allowedOrigins: string[],
): boolean {
  const originHeader = req.headers.origin;
  if (!originHeader) return true;

  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  return allowedOrigins.some((allowed) => normalizeOrigin(allowed) === origin);
}

function bearerMatches(req: IncomingMessage, token: string): boolean {
  const authorization = req.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) return false;

  const presented = Buffer.from(authorization.slice("Bearer ".length), "utf8");
  const expected = Buffer.from(token, "utf8");
  return (
    presented.length === expected.length && timingSafeEqual(presented, expected)
  );
}

function requestPath(req: IncomingMessage): string {
  try {
    return new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

function toMcpRequest(req: IncomingMessage): NodeIncomingMessageLike {
  return {
    headers: req.headers,
    ...(req.method === undefined ? {} : { method: req.method }),
    ...(req.url === undefined ? {} : { url: req.url }),
    [Symbol.asyncIterator]: () => req[Symbol.asyncIterator](),
  };
}

function json(
  res: ServerResponse,
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    ...headers,
  });
  res.end(JSON.stringify(body));
}

export async function loadHttpServerOptions(
  env: NodeJS.ProcessEnv = process.env,
): Promise<HttpServerOptions> {
  const tokenFile = env.MCP_AUTH_TOKEN_FILE ?? DEFAULT_TOKEN_FILE;
  const token = (await readFile(tokenFile, "utf8")).trim();
  if (token.length < 32) {
    throw new Error("MCP bearer token must contain at least 32 characters");
  }

  const port = Number(env.MCP_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid MCP_PORT: ${env.MCP_PORT ?? String(DEFAULT_PORT)}`,
    );
  }

  const allowedHosts = splitCsv(env.MCP_ALLOWED_HOSTS);

  return {
    host: env.MCP_HOST ?? DEFAULT_HOST,
    port,
    token,
    allowedHosts:
      allowedHosts.length > 0 ? allowedHosts : [...DEFAULT_ALLOWED_HOSTS],
    allowedOrigins: splitCsv(env.MCP_ALLOWED_ORIGINS),
  };
}

export async function startHttpServer(
  options: HttpServerOptions,
): Promise<RunningHttpServer> {
  if (options.token.length < 32) {
    throw new Error("MCP bearer token must contain at least 32 characters");
  }

  const handler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler(handler);

  const server = createNodeServer((req, res) => {
    if (!isHostAllowed(req, options.allowedHosts)) {
      json(res, 403, { error: "forbidden_host" });
      return;
    }

    const path = requestPath(req);
    if (
      path === "/healthz" &&
      (req.method === "GET" || req.method === "HEAD")
    ) {
      if (req.method === "HEAD") {
        res.writeHead(200).end();
      } else {
        json(res, 200, { status: "ok" });
      }
      return;
    }

    if (path !== "/mcp") {
      json(res, 404, { error: "not_found" });
      return;
    }

    if (!isOriginAllowed(req, options.allowedOrigins)) {
      json(res, 403, { error: "forbidden_origin" });
      return;
    }

    if (!bearerMatches(req, options.token)) {
      json(
        res,
        401,
        { error: "unauthorized" },
        { "www-authenticate": 'Bearer realm="proton-mcp"' },
      );
      return;
    }

    Promise.resolve(nodeHandler(toMcpRequest(req), res)).catch(
      (error: unknown) => {
        console.error(
          "proton-mcp HTTP request failed",
          error instanceof Error ? error.message : error,
        );
        if (!res.headersSent) {
          json(res, 500, { error: "internal_server_error" });
        } else if (!res.writableEnded) {
          res.end();
        }
      },
    );
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(options.port, options.host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    await handler.close();
    throw new Error("Unable to determine MCP HTTP listen address");
  }

  const { port } = address;
  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;

  return {
    host: options.host,
    port,
    url: `http://${displayHost}:${port}/mcp`,
    close: async () => {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

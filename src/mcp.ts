import { McpServer } from "@modelcontextprotocol/server";

export function createServer(): McpServer {
  return new McpServer(
    {
      name: "proton-mcp",
      version: "0.0.0",
    },
    {
      instructions:
        "Read-only Proton Mail access via Proton Mail Bridge. Prefer metadata/search tools before fetching individual message bodies.",
    },
  );
}

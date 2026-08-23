import { describe, expect, it } from "vitest";

import { createServer } from "./index.js";

describe("createServer", () => {
  it("creates an MCP server instance", () => {
    expect(createServer()).toBeDefined();
  });
});

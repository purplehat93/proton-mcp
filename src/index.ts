import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';

export function createServer(): McpServer {
  return new McpServer(
    {
      name: 'proton-mcp',
      version: '0.0.0',
    },
    {
      instructions:
        'Read-only Proton Mail access via Proton Mail Bridge. Prefer metadata/search tools before fetching individual message bodies.',
    },
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.error('proton-mcp starting on stdio');
  void serveStdio(() => createServer());
}

import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ProtonMailbox } from "./mail.js";

function success(output: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
    structuredContent: output,
  };
}

function failure(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Mailbox operation failed";
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function createServer(): McpServer {
  const mailbox = new ProtonMailbox();
  const server = new McpServer(
    {
      name: "proton-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Read-only Proton Mail access via Proton Mail Bridge. Prefer metadata/search tools before fetching individual message bodies. Message ids are opaque and should be passed unchanged to get_message.",
    },
  );

  server.registerTool(
    "list_folders",
    {
      title: "List Proton Mail folders",
      description:
        "List folders and labels visible through Proton Mail Bridge.",
      inputSchema: z.object({}),
      annotations: readOnlyAnnotations,
    },
    async () => {
      try {
        return success(await mailbox.listFolders());
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mailbox_stats",
    {
      title: "Get Proton mailbox statistics",
      description:
        "Return message and unread counts. If folder is omitted, return compact per-folder counts and use All Mail (or Inbox as fallback) for the overall total.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ folder }) => {
      try {
        return success(await mailbox.mailboxStats(folder));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "top_senders",
    {
      title: "Find top Proton Mail senders",
      description:
        "Aggregate sender counts from a bounded set of messages. Defaults to Inbox and never returns message bodies.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.topSenders(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "search_mail",
    {
      title: "Search Proton Mail",
      description:
        "Search one Proton Mail folder using bounded IMAP filters and return metadata summaries only. Defaults to Inbox.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        from: z.string().min(1).optional(),
        to: z.string().min(1).optional(),
        subject: z.string().min(1).optional(),
        text: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        seen: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.searchMail(input));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      title: "Read one Proton Mail message",
      description:
        "Fetch one message by the opaque id returned by search_mail. Returns text/HTML bodies with bounded size and attachment metadata only.",
      inputSchema: z.object({
        id: z.string().min(1),
      }),
      annotations: readOnlyAnnotations,
    },
    async ({ id }) => {
      try {
        return success(await mailbox.getMessage(id));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

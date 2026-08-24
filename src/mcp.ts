import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  ProtonMailbox,
  type CleanupCandidatesInput,
  type MailboxInventoryInput,
  type MessageActionInput,
  type MoveMessagesInput,
  type SearchMailInput,
  type TopSendersInput,
} from "./mail.js";

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

function withoutUndefined<T extends Record<string, unknown>>(
  input: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

const readOnlyAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const mutationAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const destructiveMutationAnnotations = {
  ...mutationAnnotations,
  destructiveHint: true,
} as const;

const messageActionSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(50),
  dryRun: z.boolean().optional(),
});

const moveMessagesSchema = messageActionSchema.extend({
  destination: z.string().min(1),
});

export function createServer(): McpServer {
  const mailbox = new ProtonMailbox();
  const server = new McpServer(
    {
      name: "proton-mcp",
      version: "0.1.0",
    },
    {
      instructions:
        "Proton Mail access via Proton Mail Bridge. Prefer metadata/search tools before fetching individual message bodies. Message ids are opaque and should be passed unchanged to get_message or explicit bounded write tools. Write tools support dryRun and never permanently delete messages.",
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
        const request = withoutUndefined(input) as TopSendersInput;
        return success(await mailbox.topSenders(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mailbox_inventory",
    {
      title: "Inventory Proton Mail metadata",
      description:
        "Build a bounded read-only mailbox inventory from message metadata. Returns exact match count plus sampled sender, domain, date, unread, attachment, and size aggregates; never returns message bodies.",
      inputSchema: z.object({
        folder: z.string().min(1).optional(),
        before: z.string().datetime().optional(),
        after: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        scanLimit: z.number().int().min(1).max(5000).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as MailboxInventoryInput;
        return success(await mailbox.mailboxInventory(request));
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
        const request = withoutUndefined(input) as SearchMailInput;
        return success(await mailbox.searchMail(request));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "cleanup_candidates",
    {
      title: "Find Proton Mail cleanup candidates",
      description:
        "Return bounded metadata-only candidates for review before cleanup. Candidates are read messages from frequent senders and optionally older than a requested age; this tool never mutates mail.",
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
        olderThanDays: z.number().int().min(1).max(36500).optional(),
        minSenderCount: z.number().int().min(2).max(5000).optional(),
        includeUnread: z.boolean().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        scanLimit: z.number().int().min(1).max(5000).optional(),
      }),
      annotations: readOnlyAnnotations,
    },
    async (input) => {
      try {
        const request = withoutUndefined(input) as CleanupCandidatesInput;
        return success(await mailbox.cleanupCandidates(request));
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

  server.registerTool(
    "mark_read",
    {
      title: "Mark Proton Mail messages read",
      description:
        "Mark up to 50 messages read using opaque ids returned by search_mail. Use dryRun to inspect the intended operation without changing mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.markRead(input as MessageActionInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "mark_unread",
    {
      title: "Mark Proton Mail messages unread",
      description:
        "Mark up to 50 messages unread using opaque ids returned by search_mail. Use dryRun to inspect the intended operation without changing mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.markUnread(input as MessageActionInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "archive_messages",
    {
      title: "Archive Proton Mail messages",
      description:
        "Move up to 50 messages to Proton's Archive folder using opaque ids returned by search_mail. Supports dryRun and never permanently deletes mail.",
      inputSchema: messageActionSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(
          await mailbox.archiveMessages(input as MessageActionInput),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "trash_messages",
    {
      title: "Move Proton Mail messages to Trash",
      description:
        "Move up to 50 messages to Proton's Trash folder using opaque ids returned by search_mail. Supports dryRun; permanent deletion is not exposed.",
      inputSchema: messageActionSchema,
      annotations: destructiveMutationAnnotations,
    },
    async (input) => {
      try {
        return success(
          await mailbox.trashMessages(input as MessageActionInput),
        );
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "move_messages",
    {
      title: "Move Proton Mail messages",
      description:
        "Move up to 50 messages to an explicit Proton Mail folder or label using opaque ids returned by search_mail. Supports dryRun.",
      inputSchema: moveMessagesSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.moveMessages(input as MoveMessagesInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  server.registerTool(
    "copy_messages",
    {
      title: "Copy Proton Mail messages",
      description:
        "Copy up to 50 messages to an explicit Proton Mail folder or label using opaque ids returned by search_mail. Supports dryRun.",
      inputSchema: moveMessagesSchema,
      annotations: mutationAnnotations,
    },
    async (input) => {
      try {
        return success(await mailbox.copyMessages(input as MoveMessagesInput));
      } catch (error) {
        return failure(error);
      }
    },
  );

  return server;
}

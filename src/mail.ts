import { readFile } from "node:fs/promises";

import {
  ImapFlow,
  type FetchMessageObject,
  type ImapFlowOptions,
  type MessageAddressObject,
  type MessageStructureObject,
  type SearchObject,
} from "imapflow";

const DEFAULT_PASSWORD_FILE = "/run/secrets/bridge_imap_password";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 1143;
const DEFAULT_SECURITY = "STARTTLS";
const DEFAULT_RESULT_LIMIT = 20;
const MAX_RESULT_LIMIT = 100;
const MAX_SEARCH_SCAN = 1000;
const MAX_SENDER_SCAN = 5000;
const MAX_BODY_BYTES = 256 * 1024;

export type ImapSecurity = "STARTTLS" | "SSL" | "NONE";

export interface ImapConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  security: ImapSecurity;
  tlsRejectUnauthorized: boolean;
}

export type AddressSummary = {
  name: string | null;
  address: string | null;
};

export type MessageSummary = {
  id: string;
  folder: string;
  from: AddressSummary;
  subject: string | null;
  receivedAt: string | null;
  size: number;
  seen: boolean;
  hasAttachments: boolean;
};

export type SearchMailInput = {
  folder?: string;
  from?: string;
  to?: string;
  subject?: string;
  text?: string;
  before?: string;
  after?: string;
  seen?: boolean;
  hasAttachments?: boolean;
  limit?: number;
};

export type TopSendersInput = {
  folder?: string;
  before?: string;
  after?: string;
  limit?: number;
};

type MessageRef = {
  v: 1;
  folder: string;
  uid: number;
  uidValidity: string;
};

type BodyPart = {
  part: string;
  node: MessageStructureObject;
};

type DownloadedText = {
  text: string;
  truncated: boolean;
};

function envBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  if (value === "1" || value.toLowerCase() === "true") return true;
  if (value === "0" || value.toLowerCase() === "false") return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

function parseSecurity(value: string): ImapSecurity {
  const normalized = value.trim().toUpperCase();
  if (
    normalized === "STARTTLS" ||
    normalized === "SSL" ||
    normalized === "NONE"
  ) {
    return normalized;
  }
  throw new Error(
    `Invalid BRIDGE_IMAP_SECURITY: ${value}. Use STARTTLS, SSL, or NONE.`,
  );
}

function parsePort(value: string | undefined): number {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `Invalid BRIDGE_IMAP_PORT: ${value ?? String(DEFAULT_PORT)}`,
    );
  }
  return port;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field} date`);
  }
  return date;
}

function boundedLimit(
  value: number | undefined,
  fallback = DEFAULT_RESULT_LIMIT,
): number {
  const limit = value ?? fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new Error(`limit must be between 1 and ${MAX_RESULT_LIMIT}`);
  }
  return limit;
}

export async function loadImapConfig(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ImapConfig> {
  const host = (env.BRIDGE_IMAP_HOST ?? DEFAULT_HOST).trim();
  if (!isLoopbackHost(host)) {
    throw new Error(
      "BRIDGE_IMAP_HOST must be loopback; proton-mcp is designed to share the Bridge network namespace",
    );
  }

  const username = env.BRIDGE_IMAP_USERNAME?.trim();
  if (!username) {
    throw new Error("BRIDGE_IMAP_USERNAME is required");
  }

  const passwordFile = env.BRIDGE_IMAP_PASSWORD_FILE ?? DEFAULT_PASSWORD_FILE;
  const password = (await readFile(passwordFile, "utf8")).trim();
  if (!password) {
    throw new Error("Bridge IMAP password secret is empty");
  }

  return {
    host,
    port: parsePort(env.BRIDGE_IMAP_PORT),
    username,
    password,
    security: parseSecurity(env.BRIDGE_IMAP_SECURITY ?? DEFAULT_SECURITY),
    tlsRejectUnauthorized: envBoolean(
      env.BRIDGE_IMAP_TLS_REJECT_UNAUTHORIZED,
      false,
    ),
  };
}

function createImapClient(config: ImapConfig): ImapFlow {
  const options: ImapFlowOptions = {
    host: config.host,
    port: config.port,
    secure: config.security === "SSL",
    auth: {
      user: config.username,
      pass: config.password,
    },
    tls: {
      rejectUnauthorized: config.tlsRejectUnauthorized,
    },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 30_000,
    maxLiteralSize: MAX_BODY_BYTES * 4,
    maxResponseSize: MAX_BODY_BYTES * 8,
    clientInfo: {
      name: "proton-mcp",
      version: "0.1.0",
    },
  };

  if (config.security === "STARTTLS") options.doSTARTTLS = true;
  if (config.security === "NONE") options.doSTARTTLS = false;

  return new ImapFlow(options);
}

async function withClient<T>(fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const config = await loadImapConfig();
  const client = createImapClient(config);
  let connected = false;

  try {
    await client.connect();
    connected = true;
    return await fn(client);
  } finally {
    if (connected && client.usable) {
      try {
        await client.logout();
      } catch {
        client.close();
      }
    } else {
      client.close();
    }
  }
}

export function encodeMessageId(ref: MessageRef): string {
  return Buffer.from(JSON.stringify(ref), "utf8").toString("base64url");
}

export function decodeMessageId(id: string): MessageRef {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(id, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid message id");
  }

  if (
    typeof value !== "object" ||
    value === null ||
    !("v" in value) ||
    value.v !== 1 ||
    !("folder" in value) ||
    typeof value.folder !== "string" ||
    !("uid" in value) ||
    typeof value.uid !== "number" ||
    !Number.isInteger(value.uid) ||
    value.uid < 1 ||
    !("uidValidity" in value) ||
    typeof value.uidValidity !== "string"
  ) {
    throw new Error("Invalid message id");
  }

  return {
    v: 1,
    folder: value.folder,
    uid: value.uid,
    uidValidity: value.uidValidity,
  };
}

function normalizeSpecialUse(value: string | undefined): string | null {
  if (!value) return null;
  return value.replace(/^\\/, "").toLowerCase();
}

function firstAddress(
  addresses: MessageAddressObject[] | undefined,
): AddressSummary {
  const address = addresses?.[0];
  return {
    name: address?.name ?? null,
    address: address?.address ?? null,
  };
}

function allAddresses(
  addresses: MessageAddressObject[] | undefined,
): AddressSummary[] {
  return (addresses ?? []).map((address) => ({
    name: address.name ?? null,
    address: address.address ?? null,
  }));
}

function walkStructure(
  node: MessageStructureObject | undefined,
  fn: (node: MessageStructureObject) => void,
): void {
  if (!node) return;
  fn(node);
  for (const child of node.childNodes ?? []) walkStructure(child, fn);
}

export function findAttachments(
  structure: MessageStructureObject | undefined,
): Array<{
  filename: string | null;
  contentType: string;
  size: number;
}> {
  const attachments: Array<{
    filename: string | null;
    contentType: string;
    size: number;
  }> = [];

  walkStructure(structure, (node) => {
    const disposition = node.disposition?.toLowerCase();
    const filename =
      node.dispositionParameters?.filename ?? node.parameters?.name ?? null;
    const topType = node.type.toLowerCase().split("/")[0];
    const isAttachment =
      disposition === "attachment" ||
      filename !== null ||
      (topType !== "text" && topType !== "multipart" && !disposition);

    if (isAttachment) {
      attachments.push({
        filename,
        contentType: node.type,
        size: node.size ?? 0,
      });
    }
  });

  return attachments;
}

function findBodyPart(
  structure: MessageStructureObject | undefined,
  contentType: "text/plain" | "text/html",
): BodyPart | null {
  let found: BodyPart | null = null;
  walkStructure(structure, (node) => {
    if (found || !node.part) return;
    if (node.disposition?.toLowerCase() === "attachment") return;
    if (node.type.toLowerCase() === contentType) {
      found = { part: node.part, node };
    }
  });
  return found;
}

function messageDate(message: FetchMessageObject): string | null {
  const value = message.internalDate ?? message.envelope?.date;
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function summarizeMessage(
  folder: string,
  uidValidity: bigint,
  message: FetchMessageObject,
): MessageSummary {
  return {
    id: encodeMessageId({
      v: 1,
      folder,
      uid: message.uid,
      uidValidity: uidValidity.toString(),
    }),
    folder,
    from: firstAddress(message.envelope?.from),
    subject: message.envelope?.subject ?? null,
    receivedAt: messageDate(message),
    size: message.size ?? 0,
    seen: message.flags?.has("\\Seen") ?? false,
    hasAttachments: findAttachments(message.bodyStructure).length > 0,
  };
}

function buildSearchQuery(
  input: SearchMailInput | TopSendersInput,
): SearchObject {
  const query: SearchObject = {};
  if ("from" in input && input.from) query.from = input.from;
  if ("to" in input && input.to) query.to = input.to;
  if ("subject" in input && input.subject) query.subject = input.subject;
  if ("text" in input && input.text) query.text = input.text;
  if (input.before) query.before = parseDate(input.before, "before");
  if (input.after) query.since = parseDate(input.after, "after");
  if ("seen" in input && input.seen !== undefined) query.seen = input.seen;
  return Object.keys(query).length === 0 ? { all: true } : query;
}

async function fetchSummaries(
  client: ImapFlow,
  folder: string,
  uids: number[],
): Promise<MessageSummary[]> {
  if (uids.length === 0) return [];
  const mailbox = client.mailbox;
  if (!mailbox) throw new Error("Mailbox was not opened");

  const messages = await client.fetchAll(
    uids,
    {
      envelope: true,
      flags: true,
      internalDate: true,
      size: true,
      bodyStructure: true,
    },
    { uid: true },
  );

  return messages
    .map((message) => summarizeMessage(folder, mailbox.uidValidity, message))
    .sort((a, b) => (b.receivedAt ?? "").localeCompare(a.receivedAt ?? ""));
}

function selectable(flags: Set<string>): boolean {
  return !flags.has("\\Noselect");
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function decodeText(buffer: Buffer, charset: string | undefined): string {
  const encoding = charset?.trim() || "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

async function downloadTextPart(
  client: ImapFlow,
  uid: number,
  bodyPart: BodyPart | null,
): Promise<DownloadedText | null> {
  if (!bodyPart) return null;
  const downloaded = await client.download(uid, bodyPart.part, {
    uid: true,
    maxBytes: MAX_BODY_BYTES,
  });
  const buffer = await streamToBuffer(downloaded.content);
  return {
    text: decodeText(
      buffer,
      downloaded.meta.charset ?? bodyPart.node.parameters?.charset,
    ),
    truncated: downloaded.meta.expectedSize > buffer.length,
  };
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

export class ProtonMailbox {
  async listFolders(): Promise<{
    folders: Array<{
      name: string;
      path: string;
      specialUse: string | null;
      selectable: boolean;
    }>;
  }> {
    return withClient(async (client) => {
      const folders = await client.list();
      return {
        folders: folders.map((folder) => ({
          name: folder.name,
          path: folder.path,
          specialUse: normalizeSpecialUse(folder.specialUse),
          selectable: selectable(folder.flags),
        })),
      };
    });
  }

  async mailboxStats(folder?: string): Promise<{
    total: number;
    unread: number;
    scope: string;
    folders: Array<{ path: string; total: number; unread: number }>;
  }> {
    return withClient(async (client) => {
      if (folder) {
        const status = await client.status(folder, {
          messages: true,
          unseen: true,
        });
        return {
          total: status.messages ?? 0,
          unread: status.unseen ?? 0,
          scope: folder,
          folders: [
            {
              path: folder,
              total: status.messages ?? 0,
              unread: status.unseen ?? 0,
            },
          ],
        };
      }

      const listed = await client.list({
        statusQuery: { messages: true, unseen: true },
      });
      const selectableFolders = listed.filter((item) => selectable(item.flags));
      const folders = selectableFolders.map((item) => ({
        path: item.path,
        total: item.status?.messages ?? 0,
        unread: item.status?.unseen ?? 0,
      }));

      const overall =
        selectableFolders.find((item) => item.specialUse === "\\All") ??
        selectableFolders.find((item) => item.path.toUpperCase() === "INBOX") ??
        selectableFolders[0];

      return {
        total: overall?.status?.messages ?? 0,
        unread: overall?.status?.unseen ?? 0,
        scope: overall?.path ?? "none",
        folders,
      };
    });
  }

  async searchMail(input: SearchMailInput): Promise<{
    messages: MessageSummary[];
    truncated: boolean;
    scanned: number;
  }> {
    const folder = input.folder ?? "INBOX";
    const limit = boundedLimit(input.limit);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const attachmentFiltering = input.hasAttachments !== undefined;
        const scanLimit = attachmentFiltering ? MAX_SEARCH_SCAN : limit + 1;
        const candidates = uids.slice(-scanLimit);
        const summaries = await fetchSummaries(client, folder, candidates);
        const filtered =
          input.hasAttachments === undefined
            ? summaries
            : summaries.filter(
                (message) => message.hasAttachments === input.hasAttachments,
              );
        return {
          messages: filtered.slice(0, limit),
          truncated: uids.length > candidates.length || filtered.length > limit,
          scanned: candidates.length,
        };
      } finally {
        lock.release();
      }
    });
  }

  async topSenders(input: TopSendersInput): Promise<{
    senders: Array<{
      name: string | null;
      address: string;
      count: number;
      latestAt: string | null;
    }>;
    scanned: number;
    truncated: boolean;
  }> {
    const folder = input.folder ?? "INBOX";
    const limit = boundedLimit(input.limit, 25);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const found = await client.search(buildSearchQuery(input), {
          uid: true,
        });
        const uids = Array.isArray(found) ? found : [];
        const candidates = uids.slice(-MAX_SENDER_SCAN);
        if (candidates.length === 0) {
          return { senders: [], scanned: 0, truncated: false };
        }

        const messages = await client.fetchAll(
          candidates,
          { envelope: true, internalDate: true },
          { uid: true },
        );
        const senders = new Map<
          string,
          {
            name: string | null;
            address: string;
            count: number;
            latestAt: string | null;
          }
        >();

        for (const message of messages) {
          const from = firstAddress(message.envelope?.from);
          if (!from.address) continue;
          const key = from.address.toLowerCase();
          const receivedAt = messageDate(message);
          const existing = senders.get(key);
          if (!existing) {
            senders.set(key, {
              name: from.name,
              address: from.address,
              count: 1,
              latestAt: receivedAt,
            });
            continue;
          }
          existing.count += 1;
          if ((receivedAt ?? "") > (existing.latestAt ?? "")) {
            existing.latestAt = receivedAt;
          }
          if (!existing.name && from.name) existing.name = from.name;
        }

        return {
          senders: [...senders.values()]
            .sort(
              (a, b) => b.count - a.count || a.address.localeCompare(b.address),
            )
            .slice(0, limit),
          scanned: candidates.length,
          truncated: uids.length > candidates.length,
        };
      } finally {
        lock.release();
      }
    });
  }

  async getMessage(id: string): Promise<{
    id: string;
    folder: string;
    from: AddressSummary[];
    to: AddressSummary[];
    cc: AddressSummary[];
    subject: string | null;
    receivedAt: string | null;
    text: string | null;
    html: string | null;
    bodyTruncated: boolean;
    attachments: Array<{
      filename: string | null;
      contentType: string;
      size: number;
    }>;
  }> {
    const ref = decodeMessageId(id);

    return withClient(async (client) => {
      const lock = await client.getMailboxLock(ref.folder, {
        readOnly: true,
        acquireTimeout: 10_000,
      });
      try {
        const mailbox = client.mailbox;
        if (!mailbox) throw new Error("Mailbox was not opened");
        if (mailbox.uidValidity.toString() !== ref.uidValidity) {
          throw new Error(
            "Message id is stale because mailbox UIDVALIDITY changed",
          );
        }

        const message = await client.fetchOne(
          ref.uid,
          {
            envelope: true,
            internalDate: true,
            bodyStructure: true,
          },
          { uid: true },
        );
        if (!message) throw new Error("Message no longer exists");

        const plainPart = findBodyPart(message.bodyStructure, "text/plain");
        const htmlPart = findBodyPart(message.bodyStructure, "text/html");
        const plain = await downloadTextPart(client, ref.uid, plainPart);
        const html = await downloadTextPart(client, ref.uid, htmlPart);
        const text = plain?.text ?? (html ? htmlToText(html.text) : null);

        return {
          id,
          folder: ref.folder,
          from: allAddresses(message.envelope?.from),
          to: allAddresses(message.envelope?.to),
          cc: allAddresses(message.envelope?.cc),
          subject: message.envelope?.subject ?? null,
          receivedAt: messageDate(message),
          text,
          html: html?.text ?? null,
          bodyTruncated:
            (plain?.truncated ?? false) || (html?.truncated ?? false),
          attachments: findAttachments(message.bodyStructure),
        };
      } finally {
        lock.release();
      }
    });
  }
}

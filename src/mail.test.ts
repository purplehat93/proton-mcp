import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ProtonMailbox,
  decodeMessageId,
  encodeMessageId,
  extractReceiptDetails,
  loadImapConfig,
  parseInventoryScanLimit,
} from "./mail.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("Bridge IMAP configuration", () => {
  it("loads the password from a secret file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "proton-mcp-"));
    tempDirs.push(dir);
    const secret = join(dir, "password");
    await writeFile(secret, "bridge-secret\n", { mode: 0o600 });

    await expect(
      loadImapConfig({
        BRIDGE_IMAP_HOST: "127.0.0.1",
        BRIDGE_IMAP_PORT: "1143",
        BRIDGE_IMAP_USERNAME: "user@example.com",
        BRIDGE_IMAP_PASSWORD_FILE: secret,
        BRIDGE_IMAP_SECURITY: "STARTTLS",
      }),
    ).resolves.toEqual({
      host: "127.0.0.1",
      port: 1143,
      username: "user@example.com",
      password: "bridge-secret",
      security: "STARTTLS",
      tlsRejectUnauthorized: false,
    });
  });

  it("rejects a non-loopback Bridge host", async () => {
    await expect(
      loadImapConfig({
        BRIDGE_IMAP_HOST: "192.168.1.10",
        BRIDGE_IMAP_USERNAME: "user@example.com",
      }),
    ).rejects.toThrow(/must be loopback/);
  });
});

describe("opaque message ids", () => {
  it("round-trips folder, UID and UIDVALIDITY", () => {
    const encoded = encodeMessageId({
      v: 1,
      folder: "Folders/Receipts",
      uid: 42,
      uidValidity: "123456789",
    });

    expect(decodeMessageId(encoded)).toEqual({
      v: 1,
      folder: "Folders/Receipts",
      uid: 42,
      uidValidity: "123456789",
    });
  });

  it("rejects malformed ids", () => {
    expect(() => decodeMessageId("not-an-id")).toThrow("Invalid message id");
  });
});

describe("mailbox inventory bounds", () => {
  it("defaults to and caps the metadata scan limit", () => {
    expect(parseInventoryScanLimit(undefined)).toBe(5000);
    expect(parseInventoryScanLimit(1)).toBe(1);
    expect(parseInventoryScanLimit(5000)).toBe(5000);
    expect(() => parseInventoryScanLimit(0)).toThrow(/scanLimit/);
    expect(() => parseInventoryScanLimit(5001)).toThrow(/scanLimit/);
  });
});

describe("receipt extraction", () => {
  it("extracts bounded receipt details from message content", () => {
    expect(
      extractReceiptDetails({
        from: [{ name: "Example Shop", address: "orders@example.test" }],
        subject: "Your order confirmation",
        receivedAt: "2026-08-24T12:00:00.000Z",
        text: "Order number: ABCD-1234. Total paid: EUR 19.99.",
        html: null,
        bodyTruncated: false,
      }),
    ).toMatchObject({
      isReceipt: true,
      confidence: "high",
      merchant: "Example Shop",
      orderNumber: "ABCD-1234",
      amounts: [{ value: "19.99", currency: "EUR" }],
    });
  });
});

describe("mailbox mutation bounds", () => {
  const id = encodeMessageId({
    v: 1,
    folder: "INBOX",
    uid: 42,
    uidValidity: "123456789",
  });

  it("supports dry-run without connecting to Bridge", async () => {
    await expect(
      new ProtonMailbox().archiveMessages({ ids: [id], dryRun: true }),
    ).resolves.toEqual({
      action: "archive",
      dryRun: true,
      requested: 1,
      affected: 0,
      folders: ["INBOX"],
    });
  });

  it("rejects duplicate and oversized selections", async () => {
    await expect(
      new ProtonMailbox().markRead({ ids: [id, id], dryRun: true }),
    ).rejects.toThrow(/unique/);
    await expect(
      new ProtonMailbox().markRead({
        ids: Array.from({ length: 51 }, (_, index) =>
          encodeMessageId({
            v: 1,
            folder: "INBOX",
            uid: index + 1,
            uidValidity: "123456789",
          }),
        ),
        dryRun: true,
      }),
    ).rejects.toThrow(/between 1 and 50/);
  });

  it("requires a destination for move and copy", async () => {
    await expect(
      new ProtonMailbox().moveMessages({
        ids: [id],
        destination: "  ",
        dryRun: true,
      }),
    ).rejects.toThrow(/destination/);
    await expect(
      new ProtonMailbox().copyMessages({
        ids: [id],
        destination: "  ",
        dryRun: true,
      }),
    ).rejects.toThrow(/destination/);
  });

  it("rejects selections spanning multiple folders", async () => {
    const otherFolderId = encodeMessageId({
      v: 1,
      folder: "Archive",
      uid: 43,
      uidValidity: "123456789",
    });
    await expect(
      new ProtonMailbox().markRead({
        ids: [id, otherFolderId],
        dryRun: true,
      }),
    ).rejects.toThrow(/same folder/);
  });
});

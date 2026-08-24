import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_STATE_DIR = "/var/lib/proton-mcp";
const STATE_FILE = "cleanup-state.json";
const PLAN_TTL_MS = 15 * 60 * 1000;

export type CleanupAction =
  "read" | "unread" | "archive" | "trash" | "move" | "copy";

export type StoredPlan = {
  id: string;
  action: CleanupAction;
  ids: string[];
  sourceFolder: string;
  destination?: string;
  confirmationHash: string;
  createdAt: string;
  expiresAt: string;
  status: "pending" | "in_progress" | "completed" | "needs_review";
  appliedAt?: string;
};

export type CleanupOperation = {
  id: string;
  planId: string;
  action: CleanupAction;
  sourceFolder: string;
  destination?: string;
  appliedAt: string;
  status: "completed" | "undo_in_progress" | "undone" | "needs_review";
  undo?: {
    sourceFolder: string;
    destinationIds: string[];
  };
  undoneAt?: string;
};

type StateDocument = {
  version: 1;
  plans: StoredPlan[];
  operations: CleanupOperation[];
};

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export class CleanupStateStore {
  private readonly path: string;
  private writeChain = Promise.resolve();

  constructor(directory = process.env.MCP_STATE_DIR ?? DEFAULT_STATE_DIR) {
    this.path = join(directory, STATE_FILE);
  }

  async createPlan(
    input: Omit<
      StoredPlan,
      "id" | "confirmationHash" | "createdAt" | "expiresAt" | "status"
    >,
  ): Promise<
    Omit<StoredPlan, "confirmationHash"> & { confirmationToken: string }
  > {
    const now = new Date();
    const confirmationToken = randomBytes(24).toString("base64url");
    const plan: StoredPlan = {
      ...input,
      id: randomUUID(),
      confirmationHash: tokenHash(confirmationToken),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PLAN_TTL_MS).toISOString(),
      status: "pending",
    };
    await this.mutate((state) => {
      state.plans = state.plans.filter(
        (item) => item.expiresAt > now.toISOString(),
      );
      state.plans.push(plan);
    });
    return {
      id: plan.id,
      action: plan.action,
      ids: plan.ids,
      sourceFolder: plan.sourceFolder,
      ...(plan.destination ? { destination: plan.destination } : {}),
      createdAt: plan.createdAt,
      expiresAt: plan.expiresAt,
      status: plan.status,
      confirmationToken,
    };
  }

  async claimPlan(id: string, confirmationToken: string): Promise<StoredPlan> {
    let plan: StoredPlan | undefined;
    await this.mutate((state) => {
      plan = state.plans.find((item) => item.id === id);
      if (!plan) throw new Error("Cleanup plan not found");
      if (plan.status !== "pending") {
        throw new Error(`Cleanup plan is ${plan.status}`);
      }
      if (plan.expiresAt <= new Date().toISOString())
        throw new Error("Cleanup plan expired");
      if (tokenHash(confirmationToken) !== plan.confirmationHash) {
        throw new Error("Cleanup plan confirmation token is invalid");
      }
      plan.status = "in_progress";
    });
    return plan!;
  }

  async completePlan(
    id: string,
    input: Omit<CleanupOperation, "id" | "planId" | "appliedAt" | "status">,
  ): Promise<CleanupOperation> {
    const operation: CleanupOperation = {
      ...input,
      id: randomUUID(),
      planId: id,
      appliedAt: new Date().toISOString(),
      status: "completed",
    };
    await this.mutate((state) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) throw new Error("Cleanup plan not found");
      plan.status = "completed";
      plan.appliedAt = operation.appliedAt;
      state.operations.push(operation);
    });
    return operation;
  }

  async flagPlanForReview(id: string): Promise<void> {
    await this.setStatus(id, "needs_review");
  }

  async listOperations(limit = 20): Promise<CleanupOperation[]> {
    const state = await this.read();
    return state.operations
      .slice()
      .sort((a, b) => b.appliedAt.localeCompare(a.appliedAt))
      .slice(0, limit);
  }

  async claimUndo(id: string): Promise<CleanupOperation> {
    let operation: CleanupOperation | undefined;
    await this.mutate((state) => {
      operation = state.operations.find((item) => item.id === id);
      if (!operation) throw new Error("Cleanup operation not found");
      if (operation.status !== "completed") {
        throw new Error(`Cleanup operation is ${operation.status}`);
      }
      if (!operation.undo || operation.undo.destinationIds.length === 0) {
        throw new Error("This cleanup operation cannot be undone exactly");
      }
      operation.status = "undo_in_progress";
    });
    return operation!;
  }

  async completeUndo(id: string): Promise<void> {
    await this.mutate((state) => {
      const operation = state.operations.find((item) => item.id === id);
      if (!operation) throw new Error("Cleanup operation not found");
      operation.status = "undone";
      operation.undoneAt = new Date().toISOString();
    });
  }

  async flagOperationForReview(id: string): Promise<void> {
    await this.mutate((state) => {
      const operation = state.operations.find((item) => item.id === id);
      if (!operation) throw new Error("Cleanup operation not found");
      operation.status = "needs_review";
    });
  }

  private async setStatus(
    id: string,
    status: "completed" | "needs_review",
  ): Promise<void> {
    await this.mutate((state) => {
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) throw new Error("Cleanup plan not found");
      plan.status = status;
      if (status === "completed") plan.appliedAt = new Date().toISOString();
    });
  }

  private async mutate(fn: (state: StateDocument) => void): Promise<void> {
    const previous = this.writeChain;
    let release!: () => void;
    this.writeChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.read();
      fn(state);
      await this.write(state);
    } finally {
      release();
    }
  }

  private async read(): Promise<StateDocument> {
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      if (
        typeof value === "object" &&
        value !== null &&
        "version" in value &&
        value.version === 1 &&
        "plans" in value &&
        Array.isArray(value.plans)
      ) {
        return {
          ...(value as Omit<StateDocument, "operations">),
          operations:
            "operations" in value && Array.isArray(value.operations)
              ? (value.operations as CleanupOperation[])
              : [],
        };
      }
      throw new Error("Cleanup state file is invalid");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, plans: [], operations: [] };
      }
      throw error;
    }
  }

  private async write(state: StateDocument): Promise<void> {
    const directory = this.path.slice(0, this.path.lastIndexOf("/"));
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
    await rename(temporary, this.path);
  }
}

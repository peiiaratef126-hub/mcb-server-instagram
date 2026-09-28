import crypto from "crypto";
import { BaseError } from "../errors/index.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_CONFIRMATION_TTL_MS = 5 * 60 * 1000; // 5 minutes

export type WriteActionType =
  | "REPLY_COMMENT"
  | "HIDE_COMMENT"
  | "UNHIDE_COMMENT"
  | "DELETE_COMMENT"
  | "PUBLISH_MEDIA"
  | "SCHEDULE_MEDIA"
  | "SEND_DM"
  | "SEND_DIRECT_MESSAGE";

export interface PendingConfirmation<T = unknown> {
  id: string;
  toolName: string;
  action: WriteActionType;
  targetId: string;
  payload: T;
  payloadHash: string;
  previewSummary: string;
  createdAt: number;
  expiresAt: number;
}

export class ConfirmationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmationError";
  }
}

/**
 * Computes deterministic SHA-256 hash of payload.
 */
export function computePayloadHash(payload: unknown): string {
  const serialized = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return crypto.createHash("sha256").update(serialized).digest("hex");
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Ephemeral in-memory confirmation store with single-use, tool binding,
 * payload hash verification, and expiration enforcement (Rule 4).
 */
export class ConfirmationStore {
  private store: Map<string, PendingConfirmation<any>> = new Map();

  /**
   * Generates and registers an ephemeral confirmation token bound to toolName and payload hash.
   */
  public create<T = unknown>(options: {
    toolName: string;
    action: WriteActionType;
    targetId: string;
    payload: T;
    previewSummary: string;
    ttlMs?: number;
  }): PendingConfirmation<T> {
    this.purgeExpired();

    const id = crypto.randomUUID();
    const now = Date.now();
    const ttlMs = options.ttlMs ?? DEFAULT_CONFIRMATION_TTL_MS;
    const payloadHash = computePayloadHash(options.payload);

    const confirmation: PendingConfirmation<T> = {
      id,
      toolName: options.toolName,
      action: options.action,
      targetId: options.targetId,
      payload: options.payload,
      payloadHash,
      previewSummary: options.previewSummary,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.store.set(id, confirmation);
    logger.debug(`[ConfirmationStore] Created confirmation ${id} bound to tool ${options.toolName} and action ${options.action}`);

    return confirmation;
  }

  /**
   * Inspects a pending confirmation without burning it.
   */
  public get<T = unknown>(id: string): PendingConfirmation<T> | undefined {
    this.purgeExpired();
    if (!id || typeof id !== "string" || !UUID_REGEX.test(id)) {
      return undefined;
    }
    const item = this.store.get(id);
    if (!item) {
      return undefined;
    }
    if (Date.now() > item.expiresAt) {
      this.store.delete(id);
      return undefined;
    }
    return item as PendingConfirmation<T>;
  }

  /**
   * Verifies, bounds-checks, and burns (single-use) a confirmation token.
   * Enforces tool binding, payload hash integrity, and expiration.
   */
  public consume<T = unknown>(id: string, expectedToolName: string): PendingConfirmation<T> {
    this.purgeExpired();

    if (!id || typeof id !== "string" || !UUID_REGEX.test(id)) {
      throw new ConfirmationError(
        "Invalid confirmation_id format. Please provide a valid UUID confirmation token."
      );
    }

    const item = this.store.get(id);
    if (!item) {
      throw new ConfirmationError(
        "Invalid or expired confirmation_id. Write actions require a valid confirmation generated within the last 5 minutes."
      );
    }

    if (Date.now() > item.expiresAt) {
      this.store.delete(id);
      throw new ConfirmationError(
        "Confirmation token has expired. Please run the preview tool again to generate a new confirmation token."
      );
    }

    // Cross-tool ID rejection: enforce binding to intended execute tool
    if (item.toolName !== expectedToolName) {
      logger.warn(`[ConfirmationStore] Cross-tool rejection: confirmation ${id} bound to ${item.toolName} was presented to ${expectedToolName}`);
      throw new ConfirmationError(
        `Confirmation token mismatch. This confirmation token is not valid for tool '${expectedToolName}'.`
      );
    }

    // Verify payload integrity against stored hash
    const currentHash = computePayloadHash(item.payload);
    if (currentHash !== item.payloadHash) {
      this.store.delete(id);
      logger.error(`[ConfirmationStore] Payload hash mismatch for confirmation ${id}`);
      throw new ConfirmationError("Confirmation integrity verification failed. Action has been aborted.");
    }

    // Single-use enforcement: burn after reading
    this.store.delete(id);
    logger.debug(`[ConfirmationStore] Consumed and burned confirmation ${id} for tool ${expectedToolName}`);

    return item as PendingConfirmation<T>;
  }

  /**
   * Cleans up expired confirmations from memory.
   */
  public purgeExpired(): void {
    const now = Date.now();
    for (const [id, item] of this.store.entries()) {
      if (now > item.expiresAt) {
        this.store.delete(id);
      }
    }
  }

  public get activeCount(): number {
    this.purgeExpired();
    return this.store.size;
  }

  public clear(): void {
    this.store.clear();
  }
}

export const confirmationStore = new ConfirmationStore();

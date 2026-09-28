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
  | "SEND_DM";

export interface PendingConfirmation<T = unknown> {
  id: string;
  action: WriteActionType;
  targetId: string;
  payload: T;
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
 * Ephemeral in-memory confirmation store with single-use and expiration enforcement (Rule 4).
 */
export class ConfirmationStore {
  private store: Map<string, PendingConfirmation<any>> = new Map();

  /**
   * Generates and registers an ephemeral confirmation token for a pending write action.
   */
  public create<T = unknown>(
    action: WriteActionType,
    targetId: string,
    payload: T,
    previewSummary: string,
    ttlMs: number = DEFAULT_CONFIRMATION_TTL_MS
  ): PendingConfirmation<T> {
    this.purgeExpired();

    const id = crypto.randomUUID();
    const now = Date.now();
    const confirmation: PendingConfirmation<T> = {
      id,
      action,
      targetId,
      payload,
      previewSummary,
      createdAt: now,
      expiresAt: now + ttlMs,
    };

    this.store.set(id, confirmation);
    logger.debug(`[ConfirmationStore] Created confirmation ${id} for action ${action} on target ${targetId}`);

    return confirmation;
  }

  /**
   * Inspects a pending confirmation without consuming it.
   */
  public get<T = unknown>(id: string): PendingConfirmation<T> | undefined {
    this.purgeExpired();
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
   * Verifies and immediately burns (single-use) a confirmation token.
   * Throws ConfirmationError if token is invalid, expired, or does not match expected action.
   */
  public consume<T = unknown>(id: string, expectedAction?: WriteActionType): PendingConfirmation<T> {
    this.purgeExpired();

    const item = this.store.get(id);
    if (!item) {
      throw new ConfirmationError(
        `Invalid or expired confirmation_id '${id}'. Write actions require a fresh confirmation generated within the last 5 minutes.`
      );
    }

    if (Date.now() > item.expiresAt) {
      this.store.delete(id);
      throw new ConfirmationError(
        `Confirmation_id '${id}' has expired. Please run the preview tool again to generate a new confirmation token.`
      );
    }

    if (expectedAction && item.action !== expectedAction) {
      throw new ConfirmationError(
        `Confirmation action mismatch. Expected '${expectedAction}', but confirmation '${id}' is for '${item.action}'.`
      );
    }

    // Single-use enforcement: burn after reading
    this.store.delete(id);
    logger.debug(`[ConfirmationStore] Consumed confirmation ${id} for action ${item.action}`);

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

  /**
   * Number of currently active confirmations (primarily for tests).
   */
  public get activeCount(): number {
    this.purgeExpired();
    return this.store.size;
  }

  /**
   * Clears all stored confirmations (primarily for test resets).
   */
  public clear(): void {
    this.store.clear();
  }
}

export const confirmationStore = new ConfirmationStore();

import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";
import { AuthenticationError, BaseError } from "../errors/index.js";

/**
 * Currently supported Meta Graph API versions.
 * Meta supports versions for 2 years after release.
 */
export const SUPPORTED_GRAPH_VERSIONS = ["v21.0", "v22.0"] as const;
export const DEFAULT_GRAPH_VERSION = "v21.0";

export interface RefreshTokenResult {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * Exchanges an existing valid token for a refreshed long-lived token via Meta Graph API.
 * NEVER logs or prints the token value or secrets.
 */
export async function refreshLongLivedToken(options: {
  currentToken: string;
  appId: string;
  appSecret: string;
  fetchFn?: typeof fetch;
  apiVersion?: string;
}): Promise<RefreshTokenResult> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const version = options.apiVersion ?? process.env.META_GRAPH_VERSION ?? DEFAULT_GRAPH_VERSION;

  const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", options.appId);
  url.searchParams.set("client_secret", options.appSecret);
  url.searchParams.set("fb_exchange_token", options.currentToken);

  logger.info(`[refresh-token] Requesting token extension via Meta Graph API ${version}...`);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    // Sanitize network error messages to prevent leaking URL with secret query params
    const sanitizedMsg = (err as Error).message.replace(/client_secret=[^&\s]+/g, "client_secret=[REDACTED]").replace(/fb_exchange_token=[^&\s]+/g, "fb_exchange_token=[REDACTED]");
    logger.error("[refresh-token] Network error during token refresh", { error: sanitizedMsg });
    throw new BaseError(`Network failure during token refresh: ${sanitizedMsg}`);
  }

  let data: {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string; code?: number };
  };

  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new BaseError(`Failed to parse response from Meta Graph API (HTTP ${response.status})`);
  }

  if (!response.ok || !data.access_token) {
    const errorMsg = data.error?.message || `HTTP ${response.status} failed to refresh token`;
    logger.error("[refresh-token] Meta Graph API rejected refresh request", {
      code: data.error?.code,
    });
    throw new AuthenticationError(errorMsg, {
      code: data.error?.code,
      status: response.status,
      guidance: "Please generate a new long-lived token via Meta Graph API Explorer as documented in docs/meta-setup.md.",
    });
  }

  return {
    accessToken: data.access_token,
    expiresInSeconds: data.expires_in ?? 5184000, // 60 days default
  };
}

/**
 * Updates the INSTAGRAM_ACCESS_TOKEN key in the target .env file atomically
 * using a temporary write file + atomic rename to prevent file corruption.
 */
export function updateEnvFileToken(envFilePath: string, newToken: string, fsModule = fs): void {
  if (!fsModule.existsSync(envFilePath)) {
    throw new BaseError(`.env file not found at path: ${envFilePath}`);
  }

  const content = fsModule.readFileSync(envFilePath, "utf8");
  const tokenRegex = /^(\s*INSTAGRAM_ACCESS_TOKEN\s*=).*$/m;

  let updatedContent: string;
  if (tokenRegex.test(content)) {
    updatedContent = content.replace(tokenRegex, `$1${newToken}`);
  } else {
    updatedContent = content + `\nINSTAGRAM_ACCESS_TOKEN=${newToken}\n`;
  }

  // Atomic write: write to sibling temp file first, then atomic rename
  const tempPath = `${envFilePath}.tmp.${crypto.randomUUID()}`;
  try {
    fsModule.writeFileSync(tempPath, updatedContent, "utf8");
    fsModule.renameSync(tempPath, envFilePath);
  } catch (err) {
    if (fsModule.existsSync(tempPath)) {
      try {
        fsModule.unlinkSync(tempPath);
      } catch {
        // ignore cleanup errors
      }
    }
    throw new BaseError(`Failed to atomically update .env file: ${(err as Error).message}`);
  }
}

/**
 * Main CLI execution entry point.
 */
export async function runRefreshTokenCli(envPath?: string, fetchFn?: typeof fetch): Promise<void> {
  const targetEnv = envPath || path.resolve(process.cwd(), ".env");
  dotenv.config({ path: targetEnv });

  const currentToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const apiVersion = process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION;

  if (!currentToken) {
    throw new BaseError("INSTAGRAM_ACCESS_TOKEN is not defined in environment or .env file.");
  }
  if (!appId || !appSecret) {
    throw new BaseError("META_APP_ID and META_APP_SECRET are required in .env to perform token refresh.");
  }

  const result = await refreshLongLivedToken({
    currentToken,
    appId,
    appSecret,
    fetchFn,
    apiVersion,
  });

  updateEnvFileToken(targetEnv, result.accessToken);

  const daysValid = Math.round(result.expiresInSeconds / 86400);
  // Log confirmation WITHOUT printing the token or secret values
  logger.info(`[refresh-token] Token refreshed via ${apiVersion} and atomically written to ${targetEnv}. Valid for ~${daysValid} days.`);
  console.log(`[OK] Instagram access token refreshed successfully via Meta Graph API ${apiVersion}. Valid for ~${daysValid} days.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRefreshTokenCli().catch((err) => {
    logger.error("[refresh-token] Refresh CLI failed", { error: (err as Error).message });
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

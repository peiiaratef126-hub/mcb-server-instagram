import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";
import { AuthenticationError, BaseError } from "../errors/index.js";

export interface RefreshTokenResult {
  accessToken: string;
  expiresInSeconds: number;
}

/**
 * Exchanges an existing valid token for a refreshed long-lived token via Meta Graph API v21.0.
 * NEVER logs or prints the token value.
 */
export async function refreshLongLivedToken(options: {
  currentToken: string;
  appId: string;
  appSecret: string;
  fetchFn?: typeof fetch;
  apiVersion?: string;
}): Promise<RefreshTokenResult> {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const version = options.apiVersion ?? "v21.0";

  const url = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", options.appId);
  url.searchParams.set("client_secret", options.appSecret);
  url.searchParams.set("fb_exchange_token", options.currentToken);

  logger.info("[refresh-token] Requesting token extension from Meta Graph API...");

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new BaseError(`Network failure while requesting token refresh: ${(err as Error).message}`);
  }

  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string; code?: number };
  };

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
 * Updates the INSTAGRAM_ACCESS_TOKEN key in the target .env file safely without disturbing other variables.
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

  fsModule.writeFileSync(envFilePath, updatedContent, "utf8");
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

  if (!currentToken) {
    throw new BaseError("INSTAGRAM_ACCESS_TOKEN is not defined in environment or .env file.");
  }
  if (!appId || !appSecret) {
    throw new BaseError("META_APP_ID and META_APP_SECRET are required in .env to perform automatic token refresh.");
  }

  const result = await refreshLongLivedToken({
    currentToken,
    appId,
    appSecret,
    fetchFn,
  });

  updateEnvFileToken(targetEnv, result.accessToken);

  const daysValid = Math.round(result.expiresInSeconds / 86400);
  // Log confirmation WITHOUT printing the token
  logger.info(`[refresh-token] Token successfully refreshed and written to ${targetEnv}. Valid for approximately ${daysValid} days.`);
  console.log(`[OK] Instagram access token refreshed successfully. Valid for ~${daysValid} days.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runRefreshTokenCli().catch((err) => {
    logger.error("[refresh-token] Refresh CLI failed", { error: (err as Error).message });
    console.error(`[ERROR] ${err.message}`);
    process.exit(1);
  });
}

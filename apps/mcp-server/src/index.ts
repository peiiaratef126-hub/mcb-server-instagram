#!/usr/bin/env node
/**
 * MCB Server Instagram (mcb-server-instagram)
 * Official Model Context Protocol (MCP) server for Instagram Professional accounts.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./config/env.js";
import { FacebookLoginProvider } from "./providers/facebook-login.js";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { logger } from "./utils/logger.js";

export { createMcpServer, SERVER_NAME, SERVER_VERSION };
export { startDashboard, createDashboardServer } from "./dashboard/index.js";

export async function main() {
  const config = getConfig();
  logger.setLevel(config.LOG_LEVEL);
  logger.info(`Starting ${SERVER_NAME} v${SERVER_VERSION} (Mode: ${config.RUN_MODE})`);

  let provider;
  if (config.RUN_MODE === "lite") {
    provider = new FacebookLoginProvider({
      accessToken: config.INSTAGRAM_ACCESS_TOKEN!,
      accountId: config.INSTAGRAM_ACCOUNT_ID!,
    });
  } else {
    // In Full mode, token is retrieved dynamically from core-worker internal endpoint
    const workerTokenFetcher = async (): Promise<string> => {
      try {
        const res = await fetch(`${config.WORKER_URL}/internal/token`);
        if (!res.ok) {
          throw new Error(`Worker returned status ${res.status}`);
        }
        const data = (await res.json()) as { access_token: string };
        return data.access_token;
      } catch (err) {
        logger.error("Failed to retrieve token from core-worker", {
          error: (err as Error).message,
        });
        throw err;
      }
    };

    provider = new FacebookLoginProvider({
      accessToken: workerTokenFetcher,
      accountId: config.INSTAGRAM_ACCOUNT_ID || "configured-in-worker",
    });
  }

  const server = createMcpServer(provider);
  const transport = new StdioServerTransport();

  await server.connect(transport);
  logger.info(`${SERVER_NAME} connected to stdio transport and ready for tool calls.`);

  if (config.DASHBOARD_ENABLED) {
    const { startDashboard: runDashboard } = await import("./dashboard/index.js");
    await runDashboard(provider, {
      port: config.DASHBOARD_PORT,
      mode: config.RUN_MODE,
      workerUrl: config.WORKER_URL,
    });
  }
}

// Auto-run if executed directly as main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    logger.error("Fatal error starting MCP server", { error: (err as Error).message });
    process.exit(1);
  });
}

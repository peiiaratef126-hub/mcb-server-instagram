import http from "node:http";
import { InstagramGraphProvider } from "../providers/types.js";
import { logger } from "../utils/logger.js";
import { DashboardDataProvider, sanitizePayload } from "./data-provider.js";
import { renderDashboardHtml } from "./template.js";

export { DashboardDataProvider, sanitizePayload, renderDashboardHtml };

export interface DashboardServerOptions {
  port?: number;
  mode?: "lite" | "full";
  workerUrl?: string;
}

export function createDashboardServer(
  provider: InstagramGraphProvider,
  options: DashboardServerOptions = {}
): http.Server {
  const mode = options.mode || "lite";
  const dataProvider = new DashboardDataProvider(provider, mode, options.workerUrl);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = url.pathname;

    // Apply strict security headers to prevent framing, MIME-sniffing, or token leaks
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self' 'unsafe-inline'; img-src 'self' data: https:;"
    );

    try {
      if (req.method === "GET" && (pathname === "/" || pathname === "/dashboard")) {
        const fullData = await dataProvider.getFullDashboardData();
        const html = renderDashboardHtml(fullData);

        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store, no-cache, must-revalidate",
        });
        res.end(html);
        return;
      }

      if (req.method === "GET" && pathname === "/api/status") {
        const fullData = await dataProvider.getFullDashboardData();
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(JSON.stringify(fullData, null, 2));
        return;
      }

      if (req.method === "GET" && pathname === "/api/account") {
        const account = await dataProvider.getAccountOverview();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitizePayload(account), null, 2));
        return;
      }

      if (req.method === "GET" && pathname === "/api/quotas") {
        const quotas = await dataProvider.getDailyQuotas();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitizePayload(quotas), null, 2));
        return;
      }

      if (req.method === "GET" && pathname === "/api/queue") {
        const queue = await dataProvider.getPublishQueue();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitizePayload(queue), null, 2));
        return;
      }

      if (req.method === "GET" && pathname === "/api/heatmap") {
        const heatmap = await dataProvider.getBestTimeHeatmap();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitizePayload(heatmap), null, 2));
        return;
      }

      if (req.method === "GET" && pathname === "/api/audit-logs") {
        const logs = await dataProvider.getAuditLogs();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(sanitizePayload(logs), null, 2));
        return;
      }

      // 404 for unhandled routes
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found", path: pathname }));
    } catch (err) {
      logger.error("[DashboardServer] Internal request error", {
        error: (err as Error).message,
        path: pathname,
      });
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  return server;
}

export async function startDashboard(
  provider: InstagramGraphProvider,
  options: DashboardServerOptions = {}
): Promise<{ server: http.Server; port: number; url: string }> {
  const port = options.port || 3000;
  const server = createDashboardServer(provider, options);

  return new Promise((resolve, reject) => {
    server.on("error", (err) => {
      logger.error("[Dashboard] Failed to start HTTP server", { error: err.message });
      reject(err);
    });

    server.listen(port, () => {
      const actualPort = (server.address() as { port: number }).port;
      const url = `http://localhost:${actualPort}/dashboard`;
      logger.info(`[Dashboard] Web dashboard live at ${url}`);
      resolve({ server, port: actualPort, url });
    });
  });
}

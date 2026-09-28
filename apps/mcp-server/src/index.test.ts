import { describe, it, expect } from "vitest";
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from "./server.js";
import { MockInstagramGraphProvider } from "./providers/mock-provider.js";

describe("MCP Server Integration (Phase 1)", () => {
  it("should initialize McpServer with correct metadata", () => {
    const mockProvider = new MockInstagramGraphProvider();
    const server = createMcpServer(mockProvider);

    expect(server).toBeDefined();
    expect(SERVER_NAME).toBe("mcb-server-instagram");
    expect(SERVER_VERSION).toBe("0.1.0-alpha.0");
  });
});

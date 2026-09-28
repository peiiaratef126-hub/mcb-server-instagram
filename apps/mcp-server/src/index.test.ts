import { describe, it, expect } from "vitest";
import { getStatus, SERVER_NAME, SERVER_VERSION } from "./index.js";

describe("mcp-server baseline", () => {
  it("should return valid status info", () => {
    const status = getStatus();
    expect(status.name).toBe(SERVER_NAME);
    expect(status.version).toBe(SERVER_VERSION);
    expect(status.status).toBe("initialized");
  });
});

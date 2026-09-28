/**
 * MCB Server Instagram (mcb-server-instagram)
 * Model Context Protocol (MCP) server for Instagram Professional accounts.
 */

export const SERVER_NAME = "mcb-server-instagram";
export const SERVER_VERSION = "0.1.0-alpha.0";

export function getStatus(): { name: string; version: string; status: string } {
  return {
    name: SERVER_NAME,
    version: SERVER_VERSION,
    status: "initialized",
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`${SERVER_NAME} v${SERVER_VERSION} initialized.`);
}

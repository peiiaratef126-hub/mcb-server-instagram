import { LogLevel } from "../config/env.js";

const LEVEL_PRIORITIES: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Patterns matching tokens and secrets in strings
export function scrubSecrets(input: unknown): unknown {
  if (typeof input === "string") {
    let result = input;
    result = result.replace(/access_token=([^&\s]+)/gi, "access_token=[REDACTED]");
    result = result.replace(/client_secret=([^&\s]+)/gi, "client_secret=[REDACTED]");
    result = result.replace(/Bearer\s+([A-Za-z0-9_\-\.]+)/gi, "Bearer [REDACTED]");
    result = result.replace(/EAAG[A-Za-z0-9_\-\.]+/gi, "[REDACTED]");
    return result;
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubSecrets(item));
  }

  if (input !== null && typeof input === "object") {
    const scrubbedObj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("password") ||
        lowerKey.includes("key")
      ) {
        scrubbedObj[key] = "[REDACTED]";
      } else {
        scrubbedObj[key] = scrubSecrets(value);
      }
    }
    return scrubbedObj;
  }

  return input;
}

export class Logger {
  private level: LogLevel;

  constructor(level: LogLevel = "info") {
    this.level = level;
  }

  public setLevel(level: LogLevel): void {
    this.level = level;
  }

  private shouldLog(targetLevel: LogLevel): boolean {
    return LEVEL_PRIORITIES[targetLevel] >= LEVEL_PRIORITIES[this.level];
  }

  /**
   * Writes log payload strictly to process.stderr to keep stdout pristine for MCP stdio transport.
   */
  private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const payload = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message: scrubSecrets(message) as string,
      ...(meta ? { meta: scrubSecrets(meta) } : {}),
    };

    // Strictly write to stderr
    process.stderr.write(JSON.stringify(payload) + "\n");
  }

  public debug(message: string, meta?: Record<string, unknown>): void {
    this.log("debug", message, meta);
  }

  public info(message: string, meta?: Record<string, unknown>): void {
    this.log("info", message, meta);
  }

  public warn(message: string, meta?: Record<string, unknown>): void {
    this.log("warn", message, meta);
  }

  public error(message: string, meta?: Record<string, unknown>): void {
    this.log("error", message, meta);
  }
}

export const logger = new Logger();

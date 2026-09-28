import { z } from "zod";
import dotenv from "dotenv";

// Load .env file into process.env if present
dotenv.config();

export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const RunModeSchema = z.enum(["lite", "full"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const AppEnvSchema = z.enum(["development", "test", "production"]);
export type AppEnv = z.infer<typeof AppEnvSchema>;

/**
 * Base environment schema with common fields.
 */
export const rawEnvSchema = z
  .object({
    APP_ENV: AppEnvSchema.default("development"),
    RUN_MODE: RunModeSchema.default("lite"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: LogLevelSchema.default("info"),

    // Instagram credentials
    INSTAGRAM_ACCOUNT_ID: z
      .string()
      .trim()
      .regex(/^\d+$/, "Instagram Account ID must be a numeric string")
      .optional(),
    INSTAGRAM_ACCESS_TOKEN: z.string().trim().min(10, "Access token must be at least 10 characters").optional(),

    // Optional Meta App Credentials
    META_APP_ID: z.string().trim().optional(),
    META_APP_SECRET: z.string().trim().optional(),

    // Full mode specific
    WORKER_URL: z.string().trim().url("Worker URL must be a valid URL").default("http://localhost:8081"),
    DATABASE_URL: z.string().trim().optional(),
  })
  .superRefine((data, ctx) => {
    // Mode-specific validation rules
    if (data.RUN_MODE === "lite") {
      if (!data.INSTAGRAM_ACCOUNT_ID) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INSTAGRAM_ACCOUNT_ID"],
          message: "INSTAGRAM_ACCOUNT_ID is required when RUN_MODE is 'lite'",
        });
      }
      if (!data.INSTAGRAM_ACCESS_TOKEN) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["INSTAGRAM_ACCESS_TOKEN"],
          message: "INSTAGRAM_ACCESS_TOKEN is required when RUN_MODE is 'lite'",
        });
      }
    }

    if (data.RUN_MODE === "full") {
      if (!data.WORKER_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["WORKER_URL"],
          message: "WORKER_URL is required when RUN_MODE is 'full'",
        });
      }
    }
  });

export type EnvConfig = z.infer<typeof rawEnvSchema>;

/**
 * Formats Zod validation errors into a human-readable list without exposing secret values.
 */
export function formatEnvErrors(error: z.ZodError): string {
  const issues = error.issues.map((issue) => {
    const field = issue.path.join(".");
    return `  - [${field}]: ${issue.message}`;
  });
  return `Environment configuration validation failed:\n${issues.join("\n")}\n\nPlease check your .env file or environment variables.`;
}

/**
 * Validates and returns typed environment configuration.
 * Throws an Error with sanitized details if validation fails.
 */
export function validateEnv(envSource: Record<string, string | undefined> = process.env): EnvConfig {
  const result = rawEnvSchema.safeParse(envSource);
  if (!result.success) {
    const formatted = formatEnvErrors(result.error);
    throw new Error(formatted);
  }
  return result.data;
}

let cachedConfig: EnvConfig | null = null;

/**
 * Returns cached or freshly loaded environment config.
 */
export function getConfig(overrideEnv?: Record<string, string | undefined>): EnvConfig {
  if (overrideEnv) {
    return validateEnv(overrideEnv);
  }
  if (!cachedConfig) {
    cachedConfig = validateEnv(process.env);
  }
  return cachedConfig;
}

/**
 * Reset config cache (primarily for tests).
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Unified Error Hierarchy for MCB Server Instagram (Feature 17)
 */

export class BaseError extends Error {
  public readonly isOperational: boolean = true;

  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this, this.constructor);
  }
}

export interface MetaErrorPayload {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_user_title?: string;
    error_user_msg?: string;
    fbtrace_id?: string;
  };
}

export class InstagramApiError extends BaseError {
  public readonly status: number;
  public readonly code: number;
  public readonly subcode?: number;
  public readonly fbtrace_id?: string;
  public readonly guidance: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: number;
      subcode?: number;
      fbtrace_id?: string;
      guidance?: string;
    } = {}
  ) {
    super(message);
    this.name = "InstagramApiError";
    this.status = options.status ?? 500;
    this.code = options.code ?? 0;
    this.subcode = options.subcode;
    this.fbtrace_id = options.fbtrace_id;
    this.guidance =
      options.guidance ?? "Check your Meta Graph API parameters and account connection.";
  }
}

export class AuthenticationError extends InstagramApiError {
  constructor(
    message: string,
    options: {
      status?: number;
      code?: number;
      subcode?: number;
      fbtrace_id?: string;
      guidance?: string;
    } = {}
  ) {
    super(message, {
      ...options,
      status: options.status ?? 401,
      code: options.code ?? 190,
      guidance:
        options.guidance ??
        "Your access token has expired or is invalid. Run 'refresh-token' or regenerate a long-lived token as documented in docs/meta-setup.md.",
    });
    this.name = "AuthenticationError";
  }
}

export class RateLimitError extends InstagramApiError {
  public readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: number;
      subcode?: number;
      fbtrace_id?: string;
      guidance?: string;
      retryAfterSeconds?: number;
    } = {}
  ) {
    super(message, {
      ...options,
      status: options.status ?? 429,
      code: options.code ?? 32,
      guidance:
        options.guidance ??
        "Meta API rate limit reached. Back off and wait before retrying further requests.",
    });
    this.name = "RateLimitError";
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class ValidationError extends BaseError {
  public readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
  }
}

export class ConfigurationError extends BaseError {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

/**
 * Maps raw Meta Graph API error JSON responses to standard domain error classes.
 */
export function mapMetaErrorToDomainError(
  payload: MetaErrorPayload,
  httpStatus: number = 500
): InstagramApiError {
  const err = payload.error;
  const message = err?.message || `Meta Graph API error (HTTP ${httpStatus})`;
  const code = err?.code || 0;
  const subcode = err?.error_subcode;
  const fbtrace_id = err?.fbtrace_id;

  // Code 190: Invalid OAuth access token (expired, revoked, password changed)
  if (code === 190 || httpStatus === 401) {
    return new AuthenticationError(message, {
      status: httpStatus,
      code,
      subcode,
      fbtrace_id,
    });
  }

  // Code 32: Page request limit reached; Code 4: Application request limit; Code 17: User request limit
  if (code === 32 || code === 4 || code === 17 || httpStatus === 429) {
    return new RateLimitError(message, {
      status: httpStatus,
      code,
      subcode,
      fbtrace_id,
    });
  }

  // Code 100: Invalid parameter or missing fields
  if (code === 100) {
    return new InstagramApiError(message, {
      status: httpStatus,
      code,
      subcode,
      fbtrace_id,
      guidance:
        "Invalid parameter passed to Meta Graph API. Ensure the account ID is correct and the queried field exists.",
    });
  }

  // Code 200 or 10: Permissions error
  if (code === 200 || code === 10 || httpStatus === 403) {
    return new InstagramApiError(message, {
      status: httpStatus,
      code,
      subcode,
      fbtrace_id,
      guidance:
        "Permission denied. Verify that your token has all required scopes (e.g. instagram_basic, instagram_manage_comments) in the Meta App Dashboard.",
    });
  }

  return new InstagramApiError(message, {
    status: httpStatus,
    code,
    subcode,
    fbtrace_id,
  });
}

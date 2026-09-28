import { InstagramGraphProvider, RequestOptions } from "./types.js";
import { mapMetaErrorToDomainError, MetaErrorPayload, InstagramApiError } from "../errors/index.js";
import { logger } from "../utils/logger.js";

export interface FacebookLoginProviderOptions {
  accessToken: string | (() => Promise<string>);
  accountId: string;
  apiVersion?: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
}

export class FacebookLoginProvider implements InstagramGraphProvider {
  public readonly name = "facebook-login-graph";
  private readonly tokenProvider: () => Promise<string>;
  private readonly accountId: string;
  private readonly apiVersion: string;
  private readonly baseUrl: string;
  private readonly fetch: typeof fetch;

  constructor(options: FacebookLoginProviderOptions) {
    this.accountId = options.accountId;
    this.apiVersion = options.apiVersion ?? "v21.0";
    this.baseUrl = options.baseUrl ?? `https://graph.facebook.com/${this.apiVersion}`;
    this.fetch = options.fetchFn ?? globalThis.fetch;

    if (typeof options.accessToken === "function") {
      this.tokenProvider = options.accessToken;
    } else {
      const fixedToken = options.accessToken;
      this.tokenProvider = async () => fixedToken;
    }
  }

  public async getAccessToken(): Promise<string> {
    return this.tokenProvider();
  }

  public async getAccountId(): Promise<string> {
    return this.accountId;
  }

  private buildUrl(endpoint: string, params?: Record<string, string | number | boolean | undefined>): URL {
    const cleanEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
    const url = new URL(`${this.baseUrl}/${cleanEndpoint}`);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url;
  }

  private async request<T = unknown>(
    method: string,
    endpoint: string,
    body?: unknown,
    options?: RequestOptions
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = this.buildUrl(endpoint, options?.params);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...options?.headers,
    };

    let requestBody: string | undefined;
    if (body !== undefined && body !== null) {
      if (typeof body === "string") {
        requestBody = body;
      } else {
        requestBody = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
      }
    }

    logger.debug(`[FacebookLoginProvider] ${method} ${url.pathname}`, {
      method,
      params: options?.params,
    });

    let response: Response;
    try {
      response = await this.fetch(url.toString(), {
        method,
        headers,
        body: requestBody,
        signal: options?.signal,
      });
    } catch (networkErr: unknown) {
      logger.error(`[FacebookLoginProvider] Network request failed`, {
        method,
        endpoint,
        error: (networkErr as Error).message,
      });
      throw new InstagramApiError(`Network failure communicating with Meta Graph API: ${(networkErr as Error).message}`, {
        status: 503,
      });
    }

    const contentType = response.headers.get("content-type") || "";
    let data: unknown;

    if (contentType.includes("application/json")) {
      data = await response.json();
    } else {
      const text = await response.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!response.ok) {
      logger.warn(`[FacebookLoginProvider] Meta Graph API returned error HTTP ${response.status}`, {
        status: response.status,
        endpoint,
      });
      throw mapMetaErrorToDomainError((data as MetaErrorPayload) || {}, response.status);
    }

    return data as T;
  }

  public async get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", endpoint, undefined, options);
  }

  public async post<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", endpoint, body, options);
  }

  public async delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", endpoint, undefined, options);
  }
}

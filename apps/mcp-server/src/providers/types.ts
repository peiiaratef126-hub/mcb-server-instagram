/**
 * Provider Layer Abstraction (Rule 3)
 * Decouples high-level MCP tools from specific Meta Graph API authentication
 * and endpoint paths (Facebook Login vs. Instagram Login paths).
 */

export interface RequestOptions {
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface InstagramGraphProvider {
  /**
   * Distinct provider identifier (e.g. 'facebook-login-graph', 'mock-graph').
   */
  readonly name: string;

  /**
   * Retrieves the current access token.
   */
  getAccessToken(): Promise<string>;

  /**
   * Retrieves the configured Instagram Business/Creator Account ID.
   */
  getAccountId(): Promise<string>;

  /**
   * Performs an HTTP GET request to the Graph API.
   */
  get<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T>;

  /**
   * Performs an HTTP POST request to the Graph API.
   */
  post<T = unknown>(endpoint: string, body?: unknown, options?: RequestOptions): Promise<T>;

  /**
   * Performs an HTTP DELETE request to the Graph API.
   */
  delete<T = unknown>(endpoint: string, options?: RequestOptions): Promise<T>;
}

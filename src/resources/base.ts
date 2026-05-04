import type { HttpClient, Query } from "../http.js";
import { paginate } from "../pagination.js";
import type { Id, ListParams, PaginatedResponse } from "../types/common.js";

/** Constructor options for {@link BaseResource}. */
export interface BaseResourceOptions {
  /** Underlying HTTP client. */
  http: HttpClient;
  /** Resource path relative to `apiPrefix`, e.g. `"/projects"`. */
  path: string;
}

/**
 * Generic CRUD gateway. All concrete resources extend this and add their domain-specific methods.
 *
 * @typeParam T             Resource entity type, e.g. {@link Project}.
 * @typeParam CreatePayload Body shape for POST creates.
 * @typeParam UpdatePayload Body shape for PUT updates and PATCH partials.
 * @typeParam ListParamsT   Allowed `?query` filters for list endpoints.
 */
export class BaseResource<
  T,
  CreatePayload = Partial<T>,
  UpdatePayload = Partial<T>,
  ListParamsT extends ListParams = ListParams,
> {
  protected readonly http: HttpClient;
  protected readonly path: string;

  constructor(options: BaseResourceOptions) {
    this.http = options.http;
    this.path = options.path.replace(/\/+$/, "");
  }

  /** Build a query record for the underlying HTTP call, dropping `undefined` values. */
  protected buildQuery(params?: ListParamsT): Query | undefined {
    if (!params) return undefined;
    const query: Query = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      query[key] = value as Query[string];
    }
    return query;
  }

  /**
   * `GET /resource` — returns the **first page** of results.
   *
   * For full traversal use {@link BaseResource.paginate} or {@link BaseResource.listPage}.
   */
  async list(params?: ListParamsT): Promise<T[]> {
    const result = await this.http.get<T[]>(this.path, { query: this.buildQuery(params) });
    return result.data;
  }

  /**
   * `GET /resource?page=N` — returns one specific page **plus** pagination metadata.
   *
   * @param params Optional filter parameters.
   * @param page 1-based page number. Defaults to `1`.
   */
  async listPage(params?: ListParamsT, page = 1): Promise<PaginatedResponse<T>> {
    const query = { ...(this.buildQuery(params) ?? {}), page };
    const result = await this.http.get<T[]>(this.path, { query });
    return { data: result.data, pagination: result.pagination };
  }

  /**
   * Lazy async iterator that walks every page until `pagination.next` is `null`.
   *
   * @example
   * ```ts
   * for await (const project of client.projects.paginate({ member: meId })) {
   *   console.log(project.name);
   * }
   * ```
   */
  paginate(params?: ListParamsT): AsyncIterable<T> {
    const fetchPage = (page: number) => this.listPage(params, page);
    return paginate(fetchPage);
  }

  /** `GET /resource/:id` — fetch one entity by its numeric ID. */
  async get(id: Id): Promise<T> {
    const result = await this.http.get<T>(`${this.path}/${id}`);
    return result.data;
  }

  /** `POST /resource` — create a new entity. */
  async create(payload: CreatePayload): Promise<T> {
    const result = await this.http.post<T>(this.path, { body: payload });
    return result.data;
  }

  /** `PUT /resource/:id` — full replace. Requires every required field. */
  async update(id: Id, payload: UpdatePayload): Promise<T> {
    const result = await this.http.put<T>(`${this.path}/${id}`, { body: payload });
    return result.data;
  }

  /**
   * `PATCH /resource/:id` — partial update.
   *
   * @param version If provided, sent as the OCC version field. If the entity has been
   *                modified by someone else since you fetched it, Taiga responds with
   *                a conflict error.
   */
  async patch(id: Id, payload: Partial<UpdatePayload>, version?: number): Promise<T> {
    const body = version !== undefined ? { ...payload, version } : payload;
    const result = await this.http.patch<T>(`${this.path}/${id}`, { body });
    return result.data;
  }

  /** `DELETE /resource/:id` — remove the entity. Resolves with `void` on `204`. */
  async delete(id: Id): Promise<void> {
    await this.http.delete(`${this.path}/${id}`);
  }
}

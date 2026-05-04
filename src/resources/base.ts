import type { HttpClient, Query } from "../http.js";
import { paginate } from "../pagination.js";
import type { Id, ListParams, PaginatedResponse } from "../types/common.js";

export interface BaseResourceOptions {
  http: HttpClient;
  path: string;
}

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

  protected buildQuery(params?: ListParamsT): Query | undefined {
    if (!params) return undefined;
    const query: Query = {};
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined) continue;
      query[key] = value as Query[string];
    }
    return query;
  }

  async list(params?: ListParamsT): Promise<T[]> {
    const result = await this.http.get<T[]>(this.path, { query: this.buildQuery(params) });
    return result.data;
  }

  async listPage(params?: ListParamsT, page = 1): Promise<PaginatedResponse<T>> {
    const query = { ...(this.buildQuery(params) ?? {}), page };
    const result = await this.http.get<T[]>(this.path, { query });
    return { data: result.data, pagination: result.pagination };
  }

  paginate(params?: ListParamsT): AsyncIterable<T> {
    const fetchPage = (page: number) => this.listPage(params, page);
    return paginate(fetchPage);
  }

  async get(id: Id): Promise<T> {
    const result = await this.http.get<T>(`${this.path}/${id}`);
    return result.data;
  }

  async create(payload: CreatePayload): Promise<T> {
    const result = await this.http.post<T>(this.path, { body: payload });
    return result.data;
  }

  async update(id: Id, payload: UpdatePayload): Promise<T> {
    const result = await this.http.put<T>(`${this.path}/${id}`, { body: payload });
    return result.data;
  }

  async patch(id: Id, payload: Partial<UpdatePayload>, version?: number): Promise<T> {
    const body = version !== undefined ? { ...payload, version } : payload;
    const result = await this.http.patch<T>(`${this.path}/${id}`, { body });
    return result.data;
  }

  async delete(id: Id): Promise<void> {
    await this.http.delete(`${this.path}/${id}`);
  }
}

export type Id = number;
export type Timestamp = string;

export interface PaginationMeta {
  count: number;
  perPage: number;
  current: number;
  next: string | null;
  prev: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta | null;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

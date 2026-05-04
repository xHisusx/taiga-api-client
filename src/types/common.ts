/** A numeric Taiga entity ID. */
export type Id = number;

/** ISO-8601 timestamp string, e.g. `"2026-05-04T12:34:56Z"`. */
export type Timestamp = string;

/**
 * Pagination metadata parsed from Taiga's `x-paginated*` response headers.
 *
 * Returned alongside the data on every list request, or `null` if the response
 * was not paginated.
 */
export interface PaginationMeta {
  /** Total number of items across all pages. */
  count: number;
  /** Page size (items per page). */
  perPage: number;
  /** 1-based current page number. */
  current: number;
  /** Fully-qualified URL of the next page, or `null` if this is the last page. */
  next: string | null;
  /** Fully-qualified URL of the previous page, or `null` if this is the first page. */
  prev: string | null;
}

/**
 * Single page of a paginated response: the data array plus its pagination metadata.
 *
 * @typeParam T Item type.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: PaginationMeta | null;
}

/**
 * Common shape of `list()` query parameters. Concrete resources extend this with
 * resource-specific filter fields.
 */
export interface ListParams {
  /** 1-based page number to fetch. */
  page?: number;
  /** Items per page (server-side limit). */
  pageSize?: number;
  [key: string]: unknown;
}

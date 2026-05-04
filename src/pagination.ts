import type { PaginatedResponse, PaginationMeta } from "./types/common.js";

/**
 * Parse Taiga's `x-paginated*` headers into a {@link PaginationMeta} object.
 *
 * @returns The parsed metadata, or `null` if the response is not paginated
 *          (i.e. `x-paginated` header is missing or not `"true"`).
 */
export function parsePaginationHeaders(headers: Headers): PaginationMeta | null {
  const paginated = headers.get("x-paginated");
  if (paginated !== "true") return null;

  const num = (name: string): number => {
    const v = headers.get(name);
    return v !== null ? Number(v) : 0;
  };

  return {
    count: num("x-pagination-count"),
    perPage: num("x-paginated-by"),
    current: num("x-pagination-current"),
    next: headers.get("x-pagination-next"),
    prev: headers.get("x-pagination-prev"),
  };
}

/**
 * Extract the value of the `page` query parameter from a fully-qualified URL.
 *
 * Returns `null` if the URL is `null`, malformed, or does not have a `page` param.
 *
 * @example
 * extractPageFromUrl("https://api/x?page=4&foo=bar"); // 4
 * extractPageFromUrl(null);                           // null
 */
export function extractPageFromUrl(url: string | null): number | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const page = parsed.searchParams.get("page");
    return page !== null ? Number(page) : null;
  } catch {
    return null;
  }
}

/**
 * Lazy async iterator over every item across every page.
 *
 * Calls `fetchPage(N)` for each page, yields each item, and follows
 * {@link PaginationMeta.next} until no further page is reported.
 *
 * @typeParam T Item type.
 * @param fetchPage Function that fetches one page by its 1-based number.
 * @param startPage 1-based number of the first page to fetch. Default: `1`.
 *
 * @example
 * ```ts
 * for await (const story of paginate((page) => client.userStories.listPage({ project: 42 }, page))) {
 *   await process(story);
 * }
 * ```
 */
export async function* paginate<T>(
  fetchPage: (page: number) => Promise<PaginatedResponse<T>>,
  startPage = 1,
): AsyncIterable<T> {
  let page: number | null = startPage;
  while (page !== null) {
    const result: PaginatedResponse<T> = await fetchPage(page);
    for (const item of result.data) {
      yield item;
    }
    page = result.pagination ? extractPageFromUrl(result.pagination.next) : null;
  }
}

import type { PaginatedResponse, PaginationMeta } from "./types/common.js";

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

import { describe, expect, it } from "vitest";
import { extractPageFromUrl, parsePaginationHeaders, paginate } from "../../src/pagination.js";
import type { PaginatedResponse } from "../../src/types/common.js";

describe("parsePaginationHeaders", () => {
  it("returns null when not paginated", () => {
    const h = new Headers();
    expect(parsePaginationHeaders(h)).toBeNull();
  });

  it("parses x-paginated headers", () => {
    const h = new Headers({
      "x-paginated": "true",
      "x-paginated-by": "30",
      "x-pagination-count": "120",
      "x-pagination-current": "2",
      "x-pagination-next": "https://api.example/api/v1/projects?page=3",
      "x-pagination-prev": "https://api.example/api/v1/projects?page=1",
    });
    expect(parsePaginationHeaders(h)).toEqual({
      count: 120,
      perPage: 30,
      current: 2,
      next: "https://api.example/api/v1/projects?page=3",
      prev: "https://api.example/api/v1/projects?page=1",
    });
  });
});

describe("extractPageFromUrl", () => {
  it("returns null for null url", () => {
    expect(extractPageFromUrl(null)).toBeNull();
  });
  it("extracts the page query param", () => {
    expect(extractPageFromUrl("https://x/y?page=4&foo=bar")).toBe(4);
  });
  it("returns null when page param missing", () => {
    expect(extractPageFromUrl("https://x/y?foo=bar")).toBeNull();
  });
});

describe("paginate", () => {
  it("yields items across pages until next is null", async () => {
    const pages: Record<number, PaginatedResponse<number>> = {
      1: {
        data: [1, 2],
        pagination: { count: 5, perPage: 2, current: 1, next: "https://x/?page=2", prev: null },
      },
      2: {
        data: [3, 4],
        pagination: { count: 5, perPage: 2, current: 2, next: "https://x/?page=3", prev: "https://x/?page=1" },
      },
      3: {
        data: [5],
        pagination: { count: 5, perPage: 2, current: 3, next: null, prev: "https://x/?page=2" },
      },
    };
    const fetchPage = async (page: number) => {
      const result = pages[page];
      if (!result) throw new Error(`unexpected page ${page}`);
      return result;
    };
    const collected: number[] = [];
    for await (const v of paginate(fetchPage)) collected.push(v);
    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops when pagination meta is null", async () => {
    const collected: number[] = [];
    for await (const v of paginate(async () => ({ data: [10, 20], pagination: null }))) {
      collected.push(v);
    }
    expect(collected).toEqual([10, 20]);
  });
});

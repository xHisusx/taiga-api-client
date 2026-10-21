import { describe, expect, it } from "vitest";
import { formatHistoryEntry, type HistoryEntry } from "../src/format.js";

describe("formatHistoryEntry", () => {
  it("keeps a comment and drops a deleted one", () => {
    const base: HistoryEntry = {
      created_at: "2026-10-02T09:00:00Z",
      user: { username: "bob" },
      comment: "Looks fine",
    };
    expect(formatHistoryEntry(base)).toMatchObject({ author: "bob", comment: "Looks fine" });
    expect(formatHistoryEntry({ ...base, delete_comment_date: "2026-10-03T09:00:00Z" })).toBeNull();
  });

  it("renders a field diff through the labels Taiga sends with it", () => {
    const entry: HistoryEntry = {
      created_at: "2026-10-02T09:00:00Z",
      user: { username: "alice" },
      diff: { status: [101, 102], assigned_to: [null, 2] },
      values: { status: { "101": "New", "102": "In progress" }, assigned_to: { "2": "bob" } },
    };
    expect(formatHistoryEntry(entry)).toMatchObject({
      changes: { status: "New → In progress", assigned_to: "none → bob" },
    });
  });

  it("ignores an entry that carries neither a comment nor a diff", () => {
    expect(formatHistoryEntry({ created_at: "2026-10-02T09:00:00Z", diff: {} })).toBeNull();
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { CatalogService, ResolutionError } from "../src/catalog.js";
import type { TaigaMcpConfig } from "../src/config.js";
import { TaigaSession } from "../src/session.js";
import { MemoryTokenStore } from "../src/token-store.js";
import type { ProjectCatalog } from "../src/types.js";
import { FakeTaiga, fakeConfig } from "./fake-taiga.js";

describe("CatalogService", () => {
  let fake: FakeTaiga;
  let catalogs: CatalogService;
  let catalog: ProjectCatalog;

  beforeEach(async () => {
    fake = new FakeTaiga();
    const session = new TaigaSession(fakeConfig() as unknown as TaigaMcpConfig, {
      fetch: fake.fetch,
      tokenStore: new MemoryTokenStore(),
    });
    catalogs = new CatalogService(session);
    catalog = await catalogs.catalog("apollo");
  });

  it("builds every catalog from one project request", () => {
    expect(catalog.id).toBe(7);
    expect(catalog.slug).toBe("apollo");
    expect(catalog.statuses.userstory.map((status) => status.name)).toEqual([
      "New",
      "In progress",
      "Done",
    ]);
    expect(catalog.members.map((member) => member.username)).toEqual(["alice", "bob"]);
    expect(catalog.sprints.map((sprint) => sprint.name)).toEqual(["Sprint 1", "Sprint 2"]);
    expect(catalog.points.map((point) => point.name)).toEqual(["?", "3", "5"]);
    expect(catalog.permissions).toContain("modify_us");
    expect(fake.find("GET", "/projects/7")).toHaveLength(1);
  });

  it("caches the project detail", async () => {
    await catalogs.catalog("apollo");
    await catalogs.catalog(7);
    expect(fake.find("GET", "/projects/7")).toHaveLength(1);
  });

  it("re-reads the project when asked to refresh", async () => {
    await catalogs.catalog("apollo", { refresh: true });
    expect(fake.find("GET", "/projects/7")).toHaveLength(2);
  });

  it("resolves a project by slug, name, partial name and id", async () => {
    expect(await catalogs.resolveProjectId("apollo")).toBe(7);
    expect(await catalogs.resolveProjectId("Apollo")).toBe(7);
    expect(await catalogs.resolveProjectId("apol")).toBe(7);
    expect(await catalogs.resolveProjectId(7)).toBe(7);
    expect(await catalogs.resolveProjectId("#7")).toBe(7);
  });

  it("lists the known projects when a project cannot be resolved", async () => {
    await expect(catalogs.resolveProjectId("gemini")).rejects.toThrow(/Your projects: apollo/);
  });

  it("resolves statuses per item kind, case-insensitively", () => {
    expect(catalogs.resolveStatus(catalog, "userstory", "in progress")).toBe(102);
    expect(catalogs.resolveStatus(catalog, "task", "In progress")).toBe(202);
    expect(catalogs.resolveStatus(catalog, "issue", "Fixed")).toBe(302);
    expect(catalogs.resolveStatus(catalog, "userstory", 103)).toBe(103);
  });

  it("names the available statuses when one is unknown", () => {
    expect(() => catalogs.resolveStatus(catalog, "userstory", "Shipped")).toThrow(
      /Available: New, In progress, Done/,
    );
  });

  it("rejects a status id that belongs to another item kind", () => {
    expect(() => catalogs.resolveStatus(catalog, "task", 102)).toThrow(ResolutionError);
  });

  it("resolves members by username, full name, id and the me alias", async () => {
    expect(await catalogs.resolveMember(catalog, "bob")).toBe(2);
    expect(await catalogs.resolveMember(catalog, "Bob Builder")).toBe(2);
    expect(await catalogs.resolveMember(catalog, "me")).toBe(1);
    expect(await catalogs.resolveMember(catalog, 2)).toBe(2);
    expect(await catalogs.resolveMember(catalog, "unassigned")).toBeNull();
  });

  it("lists the members when a name does not match", async () => {
    await expect(catalogs.resolveMember(catalog, "carol")).rejects.toThrow(
      /Members: alice \(Alice Example\), bob/,
    );
  });

  it("resolves sprints by name, slug and the none alias", () => {
    expect(catalogs.resolveSprint(catalog, "Sprint 2")).toBe(902);
    expect(catalogs.resolveSprint(catalog, "sprint-1")).toBe(901);
    expect(catalogs.resolveSprint(catalog, "none")).toBeNull();
    expect(() => catalogs.resolveSprint(catalog, "Sprint 9")).toThrow(/Available: Sprint 1, Sprint 2/);
  });

  it("maps points onto role ids, by name or numeric value", () => {
    expect(catalogs.resolvePoints(catalog, { Back: "5" })).toEqual({ "11": 803 });
    expect(catalogs.resolvePoints(catalog, { all: 3 })).toEqual({ "11": 802, "12": 802 });
    expect(() => catalogs.resolvePoints(catalog, { Back: "13" })).toThrow(/Available: \?, 3, 5/);
    expect(() => catalogs.resolvePoints(catalog, { Sideways: "5" })).toThrow(/Roles: Back, Front/);
  });

  it("resolves issue catalogs by name", () => {
    expect(catalogs.resolveNamed(catalog.issueTypes, "bug", "issue type", catalog.slug)).toBe(501);
    expect(() =>
      catalogs.resolveNamed(catalog.severities, "Blocker", "severity", catalog.slug),
    ).toThrow(/Available: Normal/);
  });
});

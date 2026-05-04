import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Project, TaigaClient, UserStory, Task, Issue, Milestone } from "../../src/index.js";
import { integrationEnv, makeClient, uniqueName } from "./helpers.js";

const skip = !integrationEnv;
const d = skip ? describe.skip : describe;

d("integration: end-to-end project lifecycle", () => {
  const env = integrationEnv!;
  let client: TaigaClient;
  let project: Project;
  let story: UserStory;
  let task: Task;
  let issue: Issue;
  let milestone: Milestone;

  beforeAll(async () => {
    client = makeClient(env);
    await client.auth.login({ username: env.login, password: env.password });

    project = await client.projects.create({
      name: uniqueName("taiga-api-client-test"),
      description: "Temporary project created by taiga-api-client integration tests",
      is_backlog_activated: true,
      is_kanban_activated: true,
      is_issues_activated: true,
      is_wiki_activated: false,
      is_epics_activated: false,
      is_private: true,
    });
  });

  afterAll(async () => {
    if (project) {
      try {
        await client.projects.delete(project.id);
      } catch {
        // best-effort teardown
      }
    }
  });

  describe("projects", () => {
    it("can fetch the created project by id", async () => {
      const fetched = await client.projects.get(project.id);
      expect(fetched.id).toBe(project.id);
      expect(fetched.name).toBe(project.name);
    });

    it("can fetch the project by slug", async () => {
      const bySlug = await client.projects.getBySlug(project.slug);
      expect(bySlug.id).toBe(project.id);
    });

    it("can patch the project description with OCC version", async () => {
      const fresh = await client.projects.get(project.id);
      const updated = await client.projects.patch(
        project.id,
        { description: "updated by integration test" },
        (fresh as unknown as { version: number }).version,
      );
      expect(updated.description).toBe("updated by integration test");
    });

    it("returns project stats", async () => {
      const stats = await client.projects.stats(project.id);
      expect(stats).toBeTypeOf("object");
    });

    it("includes the created project in /projects?member=...", async () => {
      const me = await client.users.me();
      const projects = await client.projects.list({ member: me.id });
      expect(projects.some((p) => p.id === project.id)).toBe(true);
    });
  });

  describe("milestones", () => {
    it("creates a milestone", async () => {
      const today = new Date().toISOString().slice(0, 10);
      const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      milestone = await client.milestones.create({
        project: project.id,
        name: uniqueName("sprint"),
        estimated_start: today,
        estimated_finish: inTwoWeeks,
      });
      expect(milestone.id).toBeTypeOf("number");
      expect(milestone.project).toBe(project.id);
    });

    it("lists milestones for the project", async () => {
      const list = await client.milestones.list({ project: project.id });
      expect(list.some((m) => m.id === milestone.id)).toBe(true);
    });

    it("returns milestone stats", async () => {
      const stats = await client.milestones.stats(milestone.id);
      expect(stats.name).toBe(milestone.name);
    });
  });

  describe("user stories", () => {
    it("creates a user story", async () => {
      story = await client.userStories.create({
        project: project.id,
        subject: "Test story from taiga-api-client",
        description: "Created by integration test",
      });
      expect(story.id).toBeTypeOf("number");
      expect(story.subject).toBe("Test story from taiga-api-client");
    });

    it("patches the story (OCC)", async () => {
      const updated = await client.userStories.patch(
        story.id,
        { subject: "Renamed story" },
        story.version,
      );
      expect(updated.subject).toBe("Renamed story");
      story = updated;
    });

    it("lists stories for the project", async () => {
      const list = await client.userStories.list({ project: project.id });
      expect(list.some((s) => s.id === story.id)).toBe(true);
    });

    it("paginates stories", async () => {
      const seen: number[] = [];
      for await (const s of client.userStories.paginate({ project: project.id })) {
        seen.push(s.id);
      }
      expect(seen).toContain(story.id);
    });

    it("returns filters_data for stories", async () => {
      const data = await client.userStories.filtersData({ project: project.id });
      expect(data).toBeTypeOf("object");
    });
  });

  describe("tasks", () => {
    it("creates a task linked to the story", async () => {
      task = await client.tasks.create({
        project: project.id,
        subject: "Test task",
        user_story: story.id,
      });
      expect(task.id).toBeTypeOf("number");
      expect(task.user_story).toBe(story.id);
    });

    it("lists tasks for the project", async () => {
      const list = await client.tasks.list({ project: project.id });
      expect(list.some((t) => t.id === task.id)).toBe(true);
    });

    it("deletes the task", async () => {
      await client.tasks.delete(task.id);
      const list = await client.tasks.list({ project: project.id });
      expect(list.some((t) => t.id === task.id)).toBe(false);
    });
  });

  describe("issues", () => {
    it("creates an issue", async () => {
      issue = await client.issues.create({
        project: project.id,
        subject: "Test issue",
        description: "from integration test",
      });
      expect(issue.id).toBeTypeOf("number");
    });

    it("upvotes and lists voters", async () => {
      await client.issues.upvote(issue.id);
      const voters = await client.issues.voters(issue.id);
      expect(Array.isArray(voters)).toBe(true);
    });

    it("watches and lists watchers", async () => {
      await client.issues.watch(issue.id);
      const watchers = await client.issues.watchers(issue.id);
      expect(Array.isArray(watchers)).toBe(true);
    });

    it("deletes the issue", async () => {
      await client.issues.delete(issue.id);
    });
  });

  describe("memberships", () => {
    it("lists memberships for the project (owner is a member)", async () => {
      const list = await client.memberships.list({ project: project.id });
      expect(list.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("user story cleanup", () => {
    it("deletes the story", async () => {
      await client.userStories.delete(story.id);
    });
  });
});

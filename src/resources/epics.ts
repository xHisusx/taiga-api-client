import type { HttpClient } from "../http.js";
import type { Id } from "../types/common.js";
import type {
  AddRelatedUserStoryPayload,
  BulkCreateEpicsPayload,
  CreateEpicPayload,
  Epic,
  EpicRelatedUserStory,
  EpicVoter,
  EpicWatcher,
  ListEpicsParams,
  UpdateEpicPayload,
} from "../types/epic.js";
import { BaseResource } from "./base.js";

/**
 * Epics gateway. Available as `client.epics`.
 *
 * Inherits CRUD from {@link BaseResource} and adds bulk-create, the `filters_data` helper,
 * the `related_userstories` association endpoints, and voting + watching helpers.
 */
export class EpicsResource extends BaseResource<Epic, CreateEpicPayload, UpdateEpicPayload, ListEpicsParams> {
  constructor(options: { http: HttpClient }) {
    super({ http: options.http, path: "/epics" });
  }

  /**
   * `POST /epics/bulk_create` — create several epics at once from a multi-line string.
   * Each line becomes a separate epic (the same way the Taiga UI works).
   *
   * @example
   * ```ts
   * await client.epics.bulkCreate({
   *   project_id: 1,
   *   bulk_epics: "Q1 roadmap\nQ2 roadmap\nQ3 roadmap",
   * });
   * ```
   */
  async bulkCreate(payload: BulkCreateEpicsPayload): Promise<Epic[]> {
    const result = await this.http.post<Epic[]>("/epics/bulk_create", { body: payload });
    return result.data;
  }

  /** `GET /epics/filters_data?project=...` — available filter values for the UI. */
  async filtersData(params: { project: Id }): Promise<Record<string, unknown>> {
    const result = await this.http.get<Record<string, unknown>>("/epics/filters_data", {
      query: { project: params.project },
    });
    return result.data;
  }

  /** `GET /epics/:id/related_userstories` — user stories linked to this epic. */
  async relatedUserStories(id: Id): Promise<EpicRelatedUserStory[]> {
    const result = await this.http.get<EpicRelatedUserStory[]>(`/epics/${id}/related_userstories`);
    return result.data;
  }

  /** `POST /epics/:id/related_userstories` — link an existing user story to the epic. */
  async addRelatedUserStory(id: Id, payload: AddRelatedUserStoryPayload): Promise<EpicRelatedUserStory> {
    const result = await this.http.post<EpicRelatedUserStory>(`/epics/${id}/related_userstories`, {
      body: payload,
    });
    return result.data;
  }

  /** `DELETE /epics/:id/related_userstories/:userStoryId` — unlink a user story from the epic. */
  async removeRelatedUserStory(id: Id, userStoryId: Id): Promise<void> {
    await this.http.delete(`/epics/${id}/related_userstories/${userStoryId}`);
  }

  /** `GET /epics/:id/voters` — users that have upvoted the epic. */
  async voters(id: Id): Promise<EpicVoter[]> {
    const result = await this.http.get<EpicVoter[]>(`/epics/${id}/voters`);
    return result.data;
  }

  /** `POST /epics/:id/upvote` — register your upvote on the epic. */
  async upvote(id: Id): Promise<void> {
    await this.http.post(`/epics/${id}/upvote`);
  }

  /** `POST /epics/:id/downvote` — remove your upvote. */
  async downvote(id: Id): Promise<void> {
    await this.http.post(`/epics/${id}/downvote`);
  }

  /** `GET /epics/:id/watchers` — users currently watching the epic. */
  async watchers(id: Id): Promise<EpicWatcher[]> {
    const result = await this.http.get<EpicWatcher[]>(`/epics/${id}/watchers`);
    return result.data;
  }

  /** `POST /epics/:id/watch` — subscribe to notifications for this epic. */
  async watch(id: Id): Promise<void> {
    await this.http.post(`/epics/${id}/watch`);
  }

  /** `POST /epics/:id/unwatch` — unsubscribe from notifications for this epic. */
  async unwatch(id: Id): Promise<void> {
    await this.http.post(`/epics/${id}/unwatch`);
  }
}

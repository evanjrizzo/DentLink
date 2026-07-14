import type { DentLinkApiClient } from "@dentlink/api-client";
import type { SyncChange, SyncCursor } from "@dentlink/item-model";

export type SyncState = {
  cursor: SyncCursor;
  changes: SyncChange[];
};

export class DentLinkSyncEngine {
  private cursor: SyncCursor;

  constructor(
    private readonly apiClient: Pick<DentLinkApiClient, "sync">,
    initialCursor: SyncCursor = "0"
  ) {
    this.cursor = initialCursor;
  }

  getCursor(): SyncCursor {
    return this.cursor;
  }

  async pull(): Promise<SyncState> {
    const response = await this.apiClient.sync(this.cursor);
    this.cursor = response.cursor;
    return response;
  }
}

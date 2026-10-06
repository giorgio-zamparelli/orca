import type { RpcClient } from '../transport/rpc-client'
import type { HostCatalogEntry } from '../transport/types'
import { WorktreeCatalogSnapshotClient } from '../worktree/worktree-catalog-snapshot-client'
import {
  projectWatchWorkspaces,
  WATCH_LIVE_MAX_AGE_MS,
  type WatchHostSnapshot,
  type WatchWorkspace
} from './watch-workspace-snapshot'

type WatchHost = Pick<HostCatalogEntry, 'id' | 'name' | 'credentialStatus'>
type ClientEntry = { hostId: string; client: RpcClient }
type CatalogEntry = {
  client: RpcClient | null
  reader: WorktreeCatalogSnapshotClient
  available: boolean
  updatedAt: number | null
  totalCount: number
  workspaces: WatchWorkspace[]
  pending: Promise<void> | null
}

export class WatchWorkspaceCatalog {
  private hosts: readonly WatchHost[] = []
  private entries = new Map<string, CatalogEntry>()

  restore(hosts: readonly WatchHostSnapshot[]): void {
    for (const host of hosts) {
      this.entries.set(host.id, {
        client: null,
        reader: new WorktreeCatalogSnapshotClient(),
        available: false,
        updatedAt: host.updatedAt,
        totalCount: host.totalCount,
        workspaces: host.workspaces,
        pending: null
      })
    }
  }

  setSources(hosts: readonly WatchHost[], clients: readonly ClientEntry[]): void {
    this.hosts = hosts
    const ids = new Set(hosts.map((host) => host.id))
    for (const id of this.entries.keys()) {
      if (!ids.has(id)) {
        this.entries.delete(id)
      }
    }
    for (const host of hosts) {
      const previous = this.entries.get(host.id)
      const client =
        host.credentialStatus === 'ready'
          ? (clients.find((entry) => entry.hostId === host.id)?.client ?? null)
          : null
      if (host.credentialStatus === 'missing') {
        this.entries.delete(host.id)
        continue
      }
      if (!previous || previous.client !== client) {
        this.entries.set(host.id, {
          client,
          reader: new WorktreeCatalogSnapshotClient(),
          available: false,
          updatedAt: previous?.updatedAt ?? null,
          totalCount: previous?.totalCount ?? 0,
          workspaces: previous?.workspaces ?? [],
          pending: null
        })
      }
    }
  }

  async refresh(): Promise<void> {
    await Promise.all(
      [...this.entries].map(([id, entry]) => {
        entry.pending ??= this.refreshHost(id, entry).finally(() => {
          entry.pending = null
        })
        return entry.pending
      })
    )
  }

  snapshot(now = Date.now()): WatchHostSnapshot[] {
    return this.hosts.map((host) => {
      const entry = this.entries.get(host.id)
      return {
        id: host.id,
        name: host.name,
        available:
          host.credentialStatus === 'ready' &&
          entry?.available === true &&
          entry.client?.getState() === 'connected' &&
          entry.updatedAt !== null &&
          now - entry.updatedAt <= WATCH_LIVE_MAX_AGE_MS,
        updatedAt: entry?.updatedAt ?? null,
        totalCount: entry?.totalCount ?? 0,
        workspaces: entry?.workspaces ?? []
      }
    })
  }

  private async refreshHost(id: string, entry: CatalogEntry): Promise<void> {
    if (!entry.client || entry.client.getState() !== 'connected') {
      entry.available = false
      return
    }
    try {
      const result = await entry.reader.fetch(entry.client, id)
      if (this.entries.get(id) !== entry || entry.client.getState() !== 'connected') {
        return
      }
      const rows = entry.reader.admit(result.kind === 'response' ? result.pending : null)
      if (!rows) {
        entry.available = false
        return
      }
      entry.workspaces = projectWatchWorkspaces(rows)
      entry.totalCount = entry.workspaces.length
      entry.updatedAt = Date.now()
      entry.available = true
    } catch {
      entry.available = false
      // Don't reuse a snapshot token whose rows failed the watch projection.
      entry.reader = new WorktreeCatalogSnapshotClient()
    }
  }
}

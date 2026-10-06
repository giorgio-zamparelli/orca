import { Buffer } from 'buffer'
import { z } from 'zod'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils'
import { normalizeExecutionHostId } from '../../../src/shared/execution-host'
import { getWorktreeRowIdentity } from '../worktree/worktree-host-row-identity'
import { getWorktreeStatus } from '../worktree/workspace-list-ordering'

export const WATCH_SNAPSHOT_MAX_BYTES = 60 * 1024
export const WATCH_WORKSPACE_LIMIT = 100
export const WATCH_HOST_LIMIT = 20
export const WATCH_LIVE_MAX_AGE_MS = 60_000

const watchStatusSchema = z.enum(['permission', 'working', 'done', 'active', 'inactive'])

const workspaceSchema = z.object({
  worktreeId: z.string().min(1),
  hostId: z.string().optional(),
  displayName: z.string().default(''),
  repo: z.string().default(''),
  branch: z.string().default(''),
  comment: z.string().default(''),
  isArchived: z.boolean().default(false),
  isPinned: z.boolean().default(false),
  hasHostSidebarActivity: z.boolean().optional(),
  status: watchStatusSchema.optional(),
  liveTerminalCount: z.number().int().nonnegative().default(0)
})

export type WatchWorkspace = {
  id: string
  name: string
  repo: string
  branch: string
  comment: string
  status: ReturnType<typeof getWorktreeStatus>
  terminalCount: number
  isPinned: boolean
}

export type WatchHostSnapshot = {
  id: string
  name: string
  available: boolean
  updatedAt: number | null
  totalCount: number
  workspaces: WatchWorkspace[]
}

export type WatchWorkspaceSnapshot = {
  version: 1
  generatedAt: number
  omittedHostCount: number
  hosts: WatchHostSnapshot[]
}

const snapshotSchema = z
  .object({
    version: z.literal(1),
    generatedAt: z.number().int().nonnegative(),
    omittedHostCount: z.number().int().nonnegative(),
    hosts: z
      .array(
        z.object({
          id: z.string().min(1),
          name: z.string(),
          available: z.boolean(),
          updatedAt: z.number().int().nonnegative().nullable(),
          totalCount: z.number().int().nonnegative(),
          workspaces: z
            .array(
              z.object({
                id: z.string().min(1),
                name: z.string(),
                repo: z.string(),
                branch: z.string(),
                comment: z.string(),
                status: watchStatusSchema,
                terminalCount: z.number().int().nonnegative(),
                isPinned: z.boolean()
              })
            )
            .max(WATCH_WORKSPACE_LIMIT)
        })
      )
      .max(WATCH_HOST_LIMIT)
  })
  .refine(
    (snapshot) =>
      new Set(snapshot.hosts.map((host) => host.id)).size === snapshot.hosts.length &&
      snapshot.hosts.reduce((count, host) => count + host.workspaces.length, 0) <=
        WATCH_WORKSPACE_LIMIT &&
      snapshot.hosts.every(
        (host) =>
          host.totalCount >= host.workspaces.length &&
          (host.updatedAt === null
            ? host.workspaces.length === 0
            : host.updatedAt <= snapshot.generatedAt) &&
          new Set(host.workspaces.map((workspace) => workspace.id)).size === host.workspaces.length
      )
  )

export function deserializeWatchSnapshot(json: string): WatchWorkspaceSnapshot | null {
  if (Buffer.byteLength(json, 'utf8') > WATCH_SNAPSHOT_MAX_BYTES) {
    return null
  }
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(json))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const statusOrder = { permission: 0, working: 1, done: 2, active: 3, inactive: 4 }

function truncateDisplayText(value: string, limit: number): string {
  // Preserve Unicode characters so Swift's JSON decoder never receives a split surrogate pair.
  return Array.from(value).slice(0, limit).join('')
}

export function projectWatchWorkspaces(rows: readonly unknown[]): WatchWorkspace[] {
  const workspaces = new Map<string, WatchWorkspace>()
  for (const row of rows) {
    const parsed = workspaceSchema.safeParse(row)
    if (!parsed.success) {
      throw new Error('Invalid workspace in watch catalog')
    }
    const workspace = parsed.data
    if (workspace.isArchived) {
      continue
    }
    const id = getWorktreeRowIdentity({
      worktreeId: workspace.worktreeId,
      hostId: normalizeExecutionHostId(workspace.hostId) ?? undefined
    })
    workspaces.set(id, {
      id: bytesToHex(sha256(utf8ToBytes(id))),
      name: truncateDisplayText(
        workspace.displayName || workspace.branch || workspace.repo || 'Workspace',
        100
      ),
      repo: truncateDisplayText(workspace.repo, 80),
      branch: truncateDisplayText(workspace.branch.replace(/^refs\/heads\//, ''), 100),
      comment: truncateDisplayText(workspace.comment, 160),
      status: getWorktreeStatus(workspace),
      terminalCount: workspace.liveTerminalCount,
      isPinned: workspace.isPinned
    })
  }
  return [...workspaces.values()].sort(
    (left, right) =>
      statusOrder[left.status] - statusOrder[right.status] ||
      Number(right.isPinned) - Number(left.isPinned) ||
      left.name.localeCompare(right.name)
  )
}

export function serializeWatchSnapshot(
  hosts: readonly WatchHostSnapshot[],
  now = Date.now()
): string {
  let remaining = WATCH_WORKSPACE_LIMIT
  const snapshot: WatchWorkspaceSnapshot = {
    version: 1,
    generatedAt: now,
    omittedHostCount: Math.max(0, hosts.length - WATCH_HOST_LIMIT),
    hosts: hosts.slice(0, WATCH_HOST_LIMIT).map((host) => {
      const workspaces = host.workspaces.slice(0, remaining)
      remaining -= workspaces.length
      return { ...host, name: truncateDisplayText(host.name, 100), workspaces }
    })
  }
  let json = JSON.stringify(snapshot)
  while (Buffer.byteLength(json, 'utf8') > WATCH_SNAPSHOT_MAX_BYTES) {
    const lastWithRows = snapshot.hosts.findLast((host) => host.workspaces.length > 0)
    if (!lastWithRows) {
      throw new Error('Watch host metadata exceeds transfer budget')
    }
    lastWithRows.workspaces.pop()
    json = JSON.stringify(snapshot)
  }
  return json
}

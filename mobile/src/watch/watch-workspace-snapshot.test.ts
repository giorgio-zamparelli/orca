import { Buffer } from 'buffer'
import { describe, expect, it } from 'vitest'
import {
  deserializeWatchSnapshot,
  projectWatchWorkspaces,
  serializeWatchSnapshot,
  WATCH_SNAPSHOT_MAX_BYTES,
  type WatchHostSnapshot
} from './watch-workspace-snapshot'

describe('watch workspace snapshots', () => {
  it('keeps folder workspaces and host identities, reuses mobile status, and excludes private fields', () => {
    const rows = projectWatchWorkspaces([
      {
        worktreeId: 'same',
        hostId: 'local',
        workspaceKind: 'folder-workspace',
        displayName: 'Folder',
        status: 'working',
        hasHostSidebarActivity: false,
        deviceToken: 'secret',
        preview: 'terminal output'
      },
      {
        worktreeId: 'same',
        hostId: 'ssh:remote',
        displayName: 'Remote',
        status: 'permission',
        branch: 'refs/heads/fix'
      },
      { worktreeId: 'archived', isArchived: true }
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ name: 'Remote', branch: 'fix', status: 'permission' })
    expect(rows[1]).toMatchObject({ name: 'Folder', status: 'inactive' })
    expect(rows[0]?.id).not.toBe(rows[1]?.id)
    expect(JSON.stringify(rows)).not.toMatch(/secret|terminal output|deviceToken|preview/)
  })

  it('rejects a malformed catalog rather than claiming an authoritative empty list', () => {
    expect(() => projectWatchWorkspaces([{ displayName: 'Missing identity' }])).toThrow()
  })

  it('preserves emoji at display limits for the native JSON decoder', () => {
    const text = 'a' + '🦦'.repeat(200)
    const workspaces = projectWatchWorkspaces([
      { worktreeId: 'unicode', displayName: text, repo: text, branch: text, comment: text }
    ])
    expect(workspaces[0]).toMatchObject({
      name: 'a' + '🦦'.repeat(99),
      repo: 'a' + '🦦'.repeat(79),
      branch: 'a' + '🦦'.repeat(99),
      comment: 'a' + '🦦'.repeat(159)
    })
    const json = serializeWatchSnapshot(
      [{ id: 'host', name: text, available: true, updatedAt: 1000, totalCount: 1, workspaces }],
      1000
    )
    expect(JSON.parse(json).hosts[0].name).toBe('a' + '🦦'.repeat(99))
    expect(json).not.toMatch(/\\ud[89ab][0-9a-f]{2}/i)
  })

  it('bounds Unicode payloads and reports the full count without mutating the catalog', () => {
    const workspaces = projectWatchWorkspaces(
      Array.from({ length: 500 }, (_, index) => ({
        worktreeId: `row-${index}`,
        displayName: '😀'.repeat(100),
        repo: '漢'.repeat(80),
        branch: '漢'.repeat(100),
        comment: '漢'.repeat(160)
      }))
    )
    const host: WatchHostSnapshot = {
      id: 'host',
      name: 'Desktop',
      available: true,
      updatedAt: 1000,
      totalCount: 500,
      workspaces
    }
    const json = serializeWatchSnapshot([host], 1000)
    const snapshot = JSON.parse(json)
    expect(Buffer.byteLength(json, 'utf8')).toBeLessThanOrEqual(WATCH_SNAPSHOT_MAX_BYTES)
    expect(snapshot.hosts[0].workspaces.length).toBeGreaterThan(0)
    expect(snapshot.hosts[0].workspaces.length).toBeLessThanOrEqual(100)
    expect(snapshot.hosts[0].totalCount).toBe(500)
    expect(host.workspaces).toHaveLength(500)
  })

  it('names omitted hosts and preserves a known empty catalog', () => {
    const hosts = Array.from({ length: 25 }, (_, index) => ({
      id: `host-${index}`,
      name: 'Host',
      available: true,
      updatedAt: 1000,
      totalCount: 0,
      workspaces: []
    }))
    expect(JSON.parse(serializeWatchSnapshot(hosts, 1000))).toMatchObject({
      version: 1,
      omittedHostCount: 5,
      hosts: expect.any(Array)
    })
    expect(JSON.parse(serializeWatchSnapshot(hosts, 1000)).hosts).toHaveLength(20)
  })

  it('restores a validated display cache and rejects corrupt or incompatible snapshots', () => {
    const host: WatchHostSnapshot = {
      id: 'desktop',
      name: 'Desktop',
      available: true,
      updatedAt: 1000,
      totalCount: 25,
      workspaces: projectWatchWorkspaces([{ worktreeId: 'workspace', displayName: 'Cached work' }])
    }
    const json = serializeWatchSnapshot([host], 1000)
    expect(deserializeWatchSnapshot(json)?.hosts[0]).toEqual(host)
    for (const invalid of [
      '',
      '{invalid JSON}',
      json.replace('"version":1', '"version":2'),
      json.replace('"totalCount":25', '"totalCount":0'),
      json.replace('"updatedAt":1000', '"updatedAt":2000'),
      ' '.repeat(WATCH_SNAPSHOT_MAX_BYTES + 1)
    ]) {
      expect(deserializeWatchSnapshot(invalid)).toBeNull()
    }
  })
})

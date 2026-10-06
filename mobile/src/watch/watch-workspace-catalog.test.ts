import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RpcClient } from '../transport/rpc-client'
import { WatchWorkspaceCatalog } from './watch-workspace-catalog'
import { projectWatchWorkspaces } from './watch-workspace-snapshot'

const host = { id: 'desktop', name: 'Desktop', credentialStatus: 'ready' as const }
const row = { worktreeId: 'workspace', displayName: 'Fix login', status: 'working' }

function makeClient() {
  return {
    sendRequest: vi.fn<RpcClient['sendRequest']>().mockResolvedValue({
      id: 'request',
      ok: true,
      result: { worktrees: [row], snapshotId: 'snapshot-1' }
    }),
    getState: vi.fn<RpcClient['getState']>().mockReturnValue('connected'),
    subscribe: () => () => {},
    updateTerminalSubscriptionViewport: () => {},
    getReconnectAttempt: () => 0,
    getLastConnectedAt: () => null,
    onStateChange: () => () => {},
    notifyForeground: () => {},
    close: () => {}
  } satisfies RpcClient
}

afterEach(() => {
  vi.useRealTimers()
})

describe('watch workspace catalog', () => {
  it('retains cached rows and full counts through startup until a host proves its current catalog', async () => {
    vi.useFakeTimers().setSystemTime(2000)
    const client = makeClient()
    const catalog = new WatchWorkspaceCatalog()
    catalog.restore([
      {
        id: host.id,
        name: host.name,
        available: true,
        updatedAt: 1000,
        totalCount: 25,
        workspaces: projectWatchWorkspaces([row])
      }
    ])
    catalog.setSources([host], [])
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({
      available: false,
      totalCount: 25,
      updatedAt: 1000
    })
    expect(catalog.snapshot()[0]?.workspaces).toHaveLength(1)
    catalog.setSources([host], [{ hostId: host.id, client }])
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({ available: true, totalCount: 1, updatedAt: 2000 })
    catalog.setSources([], [])
    expect(catalog.snapshot()).toEqual([])
  })

  it('refreshes conditional snapshots and expires live claims', async () => {
    vi.useFakeTimers().setSystemTime(1000)
    const client = makeClient()
    const catalog = new WatchWorkspaceCatalog()
    catalog.setSources([host], [{ hostId: host.id, client }])
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({ available: true, totalCount: 1, updatedAt: 1000 })
    client.sendRequest.mockResolvedValue({
      id: 'request',
      ok: true,
      result: { unchanged: true, snapshotId: 'snapshot-1' }
    })
    vi.setSystemTime(2000)
    await catalog.refresh()
    expect(client.sendRequest).toHaveBeenLastCalledWith('worktree.ps', {
      limit: 10_000,
      afterSnapshotId: 'snapshot-1'
    })
    expect(catalog.snapshot()[0]).toMatchObject({ available: true, totalCount: 1, updatedAt: 2000 })
    expect(catalog.snapshot(62_001)[0]?.available).toBe(false)
  })

  it('retains last-known rows after a refusal or disconnect and admits a confirmed empty catalog', async () => {
    const client = makeClient()
    const catalog = new WatchWorkspaceCatalog()
    catalog.setSources([host], [{ hostId: host.id, client }])
    await catalog.refresh()
    client.sendRequest.mockResolvedValue({
      id: 'request',
      ok: false,
      error: { code: 'offline', message: 'Host unavailable' }
    })
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({ available: false, totalCount: 1 })
    client.sendRequest.mockResolvedValue({ id: 'request', ok: true, result: { worktrees: [] } })
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({ available: true, totalCount: 0 })
    client.getState.mockReturnValue('disconnected')
    expect(catalog.snapshot()[0]?.available).toBe(false)
  })

  it('drops removed pairings and ignores their late replies', async () => {
    const client = makeClient()
    let resolve: ((value: Awaited<ReturnType<RpcClient['sendRequest']>>) => void) | undefined
    client.sendRequest.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    const catalog = new WatchWorkspaceCatalog()
    catalog.setSources([host], [{ hostId: host.id, client }])
    const pending = catalog.refresh()
    catalog.setSources([], [])
    resolve?.({ id: 'request', ok: true, result: { worktrees: [row] } })
    await pending
    expect(catalog.snapshot()).toEqual([])
  })

  it('purges workspace data when credentials are gone and rejects malformed successes', async () => {
    const client = makeClient()
    const catalog = new WatchWorkspaceCatalog()
    catalog.setSources([host], [{ hostId: host.id, client }])
    await catalog.refresh()
    client.sendRequest.mockResolvedValue({
      id: 'request',
      ok: true,
      result: { worktrees: [{ displayName: 'Malformed' }] }
    })
    await catalog.refresh()
    expect(catalog.snapshot()[0]).toMatchObject({ available: false, totalCount: 1 })
    catalog.setSources([{ ...host, credentialStatus: 'missing' }], [])
    expect(catalog.snapshot()[0]).toMatchObject({
      available: false,
      totalCount: 0,
      updatedAt: null
    })
  })

  it('retries a malformed row snapshot without reusing its conditional token', async () => {
    const client = makeClient()
    const catalog = new WatchWorkspaceCatalog()
    catalog.setSources([host], [{ hostId: host.id, client }])
    await catalog.refresh()
    client.sendRequest.mockResolvedValue({
      id: 'request',
      ok: true,
      result: { worktrees: [{ displayName: 'Malformed' }], snapshotId: 'bad-snapshot' }
    })
    await catalog.refresh()
    client.sendRequest.mockResolvedValue({
      id: 'request',
      ok: true,
      result: { worktrees: [row], snapshotId: 'recovered-snapshot' }
    })
    await catalog.refresh()
    expect(client.sendRequest).toHaveBeenLastCalledWith('worktree.ps', {
      limit: 10_000,
      afterSnapshotId: null
    })
    expect(catalog.snapshot()[0]).toMatchObject({ available: true, totalCount: 1 })
  })
})

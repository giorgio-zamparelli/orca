import { beforeEach, describe, expect, it, vi } from 'vitest'

const { gitExecFileAsyncMock, resolveGitDirMock, translateWslOutputPathsMock } = vi.hoisted(() => ({
  gitExecFileAsyncMock: vi.fn(),
  resolveGitDirMock: vi.fn(),
  translateWslOutputPathsMock: vi.fn((output: string) => output)
}))

vi.mock('./runner', () => ({
  gitExecFileAsync: gitExecFileAsyncMock,
  translateWslOutputPaths: translateWslOutputPathsMock
}))
vi.mock('./status', () => ({
  resolveGitDir: resolveGitDirMock,
  runWithGitReadCacheInvalidation: vi.fn()
}))
vi.mock('../worktree-trash', () => ({
  moveWorktreeDirectoryToTrash: vi.fn(),
  restoreWorktreeDirectoryFromTrash: vi.fn(),
  scheduleWorktreeTrashDeletion: vi.fn()
}))

import { listWorktrees, listWorktreesForCreate, WORKTREE_LIST_TIMEOUT_MS } from './worktree'
import { registerWorktreeSuiteHooks } from './worktree-test-harness'

registerWorktreeSuiteHooks()

function graph(paths = ['/repo', '/repo-feature', '/repo-sibling']): string {
  return paths
    .map(
      (path, index) =>
        `worktree ${path}\nHEAD abc123\nbranch refs/heads/${['main', 'feature', 'sibling'][index]}\n`
    )
    .join('\n')
}

describe('listWorktreesForCreate', () => {
  beforeEach(() => {
    gitExecFileAsyncMock.mockReset().mockResolvedValue({ stdout: graph() })
    resolveGitDirMock.mockReset().mockResolvedValue(undefined)
    translateWslOutputPathsMock.mockReset().mockImplementation((output: string) => output)
  })

  it('preserves every root but probes only the created worktree', async () => {
    const worktrees = await listWorktreesForCreate('/repo', '/repo-feature', 'feature')

    expect(worktrees.map((worktree) => worktree.path)).toEqual([
      '/repo',
      '/repo-feature',
      '/repo-sibling'
    ])
    expect(resolveGitDirMock.mock.calls).toEqual([['/repo-feature']])
    expect(gitExecFileAsyncMock).toHaveBeenCalledExactlyOnceWith(
      ['worktree', 'list', '--porcelain', '-z'],
      { cwd: '/repo', timeout: WORKTREE_LIST_TIMEOUT_MS }
    )
  })

  it('uses the exact branch when Git canonicalizes a symlinked destination', async () => {
    await listWorktreesForCreate('/repo', '/alias/feature', 'feature')
    expect(resolveGitDirMock.mock.calls).toEqual([['/repo-feature']])
  })

  it('prefers a normalized path match over a different branch match', async () => {
    await listWorktreesForCreate('/repo', '/repo-feature/', 'sibling')
    expect(resolveGitDirMock.mock.calls).toEqual([['/repo-feature']])
  })

  it('does not probe unrelated worktrees if neither path nor exact branch exists', async () => {
    const worktrees = await listWorktreesForCreate('/repo', '/missing', 'feat')
    expect(worktrees).toHaveLength(3)
    expect(resolveGitDirMock).not.toHaveBeenCalled()
  })

  it('propagates listing failures instead of reporting a successful empty graph', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 128 })
    gitExecFileAsyncMock.mockRejectedValue(error)
    await expect(listWorktreesForCreate('/repo', '/repo-feature', 'feature')).rejects.toBe(error)
    expect(resolveGitDirMock).not.toHaveBeenCalled()
    expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(1)
  })

  it('preserves the older-Git fallback and caches its capability decision', async () => {
    gitExecFileAsyncMock.mockRejectedValueOnce(Object.assign(new Error('usage'), { code: 129 }))
    await listWorktreesForCreate('/repo', '/repo-feature', 'feature')
    await listWorktreesForCreate('/repo', '/repo-feature', 'feature')
    expect(gitExecFileAsyncMock.mock.calls.map(([args]) => args)).toEqual([
      ['worktree', 'list', '--porcelain', '-z'],
      ['worktree', 'list', '--porcelain'],
      ['worktree', 'list', '--porcelain']
    ])
    expect(resolveGitDirMock.mock.calls).toEqual([['/repo-feature'], ['/repo-feature']])
  })

  it('forwards WSL execution, cancellation and timeout options', async () => {
    const options = { wslDistro: 'Ubuntu', signal: new AbortController().signal, timeout: 5000 }
    await listWorktreesForCreate('/repo', '/repo-feature', 'feature', options)
    expect(gitExecFileAsyncMock).toHaveBeenCalledWith(['worktree', 'list', '--porcelain', '-z'], {
      cwd: '/repo',
      ...options
    })
  })

  it('normalizes Windows path casing and separators', async () => {
    gitExecFileAsyncMock.mockResolvedValue({
      stdout: graph(['C:/repo', 'C:/repo-feature', 'C:/sibling'])
    })
    await listWorktreesForCreate('C:/repo', 'c:\\repo-feature\\', 'missing')
    expect(resolveGitDirMock.mock.calls).toEqual([['C:/repo-feature']])
  })

  it('does not join a shared scan stalled on a sibling sparse probe', async () => {
    let releaseSibling!: () => void
    let siblingStarted!: () => void
    const started = new Promise<void>((resolve) => {
      siblingStarted = resolve
    })
    const blocked = new Promise<undefined>((resolve) => {
      releaseSibling = () => resolve(undefined)
    })
    resolveGitDirMock.mockImplementation((path: string) => {
      if (path === '/repo-sibling') {
        siblingStarted()
        return blocked
      }
      return Promise.resolve(undefined)
    })
    const sharedScan = listWorktrees('/repo')
    try {
      await started
      resolveGitDirMock.mockClear()
      const created = await listWorktreesForCreate('/repo', '/repo-feature', 'feature')
      expect(created).toHaveLength(3)
      expect(resolveGitDirMock.mock.calls).toEqual([['/repo-feature']])
      expect(gitExecFileAsyncMock).toHaveBeenCalledTimes(2)
    } finally {
      releaseSibling()
      await sharedScan
    }
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from './runner'
import { isWorktreePreparationEnabled } from './worktree-preparation-policy'

vi.mock('./runner', () => ({ gitExecFileAsync: vi.fn() }))
const runGit = vi.mocked(gitExecFileAsync)

beforeEach(() => {
  runGit.mockReset()
})

describe('worktree preparation policy', () => {
  it.each([
    ['true\n', true],
    ['false\n', false]
  ])('reads Git-normalized %s', async (stdout, expected) => {
    runGit.mockResolvedValue({ stdout, stderr: '' })
    await expect(isWorktreePreparationEnabled('/repo')).resolves.toBe(expected)
    expect(runGit).toHaveBeenCalledWith(
      ['config', '--get', '--bool', 'orca.worktreeCreatePreparation'],
      { cwd: '/repo', timeout: 1_000 }
    )
  })

  it('keeps preparation enabled when the setting is absent', async () => {
    runGit.mockRejectedValue(Object.assign(new Error('unset'), { code: 1 }))
    await expect(isWorktreePreparationEnabled('/repo')).resolves.toBe(true)
  })

  it.each([128, 'ETIMEDOUT'])(
    'skips optional preparation on a failed policy read (%s)',
    async (code) => {
      runGit.mockRejectedValue(Object.assign(new Error('unreadable'), { code }))
      await expect(isWorktreePreparationEnabled('/repo')).resolves.toBe(false)
    }
  )

  it('reads on the owning WSL host without leaking one repo policy to another', async () => {
    runGit
      .mockResolvedValueOnce({ stdout: 'false', stderr: '' })
      .mockResolvedValueOnce({ stdout: 'true', stderr: '' })
    const signal = new AbortController().signal
    await expect(
      isWorktreePreparationEnabled('/repo', { wslDistro: 'Ubuntu', signal })
    ).resolves.toBe(false)
    await expect(isWorktreePreparationEnabled('/other', { wslDistro: 'Debian' })).resolves.toBe(
      true
    )
    expect(runGit.mock.calls[0][1]).toEqual({
      cwd: '/repo',
      wslDistro: 'Ubuntu',
      signal,
      timeout: 1_000
    })
    expect(runGit.mock.calls[1][1]).toEqual({ cwd: '/other', wslDistro: 'Debian', timeout: 1_000 })
  })

  it('does not swallow cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = new Error('cancelled')
    runGit.mockRejectedValue(error)
    await expect(isWorktreePreparationEnabled('/repo', { signal: controller.signal })).rejects.toBe(
      error
    )
  })
})

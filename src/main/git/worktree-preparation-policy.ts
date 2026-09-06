import { gitExecFileAsync } from './runner'
import {
  getErrorCode,
  gitExecOptions,
  type GitWorktreeExecOptions
} from './worktree-operation-options'

/** External worktree providers need the ordinary `worktree add` path, not a prepared move. */
export async function isWorktreePreparationEnabled(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<boolean> {
  try {
    const { stdout } = await gitExecFileAsync(
      ['config', '--get', '--bool', 'orca.worktreeCreatePreparation'],
      { ...gitExecOptions(repoPath, options), timeout: options.timeout ?? 1_000 }
    )
    return stdout.trim() === 'true'
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }
    // Unset preserves the default; an unreadable policy skips this optional optimization.
    return getErrorCode(error) === '1'
  }
}

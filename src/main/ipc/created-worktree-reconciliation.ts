import { describeCreatedWorktree, listWorktreesSharedStrict } from '../git/worktree'
// Not via the worktree barrel: suites mock that module wholesale and would blank the constant.
import { WORKTREE_LIST_TIMEOUT_MS } from '../git/worktree-operation-options'
import type { GitWorktreeExecOptions } from '../git/worktree'
import type { GitWorktreeInfo } from '../../shared/worktree/types'
import { areWorktreePathsEqual } from './worktree-path-comparison'

export function findCreatedWorktree<T extends { path: string; branch?: string }>(
  worktrees: readonly T[],
  requestedPath: string,
  branchName: string,
  platform = process.platform
): T | undefined {
  const direct = worktrees.find((worktree) =>
    areWorktreePathsEqual(worktree.path, requestedPath, platform)
  )
  if (direct) {
    return direct
  }

  return worktrees.find((worktree) => worktree.branch === `refs/heads/${branchName}`)
}

export type CreatedWorktreeResolution = {
  created: GitWorktreeInfo
  /** Rows `git worktree list` returned; empty when only the direct read found the worktree. */
  worktrees: readonly GitWorktreeInfo[]
  /** Whether `worktrees` is the repo's whole listing, and so usable as its authorized-root set. */
  listingComplete: boolean
}

/** `created but not found in listing` is load-bearing for `classifyWorkspaceCreateError`. */
export function createdWorktreeNotFoundError(worktreePath: string, branchName: string): Error {
  return new Error(
    `Worktree created but not found in listing: ${worktreePath} (branch ${branchName})`
  )
}

/** A direct read that burned the whole budget still leaves the listing a chance to answer. */
const MIN_CREATED_WORKTREE_RECOVERY_MS = 5_000

/**
 * Verify only the new worktree first: enriching every sibling can stall a successful create.
 * The listing remains a fallback when Git cannot describe the requested path directly (#16520).
 */
export async function resolveCreatedWorktree(
  repoPath: string,
  worktreePath: string,
  branchName: string,
  options?: GitWorktreeExecOptions
): Promise<CreatedWorktreeResolution> {
  const startedAt = Date.now()
  let describeError: unknown
  try {
    const described = await describeCreatedWorktree(repoPath, worktreePath, branchName, {
      ...options,
      timeout: options?.timeout ?? WORKTREE_LIST_TIMEOUT_MS
    })
    if (described) {
      return { created: described, worktrees: [], listingComplete: false }
    }
  } catch (err) {
    describeError = err
  }

  // Share the verification budget while leaving the fallback a chance to answer.
  const remainingMs = Math.max(
    WORKTREE_LIST_TIMEOUT_MS - (Date.now() - startedAt),
    MIN_CREATED_WORKTREE_RECOVERY_MS
  )
  const worktrees = await listWorktreesSharedStrict(repoPath, {
    ...options,
    timeout: options?.timeout ?? remainingMs
  })
  const created = findCreatedWorktree(worktrees, worktreePath, branchName)
  if (created) {
    return { created, worktrees, listingComplete: true }
  }
  const notFound = createdWorktreeNotFoundError(worktreePath, branchName)
  if (describeError) {
    // The listing simply omitted the row, so the direct read holds the only actionable failure.
    throw new Error(
      `${notFound.message}: ${describeError instanceof Error ? describeError.message : String(describeError)}`
    )
  }
  throw notFound
}

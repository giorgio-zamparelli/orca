import { expect, it } from 'vitest'
import { listWorktreesSharedStrict } from '../git/worktree'
import { resolveCreatedWorktree } from './created-worktree-reconciliation'

// Opt-in, read-only comparison against an existing checkout; never creates or removes a worktree.
const repo = process.env.ORCA_VERIFY_BENCH_REPO
const worktree = process.env.ORCA_VERIFY_BENCH_WORKTREE
const branch = process.env.ORCA_VERIFY_BENCH_BRANCH

it.skipIf(!repo || !worktree || !branch)(
  'compares direct verification with the enriched listing',
  async () => {
    const started = performance.now()
    const direct = await resolveCreatedWorktree(repo!, worktree!, branch!)
    const directMs = performance.now() - started
    const listingStarted = performance.now()
    const listed = await listWorktreesSharedStrict(repo!)
    const listingMs = performance.now() - listingStarted
    expect(direct.listingComplete).toBe(false)
    expect(listed.find((row) => row.path === direct.created.path)).toMatchObject({
      head: direct.created.head,
      branch: direct.created.branch
    })
    console.log(JSON.stringify({ directMs, listingMs, worktreeCount: listed.length }))
  }
)

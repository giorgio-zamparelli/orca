# Local worktree creation latency

After `git worktree add`, local creation uses `listWorktreesForCreate`: a fresh
Git worktree graph, with sparse-checkout detection only for the created row.
Do not replace it with `listWorktrees` or `listWorktreesStrict`: those enrich
every sibling, and the shared list can also join a scan stalled on sibling I/O.

The graph still includes all roots, so post-create authorization retains existing
workspaces. Match the normalized destination first, then the exact branch to
handle Git canonicalizing symlinked paths. Missing targets retain the caller's
existing reconciliation error; Git listing failures propagate rather than
silently returning an empty graph.

The reader retains WSL path translation, caller signal/timeout options, and
the cached Git 2.25-compatible fallback for `worktree list --porcelain -z`.
That older-Git fallback still checks path existence to identify prunable entries;
the optimization removes sibling sparse probes, not compatibility safeguards.
SSH-provider creation, folder workspaces, and ordinary enriched listings are
unchanged. No RPC or persisted-schema changes are required.

This is the creation-scan backport of `a45b95b03` to the fork's older `main`.
That baseline predates native prepared checkouts, so the newer fix's
`orca.worktreeCreatePreparation` opt-out is not applicable here. If native
preparation is introduced during a future upstream update, retain that opt-out
so external warm pools can remain the sole checkout preparer.

Regression coverage lives in `worktree-create-listing.test.ts`,
`worktree-sparse-checkout.test.ts`, and `worktrees-local-create-flow.test.ts`:
stalled sibling scans, complete root registration, target sparse state, path
aliases, Windows paths, WSL execution options, and Git compatibility/errors.

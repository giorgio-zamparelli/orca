# Worktree creation performance

Local creation verifies the new worktree directly (path, common Git directory,
branch and HEAD), then adds that single authorized root. It does not wait for a
repository-wide listing and sparse-checkout inspection of every sibling. A direct
read failure still falls back to the full listing; only that full listing may
replace the repository's authorized-root set.

## External warm pools

Repositories whose Git wrapper already provides installed warm worktrees can opt
out of Orca's speculative detached checkouts:

```sh
git -C /path/to/repo config --local orca.worktreeCreatePreparation false
```

This routes new-branch creation through ordinary `git worktree add --no-track -b`,
which a wrapper can serve from its pool. Sparse and existing-branch creation retain
their own Git semantics. Orca does not depend on a particular pool implementation.

The policy is checked when arming and consuming preparations, using the repository's
execution host (native or WSL). An already-armed checkout is not awaited or claimed
after disabling; its normal TTL cleanup remains responsible for it. Direct SSH
creation does not use this local preparer. Folder workspaces never prepare a Git
checkout. Unset defaults to enabled; an unreadable/invalid policy skips speculative
work and leaves ordinary creation to report actionable Git errors.

The setting is read dynamically by builds supporting it; it cannot change the
behavior of an older running Orca process. To restore the default:

```sh
git -C /path/to/repo config --local --unset orca.worktreeCreatePreparation
```

`prepared_checkout: hit` in a creation trace means Orca used its own preparation,
not an external pool. Check the pool's claim log for external participation.

## Read-only timing check

Set `ORCA_VERIFY_BENCH_REPO`, `ORCA_VERIFY_BENCH_WORKTREE` and
`ORCA_VERIFY_BENCH_BRANCH` to an existing repository, linked worktree and branch,
then run:

```sh
pnpm exec vitest run --config config/vitest.config.ts src/main/ipc/worktree-create-verification.bench.test.ts
```

The opt-in test compares direct verification with the enriched listing, validates
their Git identity, and reports both timings and the worktree count. It does not
create or remove anything. A quiet filesystem may make both paths fast; the unit
test with an unresolved listing covers independence from a stalled shared scan.

## Live validation (2026-09-06)

Validated against the Waiterio monorepo with the patched 1.4.197 desktop in an
isolated dev profile. Both CLI and desktop-dialog creation claimed installed pool
slots, opened working terminals, and skipped the dependency install. The desktop
trace measured 2,397 ms total: 1,525 ms refreshing the base, 455 ms adding the
worktree (268 ms inside the pool claim), and 20 ms verifying the new checkout.
No native prepared checkout was armed. The earlier incident had measured
22,878 ms total, with 10,217 ms in post-create listing. These are individual
observations, not a latency guarantee; ref freshness, pool availability and host
load still affect creation. Both clean test worktrees were removed afterward.

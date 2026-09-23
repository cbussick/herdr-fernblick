# Development workflow

## Isolate each task

Keep the primary checkout on `main` for integration. Before any task edit, create a dedicated branch and worktree under `.worktrees/` (ignored by Git). One issue or task per worktree; resume an existing worktree only for the same task. Preserve pre-existing changes in the primary checkout and ask before integrating them.

For a standalone issue, branch from `main`. For a spec with children, create a spec integration branch from `main`, then branch each child from that branch; integrate children into the spec branch before integrating the whole spec into `main`. Use Linear's generated branch name when present, or a short descriptive name otherwise:

```sh
git worktree add .worktrees/<issue-key-or-task> -b <branch-name> <base-branch>
# Existing branch: omit -b
git worktree add .worktrees/<issue-key-or-task> <branch-name>
```

Run edits, checks, builds and commits in the task worktree. Install dependencies there (`npm ci`); its `node_modules`, build outputs and Vitest processes are separate from other worktrees. Follow [Development isolation](../development.md) for ports, Herdr sessions and runtime limitations. Keep concurrent check runs in separate worktrees.

## Review and integrate

Run `npm run check` in the task worktree and inspect the diff against the issue before handing off. Commit only task-related files. Report the branch, changes, checks and risks. Wait for explicit human approval of the named branch and target before integrating; a green check alone is not permission to merge or push `main`.

Before an authorized integration, fetch and update the target without discarding work. Reconcile target changes into the task branch and rerun checks on the combined result. Review for semantic conflicts even when Git reports none. If checks fail, describe the failures and request an explicit override for the named integration; otherwise stop. Merge only approved work, push normally (never force-push `main`), and verify the push succeeded before updating Linear. If the remote moved, reconcile and reverify before retrying. After integration, remove only merged clean worktrees, delete their branches as appropriate, and prune worktree records. Preserve unmerged or uncommitted work.

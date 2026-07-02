# Contributing to Scribe

Scribe is intentionally small. Prefer boring code, explicit checks, and focused tests over clever abstractions. The goal
is that a maintainer can come back after time away, read this file, and know where to make a change.

## Mental Model

The action does one linear job:

1. Read action inputs and GitHub event context.
2. Validate the checkout, especially for pull requests.
3. Configure Git identity and optional GPG signing.
4. Stage the requested files.
5. Commit only when staged changes exist.
6. Push to the right target.
7. Write outputs, a workflow summary, and optionally one shared PR comment.

Keep `src/index.js` close to that sequence. Put reusable details in the small modules below.

## Design Rules

- Pure Node.js standard library only: no runtime dependencies and no build step.
- The source lives under `src/`. `src/index.js` is committed as-is and referenced directly by `action.yml`
  (`runs.using: node24`, `main: src/index.js`).
- Keep modules flat. Add a new module only when it names a real responsibility.
- Treat error messages and workflow summaries as user-facing API. Test them when changing behavior.
- Keep secrets out of logs. Git command output passes through `git.js` redaction before it reaches annotations.
- Avoid supporting extra modes until a real workflow needs them.

## Files

| File                 | Responsibility                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/index.js`       | Entry point and orchestration. It should read like the action's happy path plus failures.                 |
| `src/inputs.js`      | Action input parsing, boolean handling, and Git identity defaults.                                        |
| `src/git.js`         | Git command wrapper, user-facing Git error hints, output redaction, GPG key import, and rollback helpers. |
| `src/github-auth.js` | Request-scoped `github-token` injection for `git push` (temporary `http.extraheader`, no config writes).  |
| `src/commit.js`      | Pure commit logic: file parsing, add args, PR push target, PR checkout validation.                        |
| `src/comment.js`     | Markdown rendering and commit-based PR comment record merging.                                            |
| `src/github.js`      | GitHub REST calls for finding, creating, and updating the shared PR comment.                              |
| `src/workflow.js`    | GitHub Actions command escaping, annotations, outputs, and event payload loading.                         |

Tests should sit beside the responsibility they protect: `src/inputs.test.js` for input parsing, `src/git.test.js` for
Git/GPG helpers, and so on.

## Event Behavior

| Event                                  | Push behavior                                             | Notes                                                                   |
| -------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `push` / `workflow_dispatch`           | `git push`                                                | The checkout token must be able to push to the current branch.          |
| `pull_request` / `pull_request_target` | `git push origin HEAD:refs/heads/<pull_request.head.ref>` | Same-repository PRs only. The checkout must be `pull_request.head.sha`. |

Fork PRs are rejected before staging files. Detached merge checkouts are rejected before staging files.

## When Changing Behavior

- Input changes: update `action.yml`, `README.md`, `src/inputs.js`, and `src/inputs.test.js`.
- Git command behavior: update `src/git.js` and add or adjust `src/git.test.js`.
- Git authentication behavior: it lives in `src/github-auth.js`. Keep `github-token` scoped to network commands
  (currently `git push`) and injected per command via the environment, never written to `process.env` or the local Git
  config. Update `src/github-auth.test.js` alongside it.
- PR push behavior: update `src/commit.js`, `src/commit.test.js`, and the README's pull request section.
- Summary or PR comment output: update `src/comment.js`, `src/comment.test.js`, and screenshots/examples if any are
  added later.
- GitHub API behavior: update `src/github.js` and `src/github.test.js`.
- Comment history behavior: keep the shared PR comment bounded; `src/comment.js` intentionally retains only the newest
  records and stores shortened hidden records so the comment body stays predictable.
- Comment author fallback behavior: keep it conservative. If `/user` cannot confirm the token owner, only bot-style
  login hints should be trusted for matching existing comments.

## Local Verification

Node.js 20 or later is enough. There are no dependencies to install.

```bash
npm test
```

Optional lint check:

```bash
docker pull ghcr.io/goeselt/pedant:latest
docker run --rm -v "$(pwd):/work" ghcr.io/goeselt/pedant:latest
```

## Submitting Changes

Commit messages and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). The release
pipeline uses the PR title to determine the next version.

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

Keep `index.js` close to that sequence. Put reusable details in the small modules below.

## Design Rules

- Pure Node.js standard library only: no runtime dependencies and no build step.
- `index.js` is committed as-is and referenced directly by `action.yml` (`runs.using: node24`).
- Keep modules flat. Add a new module only when it names a real responsibility.
- Treat error messages and workflow summaries as user-facing API. Test them when changing behavior.
- Keep secrets out of logs. Git command output passes through `git.js` redaction before it reaches annotations.
- Avoid supporting extra modes until a real workflow needs them.

## Files

| File          | Responsibility                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- |
| `index.js`    | Entry point and orchestration. It should read like the action's happy path plus failures. |
| `inputs.js`   | Action input parsing, boolean handling, and Git identity defaults.                        |
| `git.js`      | Git command wrapper, user-facing Git error hints, GPG key import, and rollback helpers.   |
| `commit.js`   | Pure commit logic: file parsing, add args, PR push target, PR checkout validation.        |
| `comment.js`  | Markdown rendering and commit-based PR comment record merging.                            |
| `github.js`   | GitHub REST calls for finding, creating, and updating the shared PR comment.              |
| `workflow.js` | GitHub Actions command escaping, annotations, outputs, and event payload loading.         |

Tests should sit beside the responsibility they protect: `inputs.test.js` for input parsing, `git.test.js` for Git/GPG
helpers, and so on.

## Event Behavior

| Event | Push behavior | Notes |
| ----- | ------------- | ----- |
| `push` / `workflow_dispatch` | `git push` | The checkout token must be able to push to the current branch. |
| `pull_request` / `pull_request_target` | `git push origin HEAD:refs/heads/<pull_request.head.ref>` | Same-repository PRs only. The checkout must be `pull_request.head.sha`. |

Fork PRs are rejected before staging files. Detached merge checkouts are rejected before staging files.

## When Changing Behavior

- Input changes: update `action.yml`, `README.md`, `inputs.js`, and `inputs.test.js`.
- Git command behavior: update `git.js` and add or adjust `git.test.js`.
- PR push behavior: update `commit.js`, `commit.test.js`, and the README's pull request section.
- Summary or PR comment output: update `comment.js`, `comment.test.js`, and screenshots/examples if any are added later.
- GitHub API behavior: update `github.js` and `github.test.js`.
- Comment history behavior: keep the shared PR comment bounded; `comment.js` intentionally retains only the newest
  records.

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

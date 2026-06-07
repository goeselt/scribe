# Contributing to Scribe

## Design

Pure Node.js standard library -- no runtime dependencies, no build step. The entry point `index.js` is committed as-is
and referenced directly by `action.yml` (`runs.using: node24`).

| File         | Responsibility                                                                               |
| ------------ | -------------------------------------------------------------------------------------------- |
| `commit.js`  | Pure logic: file list parsing, Git add args, push target resolution for push vs PR contexts. |
| `comment.js` | Markdown rendering and commit-based PR comment record merging.                               |
| `github.js`  | GitHub REST calls for finding, creating, and updating the shared PR comment.                 |
| `index.js`   | Entry point: reads inputs, orchestrates Git operations, imports GPG key, writes outputs.     |

The push target is the only behavior that differs between event contexts: `git push` on a push event,
`git push origin HEAD:refs/heads/<GITHUB_HEAD_REF>` on a pull_request event. Everything else is identical.

## Development Setup

Node.js 20 or later. No dependencies to install.

## Local Verification

Tests:

```bash
npm test
```

Lint:

```bash
docker pull ghcr.io/goeselt/pedant:latest
docker run --rm -v "$(pwd):/work" ghcr.io/goeselt/pedant:latest
```

## Submitting Changes

Commit messages and PR titles must follow [Conventional Commits](https://www.conventionalcommits.org/). The release
pipeline uses the PR title to determine the next version.

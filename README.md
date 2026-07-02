# Scribe

GitHub Action that stages files, commits them, and pushes the result -- with optional GPG signing, pull-request-aware
push targets, and request-scoped token handling.

A raw `git commit && git push` in a workflow leaves you to wire up identity, signing, PR head branches, token safety,
and rollback yourself. Scribe does that as one step:

- **Commit and push in one step.** Stages the requested files, commits only when something changed, and pushes to the
  right target. Exposes `committed` and the new `sha` as outputs.
- **Signed commits when you need them.** Pass a base64-encoded GPG key to sign; otherwise commits use the
  `github-actions[bot]` identity, unsigned.
- **Pull-request aware.** On `pull_request` events it pushes to the PR head branch and rejects fork or detached-merge
  checkouts before staging any files.
- **Token stays scoped.** `github-token` is injected per Git command and removed afterward -- never written to
  `.git/config` or left in the process environment.
- **Safe on failure.** If the push fails after a commit, Scribe rolls back the local commit and leaves the generated
  files in the workspace for diagnostics.
- **Reports what it did.** Writes a workflow summary every run and, on pull requests, can maintain one shared comment
  listing the commits it added.

Use Scribe when a workflow needs to commit generated or released files back to the repository safely, instead of
hand-rolling Git plumbing in `run:` steps.

## Getting Started

Minimal workflow:

```yaml
name: Update Generated Files

on:
  workflow_dispatch:

permissions:
  contents: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
        with:
          persist-credentials: false

      - name: Generate files
        run: npm run generate

      - name: Commit generated files
        uses: goeselt/scribe@<sha>
        with:
          files: |
            generated/
            package-lock.json
          message: 'chore: update generated files'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

For gitignored paths such as `dist/`, set `force: true`:

```yaml
- uses: goeselt/scribe@<sha>
  with:
    files: |
      dist/
      package.json
      package-lock.json
    message: 'chore: update bundle'
    force: true
```

For signed commits, pass a base64-encoded private key and, if needed, override the Git identity:

```yaml
- uses: goeselt/scribe@<sha>
  with:
    files: package.json
    message: 'chore: release ${{ steps.release.outputs.tag }}'
    git-user-name: ${{ vars.RELEASE_SIGNING_USER }}
    git-user-email: ${{ vars.RELEASE_SIGNING_EMAIL }}
    signing-key: ${{ secrets.RELEASE_SIGNING_KEY }}
```

## Inputs

| Input            | Required | Default                                                 | Description                                                          |
| ---------------- | -------- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| `files`          | Yes      | --                                                      | Newline-separated list of files or directories to stage.             |
| `message`        | Yes      | --                                                      | Commit message.                                                      |
| `git-user-name`  | No       | `github-actions[bot]`                                   | Git author name.                                                     |
| `git-user-email` | No       | `41898282+github-actions[bot]@users.noreply.github.com` | Git author email.                                                    |
| `signing-key`    | No       | `''`                                                    | Base64-encoded GPG signing key. When omitted, commits are unsigned.  |
| `force`          | No       | `false`                                                 | Pass `--force` to `git add`. Required for gitignored paths.          |
| `github-token`   | No       | `${{ github.token }}`                                   | Token used for `git push` and pull request comments.                 |
| `pr-comment`     | No       | `true`                                                  | Whether to create or update the explanatory PR comment on PR events. |
| `skip-ci`        | No       | `true`                                                  | Whether to append `[skip ci]` to the commit message when absent.     |

## Outputs

| Output      | Description                                                             |
| ----------- | ----------------------------------------------------------------------- |
| `committed` | `true` if a commit was created, `false` if there was nothing to commit. |
| `sha`       | SHA of the new commit. Empty when `committed` is `false`.               |

## Reporting

Scribe appends a workflow summary entry after each invocation, including the result, files, commit SHA, push target,
signing mode, and force-add mode.

`github-token` defaults to `${{ github.token }}`; `contents: write` covers the standard commit-and-push case. The token
is injected per command only, never written to `.git/config` or retained in the process environment, and removed after
each call -- so `persist-credentials: false` on the checkout step is recommended but not required.

If Scribe creates a commit but the push fails, it rolls back the local commit before failing the step. The generated
files remain in the workspace for logs or follow-up diagnostics.

For PR comment behavior and pull request context setup, see the [Integration Guide](docs/integration-guide.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).

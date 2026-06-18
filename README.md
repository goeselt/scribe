# scribe

GitHub Action that stages files, commits them, and pushes the result. Signing is optional, the default Git identity is
`github-actions[bot]`, and pull request push targets are handled after the workflow checks out the PR head commit.

Scribe writes a GitHub Actions workflow summary for every invocation. On pull request events, it can also maintain one
shared PR comment that lists the commits Scribe added to the PR.

## Usage

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
      - uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Generate files
        run: npm run generate

      - name: Commit generated files
        uses: goeselt/scribe@v1
        with:
          files: |
            generated/
            package-lock.json
          message: 'chore: update generated files'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

For gitignored paths such as `dist/`, set `force: true`:

```yaml
- uses: goeselt/scribe@v1
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
- uses: goeselt/scribe@v1
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

Scribe uses `github-token` as temporary Git authentication for `git push` and removes the helper before the action
exits. Prefer `persist-credentials: false` in the preceding `actions/checkout` step so checkout credentials do not stay
configured in the local repository.

If Scribe creates a commit but the push fails, it rolls back the local commit before failing the step. The generated
files remain in the workspace for logs or follow-up diagnostics.

On `pull_request` and `pull_request_target` events, Scribe can also create or update one shared PR comment. Pass a token
with `pull-requests: write` permission:

```yaml
permissions:
  contents: write
  pull-requests: write
```

When Scribe runs more than once, every created commit is merged into the same PR comment. The newest commit is listed
first. Scribe keeps the newest 50 commit records in the shared comment. Runs that produce no commit are reported in the
workflow summary only. The hidden comment state is also size-limited, so very large file lists or commit messages are
shortened in the comment history.

When the GitHub API cannot return the authenticated login for the comment token, Scribe only trusts a fallback author
hint that looks like a bot login, such as `github-actions[bot]`. This keeps a custom Git author name from deciding which
existing PR comments may be updated.

## Pull Request Context

On `pull_request` and `pull_request_target` events, check out the pull request head commit before running Scribe and use
a checkout token that can push to the branch:

```yaml
name: Update PR Files

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: write
  pull-requests: write

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false

      - name: Generate files
        run: npm run generate

      - name: Commit generated files
        uses: goeselt/scribe@v1
        with:
          files: generated/
          message: 'chore: update generated files'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

By default, `actions/checkout` may land on a detached merge commit (`refs/pull/N/merge`). Scribe rejects that state
before staging files, because pushing a commit based on the merge ref back to the PR branch can rewrite the branch to an
unexpected history. After verifying that the checkout is the PR head commit, Scribe pushes to
`origin HEAD:refs/heads/<pull_request.head.ref>`.

Scribe only supports this mode for pull requests whose source branch lives in the same repository as the target branch.
Fork pull requests are rejected before files are staged or committed.

> [!NOTE]
>
> Pushing from within a `pull_request` workflow using a GitHub App token or PAT triggers a new
> `pull_request: synchronize` event. Set `skip-ci: true` when Scribe commits generated files that do not need another CI
> run.
>
> Pushing with `GITHUB_TOKEN` does **not** trigger new workflow runs, but `GITHUB_TOKEN` cannot bypass branch protection
> rules.
>
> If Scribe commits changes under `.github/workflows/`, the checkout token may need permission to update workflows (for
> example the `workflow` scope on a PAT).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).

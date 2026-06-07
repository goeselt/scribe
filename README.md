# scribe

GitHub Action that stages files, creates a GPG-signed commit, and pushes to the current branch. Handles the push-vs-PR
context difference automatically.

Scribe writes a GitHub Actions workflow summary for every invocation. On pull request events, it can also maintain one
shared PR comment that lists the commits Scribe added to the PR.

## Usage

```yaml
- name: Commit Release
  uses: goeselt/scribe@v1
  with:
    files: |
      package.json
      package-lock.json
    message: 'chore(version): release v${{ steps.bumpkin.outputs.next-version }} [skip ci]'
    git-user-name: ${{ vars.RELEASE_SIGNING_USER }}
    git-user-email: ${{ vars.RELEASE_SIGNING_EMAIL }}
    signing-key: ${{ secrets.RELEASE_SIGNING_KEY }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

For gitignored paths (e.g. `dist/`), set `force: 'true'`:

```yaml
- uses: goeselt/scribe@v1
  with:
    files: |
      dist/
      package.json
      package-lock.json
    message: 'chore(version): release v${{ steps.bumpkin.outputs.next-version }} [skip ci]'
    git-user-name: ${{ vars.RELEASE_SIGNING_USER }}
    git-user-email: ${{ vars.RELEASE_SIGNING_EMAIL }}
    signing-key: ${{ secrets.RELEASE_SIGNING_KEY }}
    force: 'true'
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

## Inputs

| Input            | Required | Default | Description                                                           |
| ---------------- | -------- | ------- | --------------------------------------------------------------------- |
| `files`          | Yes      | --      | Newline-separated list of files or directories to stage.              |
| `message`        | Yes      | --      | Commit message.                                                       |
| `git-user-name`  | Yes      | --      | Git author name.                                                      |
| `git-user-email` | Yes      | --      | Git author email.                                                     |
| `signing-key`    | No       | `''`    | Base64-encoded GPG signing key. When omitted, commits are unsigned.   |
| `force`          | No       | `false` | Pass `--force` to `git add`. Required for gitignored paths.           |
| `github-token`   | No       | `''`    | Token used to create or update the PR comment on pull_request events. |
| `pr-comment`     | No       | `true`  | Whether to create or update the explanatory PR comment on PR events.  |

## Outputs

| Output      | Description                                                             |
| ----------- | ----------------------------------------------------------------------- |
| `committed` | `true` if a commit was created, `false` if there was nothing to commit. |
| `sha`       | SHA of the new commit. Empty when `committed` is `false`.               |

## Reporting

Scribe appends a workflow summary entry after each invocation, including the result, files, commit SHA, push target,
signing mode, and force-add mode.

On `pull_request` and `pull_request_target` events, Scribe can also create or update one shared PR comment. Pass a token
with `pull-requests: write` permission:

```yaml
permissions:
  contents: write
  pull-requests: write
```

When Scribe runs more than once, every created commit is merged into the same PR comment. The newest commit is listed
first. Runs that produce no commit are reported in the workflow summary only.

## Pull Request Context

On `pull_request` and `pull_request_target` events, `actions/checkout` lands on a detached merge-commit
(`refs/pull/N/merge`). A plain `git push` would fail. The action detects this and pushes to
`origin HEAD:refs/heads/<GITHUB_HEAD_REF>` instead.

> [!WARNING]
>
> Pushing from within a `pull_request` workflow using a GitHub App token or PAT triggers a new
> `pull_request: synchronize` event, which starts a new CI run on the updated commit. Include `[skip ci]` in the commit
> message to suppress this if the pushed content (e.g. auto-generated files) does not require re-validation.
>
> Pushing with `GITHUB_TOKEN` does **not** trigger new workflow runs, but `GITHUB_TOKEN` cannot bypass branch protection
> rules.

## Prerequisites

The calling job must check out with a token that has push access to the branch:

```yaml
- uses: actions/checkout@v6
  with:
    token: ${{ steps.app.outputs.token }} # App token or PAT with push rights
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [LICENSE](LICENSE).

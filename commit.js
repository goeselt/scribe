'use strict'

// parseFiles splits a newline-separated file list from an action input.
// Lines are trimmed; empty lines are dropped.
function parseFiles(input) {
  return String(input ?? '')
    .split(/\r?\n/)
    .map((f) => f.trim())
    .filter(Boolean)
}

// buildAddArgs returns the git-add argument list for the given files.
// --force is required for gitignored paths (e.g. dist/).
function buildAddArgs(files, force) {
  if (force) return ['add', '--force', '--', ...files]
  return ['add', '--', ...files]
}

// resolvePushArgs returns git-push arguments appropriate for the event context.
//
// On pull_request and pull_request_target events, actions/checkout lands on a
// detached merge-commit (refs/pull/N/merge). A plain `git push` would fail
// because that ref is read-only. Push to the actual PR branch head ref instead.
//
// Note: pushing with a GitHub App token or PAT triggers a new pull_request
// workflow run on the PR branch. Include [skip ci] in the commit message to
// suppress redundant CI on the pushed commit.
function resolvePushArgs(eventName, headRef) {
  if ((eventName === 'pull_request' || eventName === 'pull_request_target') && headRef) {
    return ['push', 'origin', `HEAD:refs/heads/${headRef}`]
  }
  return ['push']
}

// resolveCommitMessage optionally appends [skip ci] to prevent pushed commits
// from triggering follow-up workflow runs.
function resolveCommitMessage(message, skipCi) {
  if (!skipCi || message.includes('[skip ci]')) return message
  return `${message} [skip ci]`
}

module.exports = { parseFiles, buildAddArgs, resolvePushArgs, resolveCommitMessage }

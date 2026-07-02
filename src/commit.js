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

// buildCommitArgs disables repository hooks so an earlier workflow step cannot inject code into Scribe's commit
// operation through core.hooksPath.
function buildCommitArgs(message) {
  return ['commit', '--no-verify', '-m', message]
}

// resolvePushArgs returns git-push arguments appropriate for the event context.
//
// On pull_request and pull_request_target events, push to the actual PR branch head ref after the entry point verifies
// that the local checkout is the PR head commit rather than a detached merge commit.
//
// Note: pushing with a GitHub App token or PAT triggers a new pull_request workflow run on the PR branch.
// Include [skip ci] in the commit message to suppress redundant CI on the pushed commit.
function isPREvent(eventName) {
  return eventName === 'pull_request' || eventName === 'pull_request_target'
}

function resolvePushArgs(eventName, headRef, payload = {}) {
  if (isPREvent(eventName)) {
    const repo = payload.repository?.full_name
    const headRepo = payload.pull_request?.head?.repo?.full_name
    const payloadHeadRef = payload.pull_request?.head?.ref

    if (!headRef) throw new Error('GITHUB_HEAD_REF is empty for a pull_request event')
    if (!repo || !headRepo || !payloadHeadRef) {
      throw new Error('pull_request payload is missing repository or head branch information')
    }
    if (headRepo !== repo) {
      throw new Error(
        'Scribe can only push to pull request branches from the same repository; fork pull requests are not supported',
      )
    }
    if (headRef !== payloadHeadRef) {
      throw new Error('GITHUB_HEAD_REF does not match pull_request.head.ref')
    }

    return ['push', 'origin', `HEAD:refs/heads/${payloadHeadRef}`]
  }
  return ['push']
}

function validatePRCheckout(eventName, payload = {}, currentSha = '') {
  if (!isPREvent(eventName)) return

  const headSha = payload.pull_request?.head?.sha
  if (!headSha) throw new Error('pull_request payload is missing head SHA information')
  if (!currentSha) throw new Error('current Git HEAD is empty')
  if (currentSha !== headSha) {
    throw new Error(
      'Scribe must run from the pull request head commit; check out pull_request.head.sha before committing',
    )
  }
}

// resolveCommitMessage optionally appends [skip ci] to prevent pushed commits from triggering follow-up workflow runs.
function resolveCommitMessage(message, skipCi) {
  if (!skipCi || message.includes('[skip ci]')) return message
  return `${message} [skip ci]`
}

module.exports = {
  parseFiles,
  buildAddArgs,
  buildCommitArgs,
  resolvePushArgs,
  validatePRCheckout,
  resolveCommitMessage,
}

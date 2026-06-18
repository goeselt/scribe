'use strict'

const fs = require('node:fs')
const { readInputs } = require('./inputs.js')
const { git, gitPush, hasChanges, validateBranchRef, rollbackCommit, enableSigning } = require('./git.js')
const {
  parseFiles,
  buildAddArgs,
  buildCommitArgs,
  resolvePushArgs,
  validatePRCheckout,
  resolveCommitMessage,
} = require('./commit.js')
const { MARKER, buildComment, buildSummary } = require('./comment.js')
const { upsertComment } = require('./github.js')
const { log, fail, warn, setOutput, setDefaultOutputs, eventPayload } = require('./workflow.js')

function isPREvent(eventName) {
  return eventName === 'pull_request' || eventName === 'pull_request_target'
}

function writeSummary(record) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  if (!summaryFile) {
    log('summary=skipped reason=no-summary-file')
    return
  }
  fs.appendFileSync(summaryFile, `${buildSummary(record)}\n`)
  log('summary=written')
}

async function writePRComment({ eventName, payload, token, postComment, record, authorLoginHint }) {
  if (!isPREvent(eventName)) {
    log('comment=skipped reason=not-pr')
    return
  }
  if (!postComment) {
    log('comment=skipped reason=pr-comment-false')
    return
  }
  if (!token) {
    warn('github-token is empty; skipping PR comment')
    log('comment=skipped reason=no-token')
    return
  }

  const pr = payload.pull_request
  const repo = payload.repository?.full_name
  if (!pr?.number || !repo) {
    warn('pull_request payload or repository.full_name is missing; skipping PR comment')
    log('comment=skipped reason=missing-pr-context')
    return
  }

  try {
    await upsertComment(
      token,
      repo,
      pr.number,
      MARKER,
      (existingBody) => buildComment(existingBody, record),
      undefined,
      authorLoginHint,
    )
    log('comment=updated')
  } catch (err) {
    warn(`could not post PR comment: ${err.message}`)
    log('comment=failed')
  }
}

async function main() {
  let cleanupSigning = () => {}

  const inputs = readInputs()
  const eventName = process.env.GITHUB_EVENT_NAME ?? ''
  const headRef = process.env.GITHUB_HEAD_REF ?? ''
  const repo = process.env.GITHUB_REPOSITORY ?? ''
  const payload = eventPayload()

  setDefaultOutputs()

  log(
    `event=${eventName || '-'} force=${inputs.force} signing=${inputs.signingKey ? 'yes' : 'no'} pr-comment=${inputs.postComment} skip-ci=${inputs.skipCi}`,
  )

  try {
    const files = parseFiles(inputs.filesInput)
    if (files.length === 0) throw new Error('files input is empty or contains no valid entries')
    if (!inputs.message.trim()) throw new Error('message input is empty')

    const pushArgs = resolvePushArgs(eventName, headRef, payload)
    if (isPREvent(eventName)) validateBranchRef(payload.pull_request.head.ref)
    validatePRCheckout(eventName, payload, git(['rev-parse', 'HEAD']).trim())

    git(['config', 'user.name', inputs.userName])
    git(['config', 'user.email', inputs.userEmail])
    log(`identity: ${inputs.userName} <${inputs.userEmail}>`)

    if (inputs.signingKey) {
      cleanupSigning = enableSigning(inputs.signingKey)
      log('gpg: key imported, commit signing enabled')
    }

    git(buildAddArgs(files, inputs.force))
    log(`staged: ${files.join(' ')}`)

    if (!hasChanges()) {
      log('no staged changes -- skipping commit')
      writeSummary({
        committed: false,
        sha: '',
        files,
        message: inputs.message,
        push: '--',
        signing: Boolean(inputs.signingKey),
        force: inputs.force,
      })
      log('result=done committed=false')
      return
    }

    const commitMessage = resolveCommitMessage(inputs.message, inputs.skipCi)
    git(buildCommitArgs(commitMessage))
    const sha = git(['rev-parse', 'HEAD']).trim()
    log(`committed: ${sha}`)

    try {
      gitPush(pushArgs, inputs.token)
    } catch (err) {
      try {
        rollbackCommit(sha, warn, log)
      } catch (rollbackErr) {
        warn(`could not roll back local commit ${sha}: ${rollbackErr.message}`)
      }
      throw err
    }
    log(`pushed (${pushArgs.join(' ')})`)

    setOutput('committed', 'true')
    setOutput('sha', sha)
    const record = {
      committed: true,
      sha,
      repo,
      committedAt: git(['show', '-s', '--format=%cI', sha]).trim(),
      files,
      message: commitMessage,
      push: pushArgs.join(' '),
      signing: Boolean(inputs.signingKey),
      force: inputs.force,
    }
    writeSummary(record)
    await writePRComment({
      eventName,
      payload,
      token: inputs.token,
      postComment: inputs.postComment,
      record,
      authorLoginHint: inputs.userName,
    })
    log(`result=done committed=true sha=${sha}`)
  } finally {
    cleanupSigning()
  }
}

if (require.main === module) {
  main().catch((err) => {
    fail(err.message)
    process.exit(1)
  })
}

module.exports = { main, writePRComment, writeSummary }

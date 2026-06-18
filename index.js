'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { parseFiles, buildAddArgs, resolvePushArgs, validatePRCheckout, resolveCommitMessage } = require('./commit.js')
const { MARKER, buildComment, buildSummary } = require('./comment.js')
const { upsertComment } = require('./github.js')

const DEFAULT_GIT_USER_NAME = 'github-actions[bot]'
const DEFAULT_GIT_USER_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'

function log(message) {
  process.stdout.write(`[scribe] ${escapeWorkflowCommandValue(message)}\n`)
}

function escapeWorkflowCommandValue(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}

function fail(message) {
  process.stdout.write(`::error title=Scribe::${escapeWorkflowCommandValue(message)}\n`)
}

function warn(message) {
  process.stdout.write(`::warning title=Scribe::${escapeWorkflowCommandValue(message)}\n`)
}

function input(name) {
  return process.env[`INPUT_${name}`] ?? ''
}

function boolInput(name, fallback) {
  const raw = input(name).trim().toLowerCase() || (fallback ? 'true' : 'false')
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name} must be "true" or "false", got ${JSON.stringify(raw)}`)
}

function resolveGitIdentity(userName, userEmail) {
  return {
    userName: String(userName ?? '').trim() || DEFAULT_GIT_USER_NAME,
    userEmail: String(userEmail ?? '').trim() || DEFAULT_GIT_USER_EMAIL,
  }
}

function setOutput(name, value) {
  const outputFile = process.env['GITHUB_OUTPUT']
  if (!outputFile) return
  fs.appendFileSync(outputFile, `${name}=${value}\n`)
}

function eventPayload() {
  const eventPath = process.env['GITHUB_EVENT_PATH']
  if (!eventPath) return {}
  return JSON.parse(fs.readFileSync(eventPath, 'utf8'))
}

function isPREvent(eventName) {
  return eventName === 'pull_request' || eventName === 'pull_request_target'
}

function writeSummary(record) {
  const summaryFile = process.env['GITHUB_STEP_SUMMARY']
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

function gitFailureHint(args) {
  const command = args[0]
  if (command === 'add') {
    return 'Check that every files entry exists in the checkout. Use force: true for gitignored paths.'
  }
  if (command === 'commit') {
    return 'Check the Git identity and signing-key inputs. If signing is enabled, make sure the secret contains a valid base64-encoded private key.'
  }
  if (command === 'push') {
    return 'Check that actions/checkout used a token with push access and that branch protection allows this commit.'
  }
  if (command === 'rev-parse') {
    return 'Run actions/checkout before Scribe so the workspace contains a Git checkout.'
  }
  return ''
}

function formatGitError(args, err) {
  const status = typeof err?.status === 'number' ? ` (exit ${err.status})` : ''
  const stderr = (err?.stderr ?? Buffer.alloc(0)).toString('utf8').trim()
  const stdout = (err?.stdout ?? Buffer.alloc(0)).toString('utf8').trim()
  const details = stderr || stdout
  const hint = gitFailureHint(args)
  return [
    `git ${args.join(' ')} failed${status}.`,
    details ? `Git said: ${details}` : '',
    hint ? `Hint: ${hint}` : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' })
  } catch (err) {
    throw new Error(formatGitError(args, err))
  }
}

function createTemporaryGnupgHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-gnupg-'))
  fs.chmodSync(dir, 0o700)
  return dir
}

function removeTemporaryGnupgHome(dir) {
  if (!dir) return
  fs.rmSync(dir, { recursive: true, force: true })
}

function importKey(base64Key, gnupgHome, _spawnSync = spawnSync) {
  const keyBuffer = Buffer.from(base64Key, 'base64')
  const result = _spawnSync('gpg', ['--batch', '--import'], {
    input: keyBuffer,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GNUPGHOME: gnupgHome },
  })
  if (result.status !== 0) {
    const stderr = (result.stderr ?? Buffer.alloc(0)).toString('utf8')
    throw new Error(`gpg --import failed (exit ${result.status}): ${stderr.trim()}`)
  }
}

function enableSigning(base64Key) {
  const previousGnupgHome = process.env.GNUPGHOME
  const gnupgHome = createTemporaryGnupgHome()
  process.env.GNUPGHOME = gnupgHome

  try {
    importKey(base64Key, gnupgHome)
    git(['config', 'commit.gpgsign', 'true'])
  } catch (err) {
    if (previousGnupgHome === undefined) delete process.env.GNUPGHOME
    else process.env.GNUPGHOME = previousGnupgHome
    removeTemporaryGnupgHome(gnupgHome)
    throw err
  }

  return () => {
    if (previousGnupgHome === undefined) delete process.env.GNUPGHOME
    else process.env.GNUPGHOME = previousGnupgHome
    removeTemporaryGnupgHome(gnupgHome)
  }
}

function hasChanges() {
  const args = ['diff', '--staged', '--quiet']
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status === 0) return false
  if (result.status === 1) return true
  throw new Error(formatGitError(args, result))
}

function rollbackCommit(sha) {
  const current = git(['rev-parse', 'HEAD']).trim()
  if (current !== sha) {
    warn(`could not roll back local commit ${sha}: HEAD moved to ${current}`)
    return
  }
  git(['reset', '--mixed', 'HEAD~1'])
  log(`rolled back local commit: ${sha}`)
}

async function main() {
  let cleanupSigning = () => {}

  const filesInput = input('FILES')
  const message = input('MESSAGE')
  const { userName, userEmail } = resolveGitIdentity(input('GIT-USER-NAME'), input('GIT-USER-EMAIL'))
  const signingKey = input('SIGNING-KEY')
  const force = boolInput('FORCE', false)
  const token = input('GITHUB-TOKEN')
  const postComment = boolInput('PR-COMMENT', true)
  const skipCi = boolInput('SKIP-CI', true)

  const eventName = process.env['GITHUB_EVENT_NAME'] ?? ''
  const headRef = process.env['GITHUB_HEAD_REF'] ?? ''
  const repo = process.env['GITHUB_REPOSITORY'] ?? ''
  const payload = eventPayload()

  log(
    `event=${eventName || '-'} force=${force} signing=${signingKey ? 'yes' : 'no'} pr-comment=${postComment} skip-ci=${skipCi}`,
  )

  try {
    const files = parseFiles(filesInput)
    if (files.length === 0) throw new Error('files input is empty or contains no valid entries')
    if (!message.trim()) throw new Error('message input is empty')
    const pushArgs = resolvePushArgs(eventName, headRef, payload)
    validatePRCheckout(eventName, payload, git(['rev-parse', 'HEAD']).trim())

    git(['config', 'user.name', userName])
    git(['config', 'user.email', userEmail])
    log(`identity: ${userName} <${userEmail}>`)

    if (signingKey) {
      cleanupSigning = enableSigning(signingKey)
      log('gpg: key imported, commit signing enabled')
    }

    git(buildAddArgs(files, force))
    log(`staged: ${files.join(' ')}`)

    if (!hasChanges()) {
      log('no staged changes -- skipping commit')
      setOutput('committed', 'false')
      setOutput('sha', '')
      const record = {
        committed: false,
        sha: '',
        files,
        message,
        push: '--',
        signing: Boolean(signingKey),
        force,
      }
      writeSummary(record)
      log('result=done committed=false')
      return
    }

    const commitMessage = resolveCommitMessage(message, skipCi)
    git(['commit', '-m', commitMessage])
    const sha = git(['rev-parse', 'HEAD']).trim()
    log(`committed: ${sha}`)

    try {
      git(pushArgs)
    } catch (err) {
      try {
        rollbackCommit(sha)
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
      signing: Boolean(signingKey),
      force,
    }
    writeSummary(record)
    await writePRComment({ eventName, payload, token, postComment, record, authorLoginHint: userName })
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

module.exports = {
  escapeWorkflowCommandValue,
  fail,
  warn,
  log,
  boolInput,
  resolveGitIdentity,
  formatGitError,
  createTemporaryGnupgHome,
  removeTemporaryGnupgHome,
  importKey,
  main,
}

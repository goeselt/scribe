'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { withGitHubToken } = require('./github-auth.js')

function redactText(text) {
  return String(text ?? '')
    .replace(/\bhttps?:\/\/[^/\s:@]+:[^/\s@]+@/gi, (match) => match.replace(/\/\/.*@/, '//***@'))
    .replace(/\bx-access-token:[^@\s]+@/gi, 'x-access-token:***@')
    .replace(/\bAUTHORIZATION:\s*(?:basic|bearer)\s+[A-Za-z0-9._~+/=-]+/gi, 'AUTHORIZATION: ***')
    .replace(/\b(x-access-token|access_token|client_secret)=([^&\s]+)/gi, '$1=***')
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
    return 'Check that github-token has push access and that branch protection allows this commit.'
  }
  if (command === 'rev-parse') {
    return 'Run actions/checkout before Scribe so the workspace contains a Git checkout.'
  }
  if (command === 'check-ref-format') {
    return 'Use a valid branch name for the pull request head ref.'
  }
  if (args.join(' ').includes('safe.directory') || command === 'diff') {
    return 'If Git reports dubious ownership on a self-hosted runner, add the checkout path to safe.directory.'
  }
  return ''
}

function formatGitError(args, err) {
  const status = typeof err?.status === 'number' ? ` (exit ${err.status})` : ''
  const stderr = redactText((err?.stderr ?? Buffer.alloc(0)).toString('utf8')).trim()
  const stdout = redactText((err?.stdout ?? Buffer.alloc(0)).toString('utf8')).trim()
  const details = stderr || stdout
  const hint = gitFailureHint(args)
  return [`git ${args.join(' ')} failed${status}.`, details ? `Git said: ${details}` : '', hint ? `Hint: ${hint}` : '']
    .filter(Boolean)
    .join(' ')
}

function git(args, options = {}) {
  try {
    return execFileSync('git', args, { encoding: 'utf8', ...options })
  } catch (err) {
    throw new Error(formatGitError(args, err), { cause: err })
  }
}

function gitPush(args, token, _git = git) {
  return withGitHubToken(
    (_name, gitArgs, options) => _git(gitArgs, options),
    token,
    (exec) => exec('git', args),
  )
}

function hasChanges() {
  const args = ['diff', '--staged', '--quiet']
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status === 0) return false
  if (result.status === 1) return true
  throw new Error(formatGitError(args, result))
}

function validateBranchRef(ref) {
  const args = ['check-ref-format', '--branch', ref]
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status === 0) return
  throw new Error(formatGitError(args, result))
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

// readGitConfig returns the repository-local value for key, or null when the key is unset locally.
// Scoped to --local because that is the scope Scribe writes to; reading merged config would copy a global
// value into the repository config on restore.
function readGitConfig(key, _spawnSync = spawnSync) {
  const args = ['config', '--local', '--get', key]
  const result = _spawnSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status === 0) return String(result.stdout ?? '').trim()
  return null
}

// restoreGitConfig writes back a value captured with readGitConfig, unsetting the key when it was null.
// Best-effort: cleanup runs in a finally block and must not mask the original error.
function restoreGitConfig(key, previousValue, _spawnSync = spawnSync) {
  const args =
    previousValue === null ? ['config', '--local', '--unset', key] : ['config', '--local', key, previousValue]
  _spawnSync('git', args, { stdio: 'ignore' })
}

function enableSigning(base64Key) {
  const previousGnupgHome = process.env.GNUPGHOME
  const previousGpgsign = readGitConfig('commit.gpgsign')
  const gnupgHome = createTemporaryGnupgHome()
  process.env.GNUPGHOME = gnupgHome

  const cleanup = () => {
    restoreGnupgHome(previousGnupgHome)
    // The imported key is removed with the temporary GNUPGHOME; leaving commit.gpgsign=true behind would make
    // every later git commit in the job fail to sign.
    restoreGitConfig('commit.gpgsign', previousGpgsign)
    removeTemporaryGnupgHome(gnupgHome)
  }

  try {
    importKey(base64Key, gnupgHome)
    git(['config', 'commit.gpgsign', 'true'])
  } catch (err) {
    cleanup()
    throw err
  }

  return cleanup
}

function restoreGnupgHome(previousGnupgHome) {
  if (previousGnupgHome === undefined) delete process.env.GNUPGHOME
  else process.env.GNUPGHOME = previousGnupgHome
}

function rollbackCommit(sha, warn, log) {
  const current = git(['rev-parse', 'HEAD']).trim()
  if (current !== sha) {
    warn(`could not roll back local commit ${sha}: HEAD moved to ${current}`)
    return
  }
  git(['reset', '--mixed', 'HEAD~1'])
  log(`rolled back local commit: ${sha}`)
}

module.exports = {
  git,
  gitPush,
  hasChanges,
  validateBranchRef,
  rollbackCommit,
  redactText,
  formatGitError,
  createTemporaryGnupgHome,
  removeTemporaryGnupgHome,
  importKey,
  readGitConfig,
  restoreGitConfig,
  enableSigning,
}

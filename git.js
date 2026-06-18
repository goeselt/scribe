'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')

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

function hasChanges() {
  const args = ['diff', '--staged', '--quiet']
  const result = spawnSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
  if (result.status === 0) return false
  if (result.status === 1) return true
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

function enableSigning(base64Key) {
  const previousGnupgHome = process.env.GNUPGHOME
  const gnupgHome = createTemporaryGnupgHome()
  process.env.GNUPGHOME = gnupgHome

  try {
    importKey(base64Key, gnupgHome)
    git(['config', 'commit.gpgsign', 'true'])
  } catch (err) {
    restoreGnupgHome(previousGnupgHome)
    removeTemporaryGnupgHome(gnupgHome)
    throw err
  }

  return () => {
    restoreGnupgHome(previousGnupgHome)
    removeTemporaryGnupgHome(gnupgHome)
  }
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
  hasChanges,
  rollbackCommit,
  formatGitError,
  createTemporaryGnupgHome,
  removeTemporaryGnupgHome,
  importKey,
  enableSigning,
}

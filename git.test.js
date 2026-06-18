'use strict'

const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
  gitPush,
  validateBranchRef,
  redactText,
  formatGitError,
  createTemporaryGnupgHome,
  removeTemporaryGnupgHome,
  importKey,
  withTemporaryGitHubToken,
} = require('./git.js')

test('formatGitError includes command output and an action-oriented push hint', () => {
  const message = formatGitError(['push'], {
    status: 128,
    stderr: Buffer.from('remote: permission denied', 'utf8'),
  })

  assert.match(message, /git push failed \(exit 128\)/)
  assert.match(message, /Git said: remote: permission denied/)
  assert.match(message, /github-token has push access/)
})

test('formatGitError includes a checkout hint for rev-parse failures', () => {
  const message = formatGitError(['rev-parse', 'HEAD'], {
    status: 128,
    stderr: Buffer.from('fatal: not a git repository', 'utf8'),
  })

  assert.match(message, /Run actions\/checkout before Scribe/)
})

test('redactText removes credentials from Git output', () => {
  const text = [
    'remote: https://x-access-token:ghs_secret123@github.com/owner/repo.git',
    'fatal: x-access-token:ghp_baresecret@github.com:owner/repo.git',
    'AUTHORIZATION: basic abc123+/=',
    'https://github.com/owner/repo?access_token=secret&x=1',
  ].join('\n')

  const redacted = redactText(text)

  assert.ok(!redacted.includes('ghs_secret123'))
  assert.ok(!redacted.includes('ghp_baresecret'))
  assert.ok(!redacted.includes('abc123'))
  assert.ok(!redacted.includes('access_token=secret'))
  assert.ok(redacted.includes('https://***@github.com/owner/repo.git'))
  assert.ok(redacted.includes('x-access-token:***@github.com:owner/repo.git'))
  assert.ok(redacted.includes('AUTHORIZATION: ***'))
  assert.ok(redacted.includes('access_token=***'))
})

test('formatGitError redacts secrets from command output', () => {
  const message = formatGitError(['push'], {
    status: 128,
    stderr: Buffer.from('fatal: https://user:token123@example.com/owner/repo.git failed', 'utf8'),
  })

  assert.ok(!message.includes('token123'))
  assert.ok(message.includes('https://***@example.com/owner/repo.git'))
})

test('withTemporaryGitHubToken provides askpass credentials and removes them afterwards', () => {
  let askpass = ''
  const result = withTemporaryGitHubToken('ghs_secret', ({ env }) => {
    askpass = env.GIT_ASKPASS
    assert.equal(env.GIT_TERMINAL_PROMPT, '0')
    assert.equal(env.SCRIBE_GITHUB_TOKEN, 'ghs_secret')
    assert.equal(fs.statSync(askpass).mode & 0o777, 0o700)
    assert.equal(fs.readFileSync(askpass, 'utf8').includes('ghs_secret'), false)
    assert.equal(
      execFileSync(askpass, ['Username for https://github.com'], { encoding: 'utf8', env }).trim(),
      'x-access-token',
    )
    assert.equal(
      execFileSync(askpass, ['Password for https://github.com'], { encoding: 'utf8', env }).trim(),
      'ghs_secret',
    )
    return 'ok'
  })

  assert.equal(result, 'ok')
  assert.equal(fs.existsSync(askpass), false)
})

test('gitPush uses temporary token environment only for the push command', () => {
  const calls = []

  gitPush(['push'], 'ghs_secret', (args, options) => {
    calls.push({ args, options })
    return ''
  })

  assert.deepEqual(calls[0].args, ['push'])
  assert.equal(calls[0].options.env.SCRIBE_GITHUB_TOKEN, 'ghs_secret')
  assert.match(calls[0].options.env.GIT_ASKPASS, /scribe-askpass-/)
  assert.equal(fs.existsSync(calls[0].options.env.GIT_ASKPASS), false)
})

test('gitPush falls back to existing Git credentials when no token is provided', () => {
  const calls = []

  gitPush(['push'], '', (args, options) => {
    calls.push({ args, options })
    return ''
  })

  assert.deepEqual(calls, [{ args: ['push'], options: {} }])
})

test('validateBranchRef accepts a normal branch name', () => {
  assert.doesNotThrow(() => validateBranchRef('feature/scribe-hardening'))
})

test('validateBranchRef rejects an invalid branch name', () => {
  assert.throws(() => validateBranchRef('bad..branch'), /git check-ref-format --branch bad\.\.branch failed/)
})

test('createTemporaryGnupgHome creates a private directory that can be removed', () => {
  const dir = createTemporaryGnupgHome()

  try {
    assert.equal(fs.statSync(dir).mode & 0o777, 0o700)
  } finally {
    removeTemporaryGnupgHome(dir)
  }

  assert.equal(fs.existsSync(dir), false)
})

test('importKey imports into the provided temporary GPG home', () => {
  const key = Buffer.from('fake-private-key', 'utf8').toString('base64')
  const calls = []

  importKey(key, '/tmp/scribe-gnupg-test', (cmd, args, options) => {
    calls.push({ cmd, args, options })
    return { status: 0, stderr: Buffer.alloc(0) }
  })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, 'gpg')
  assert.deepEqual(calls[0].args, ['--batch', '--import'])
  assert.equal(calls[0].options.env.GNUPGHOME, '/tmp/scribe-gnupg-test')
  assert.equal(calls[0].options.input.toString('utf8'), 'fake-private-key')
})

test('importKey reports GPG import failures', () => {
  assert.throws(
    () =>
      importKey('ZmFrZQ==', '/tmp/scribe-gnupg-test', () => ({
        status: 2,
        stderr: Buffer.from('bad key', 'utf8'),
      })),
    /gpg --import failed \(exit 2\): bad key/,
  )
})

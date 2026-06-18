'use strict'

const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const {
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
} = require('./index.js')

test('escapeWorkflowCommandValue escapes workflow command control characters', () => {
  assert.equal(escapeWorkflowCommandValue('line 1%25\r\nline 2'), 'line 1%2525%0D%0Aline 2')
})

test('fail escapes annotation text', () => {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }

  try {
    fail('bad%thing\nnext')
  } finally {
    process.stdout.write = originalWrite
  }

  assert.equal(chunks.join(''), '::error title=Scribe::bad%25thing%0Anext\n')
})

test('warn escapes annotation text', () => {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }

  try {
    warn('careful\rnow')
  } finally {
    process.stdout.write = originalWrite
  }

  assert.equal(chunks.join(''), '::warning title=Scribe::careful%0Dnow\n')
})

test('log escapes workflow command control characters', () => {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }

  try {
    log('alice\n::warning title=pwned::hi')
  } finally {
    process.stdout.write = originalWrite
  }

  assert.equal(chunks.join(''), '[scribe] alice%0A::warning title=pwned::hi\n')
})

test('boolInput returns true for "true" input', () => {
  process.env['INPUT_TEST-BOOL'] = 'true'
  try {
    assert.equal(boolInput('TEST-BOOL', false), true)
  } finally {
    delete process.env['INPUT_TEST-BOOL']
  }
})

test('boolInput returns false for "false" input', () => {
  process.env['INPUT_TEST-BOOL'] = 'false'
  try {
    assert.equal(boolInput('TEST-BOOL', true), false)
  } finally {
    delete process.env['INPUT_TEST-BOOL']
  }
})

test('boolInput is case-insensitive and trims surrounding whitespace', () => {
  process.env['INPUT_TEST-BOOL'] = '  TRUE  '
  try {
    assert.equal(boolInput('TEST-BOOL', false), true)
  } finally {
    delete process.env['INPUT_TEST-BOOL']
  }
})

test('boolInput uses the fallback value when input is absent', () => {
  delete process.env['INPUT_TEST-BOOL']
  assert.equal(boolInput('TEST-BOOL', true), true)
  assert.equal(boolInput('TEST-BOOL', false), false)
})

test('boolInput throws for values other than true or false', () => {
  process.env['INPUT_TEST-BOOL'] = 'yes'
  try {
    assert.throws(() => boolInput('TEST-BOOL', false), /must be "true" or "false"/)
  } finally {
    delete process.env['INPUT_TEST-BOOL']
  }
})

test('resolveGitIdentity uses the github-actions bot by default', () => {
  assert.deepEqual(resolveGitIdentity('', '  '), {
    userName: 'github-actions[bot]',
    userEmail: '41898282+github-actions[bot]@users.noreply.github.com',
  })
})

test('resolveGitIdentity preserves explicit identity inputs after trimming', () => {
  assert.deepEqual(resolveGitIdentity('  release-bot  ', '  release@example.com  '), {
    userName: 'release-bot',
    userEmail: 'release@example.com',
  })
})

test('formatGitError includes command output and an action-oriented push hint', () => {
  const message = formatGitError(['push'], {
    status: 128,
    stderr: Buffer.from('remote: permission denied', 'utf8'),
  })

  assert.match(message, /git push failed \(exit 128\)/)
  assert.match(message, /Git said: remote: permission denied/)
  assert.match(message, /actions\/checkout used a token with push access/)
})

test('formatGitError includes a checkout hint for rev-parse failures', () => {
  const message = formatGitError(['rev-parse', 'HEAD'], {
    status: 128,
    stderr: Buffer.from('fatal: not a git repository', 'utf8'),
  })

  assert.match(message, /Run actions\/checkout before Scribe/)
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

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  parseFiles,
  buildAddArgs,
  buildCommitArgs,
  resolvePushArgs,
  validatePRCheckout,
  resolveCommitMessage,
} = require('./commit.js')

const sameRepoPRPayload = {
  repository: { full_name: 'owner/repo' },
  pull_request: { head: { ref: 'feature-branch', sha: 'abc123', repo: { full_name: 'owner/repo' } } },
}

test('parseFiles splits a newline-separated file list', () => {
  assert.deepEqual(parseFiles('package.json\npackage-lock.json\n'), ['package.json', 'package-lock.json'])
})

test('parseFiles trims whitespace and drops empty lines', () => {
  assert.deepEqual(parseFiles('  a.txt  \n\n  b.txt  '), ['a.txt', 'b.txt'])
})

test('parseFiles handles a single file without a trailing newline', () => {
  assert.deepEqual(parseFiles('action.yml'), ['action.yml'])
})

test('parseFiles returns an empty array for empty input', () => {
  assert.deepEqual(parseFiles(''), [])
  assert.deepEqual(parseFiles(null), [])
  assert.deepEqual(parseFiles(), [])
})

test('parseFiles handles CRLF line endings', () => {
  assert.deepEqual(parseFiles('a.txt\r\nb.txt'), ['a.txt', 'b.txt'])
})

test('buildAddArgs produces git add args without --force', () => {
  assert.deepEqual(buildAddArgs(['package.json', 'package-lock.json'], false), [
    'add',
    '--',
    'package.json',
    'package-lock.json',
  ])
})

test('buildAddArgs produces git add --force args for gitignored paths', () => {
  assert.deepEqual(buildAddArgs(['dist/', 'package.json'], true), ['add', '--force', '--', 'dist/', 'package.json'])
})

test('buildAddArgs uses -- separator to prevent files from being parsed as flags', () => {
  const args = buildAddArgs(['-strange-filename'], false)
  assert.equal(args[args.indexOf('-strange-filename') - 1], '--')
})

test('buildCommitArgs disables repository hooks', () => {
  assert.deepEqual(buildCommitArgs('chore: update'), ['commit', '--no-verify', '-m', 'chore: update'])
})

test('resolvePushArgs returns plain push on push events', () => {
  assert.deepEqual(resolvePushArgs('push', ''), ['push'])
})

test('resolvePushArgs returns plain push on workflow_dispatch', () => {
  assert.deepEqual(resolvePushArgs('workflow_dispatch', ''), ['push'])
})

test('resolvePushArgs pushes to the PR branch head ref on pull_request', () => {
  assert.deepEqual(resolvePushArgs('pull_request', 'feature-branch', sameRepoPRPayload), [
    'push',
    'origin',
    'HEAD:refs/heads/feature-branch',
  ])
})

test('resolvePushArgs pushes to the PR branch head ref on pull_request_target', () => {
  assert.deepEqual(
    resolvePushArgs('pull_request_target', 'fix/something', {
      repository: { full_name: 'owner/repo' },
      pull_request: { head: { ref: 'fix/something', sha: 'abc123', repo: { full_name: 'owner/repo' } } },
    }),
    ['push', 'origin', 'HEAD:refs/heads/fix/something'],
  )
})

test('resolvePushArgs fails when GITHUB_HEAD_REF differs from the payload head ref', () => {
  assert.throws(
    () => resolvePushArgs('pull_request', 'different-branch', sameRepoPRPayload),
    /GITHUB_HEAD_REF does not match pull_request.head.ref/,
  )
})

test('resolvePushArgs uses the payload head ref as the push target', () => {
  assert.deepEqual(resolvePushArgs('pull_request', 'feature-branch', sameRepoPRPayload), [
    'push',
    'origin',
    'HEAD:refs/heads/feature-branch',
  ])
})

test('resolvePushArgs fails when headRef is empty in a PR context', () => {
  assert.throws(
    () => resolvePushArgs('pull_request', '', sameRepoPRPayload),
    /GITHUB_HEAD_REF is empty for a pull_request event/,
  )
})

test('resolvePushArgs fails when pull_request payload is incomplete', () => {
  assert.throws(
    () => resolvePushArgs('pull_request', 'feature-branch', {}),
    /pull_request payload is missing repository or head branch information/,
  )
})

test('resolvePushArgs rejects fork pull requests', () => {
  assert.throws(
    () =>
      resolvePushArgs('pull_request', 'feature-branch', {
        repository: { full_name: 'owner/repo' },
        pull_request: { head: { ref: 'feature-branch', sha: 'abc123', repo: { full_name: 'contributor/repo' } } },
      }),
    /fork pull requests are not supported/,
  )
})

test('validatePRCheckout accepts the pull request head SHA', () => {
  assert.doesNotThrow(() => validatePRCheckout('pull_request', sameRepoPRPayload, 'abc123'))
})

test('validatePRCheckout ignores non-PR events', () => {
  assert.doesNotThrow(() => validatePRCheckout('push', {}, 'anything'))
})

test('validatePRCheckout rejects a checkout that is not the pull request head', () => {
  assert.throws(
    () => validatePRCheckout('pull_request_target', sameRepoPRPayload, 'merge123'),
    /must run from the pull request head commit/,
  )
})

test('validatePRCheckout fails when the payload is missing the head SHA', () => {
  assert.throws(
    () =>
      validatePRCheckout(
        'pull_request',
        { repository: { full_name: 'owner/repo' }, pull_request: { head: { ref: 'feature-branch' } } },
        'abc123',
      ),
    /missing head SHA/,
  )
})

test('resolveCommitMessage preserves the message when skip-ci is false', () => {
  assert.equal(resolveCommitMessage('chore: release v1.0.0', false), 'chore: release v1.0.0')
})

test('resolveCommitMessage appends [skip ci] when enabled and absent', () => {
  assert.equal(resolveCommitMessage('chore: release v1.0.0', true), 'chore: release v1.0.0 [skip ci]')
})

test('resolveCommitMessage does not duplicate [skip ci] when already present', () => {
  assert.equal(resolveCommitMessage('chore: release v1.0.0 [skip ci]', true), 'chore: release v1.0.0 [skip ci]')
})

test('resolveCommitMessage preserves [skip ci] anywhere in the message', () => {
  assert.equal(resolveCommitMessage('[skip ci] chore: release', true), '[skip ci] chore: release')
})

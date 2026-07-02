'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { boolInput, resolveGitIdentity, readInputs } = require('./inputs.js')

test('boolInput returns true for "true" input', () => {
  assert.equal(boolInput('TEST-BOOL', false, { 'INPUT_TEST-BOOL': 'true' }), true)
})

test('boolInput returns false for "false" input', () => {
  assert.equal(boolInput('TEST-BOOL', true, { 'INPUT_TEST-BOOL': 'false' }), false)
})

test('boolInput is case-insensitive and trims surrounding whitespace', () => {
  assert.equal(boolInput('TEST-BOOL', false, { 'INPUT_TEST-BOOL': '  TRUE  ' }), true)
})

test('boolInput uses the fallback value when input is absent', () => {
  assert.equal(boolInput('TEST-BOOL', true, {}), true)
  assert.equal(boolInput('TEST-BOOL', false, {}), false)
})

test('boolInput throws for values other than true or false', () => {
  assert.throws(() => boolInput('TEST-BOOL', false, { 'INPUT_TEST-BOOL': 'yes' }), /must be "true" or "false"/)
})

test('boolInput reports the action input name in workflow casing', () => {
  assert.throws(() => boolInput('PR-COMMENT', true, { 'INPUT_PR-COMMENT': 'yes' }), /^Error: pr-comment must be/)
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

test('resolveGitIdentity rejects identity values that would parse as git options', () => {
  assert.throws(() => resolveGitIdentity('--global', 'release@example.com'), /git-user-name must not start with "-"/)
  assert.throws(() => resolveGitIdentity('release-bot', '--file=/tmp/evil'), /git-user-email must not start with "-"/)
})

test('readInputs returns normalized action inputs', () => {
  assert.deepEqual(
    readInputs({
      INPUT_FILES: 'dist/',
      INPUT_MESSAGE: 'chore: update dist',
      'INPUT_GIT-USER-NAME': ' release-bot ',
      'INPUT_GIT-USER-EMAIL': ' release@example.com ',
      'INPUT_SIGNING-KEY': 'abc123',
      INPUT_FORCE: 'true',
      'INPUT_GITHUB-TOKEN': 'token',
      'INPUT_PR-COMMENT': 'false',
      'INPUT_SKIP-CI': 'false',
    }),
    {
      filesInput: 'dist/',
      message: 'chore: update dist',
      userName: 'release-bot',
      userEmail: 'release@example.com',
      signingKey: 'abc123',
      force: true,
      token: 'token',
      postComment: false,
      skipCi: false,
    },
  )
})

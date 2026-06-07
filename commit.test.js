'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseFiles, buildAddArgs, resolvePushArgs } = require('./commit.js')

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

test('resolvePushArgs returns plain push on push events', () => {
  assert.deepEqual(resolvePushArgs('push', ''), ['push'])
})

test('resolvePushArgs returns plain push on workflow_dispatch', () => {
  assert.deepEqual(resolvePushArgs('workflow_dispatch', ''), ['push'])
})

test('resolvePushArgs pushes to the PR branch head ref on pull_request', () => {
  assert.deepEqual(resolvePushArgs('pull_request', 'feature-branch'), [
    'push',
    'origin',
    'HEAD:refs/heads/feature-branch',
  ])
})

test('resolvePushArgs pushes to the PR branch head ref on pull_request_target', () => {
  assert.deepEqual(resolvePushArgs('pull_request_target', 'fix/something'), [
    'push',
    'origin',
    'HEAD:refs/heads/fix/something',
  ])
})

test('resolvePushArgs falls back to plain push when headRef is empty in a PR context', () => {
  // GITHUB_HEAD_REF is always set in practice; empty is a misconfiguration.
  // Fall back gracefully -- the push will fail on detached HEAD, which surfaces the misconfiguration.
  assert.deepEqual(resolvePushArgs('pull_request', ''), ['push'])
})

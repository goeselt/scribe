'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { MARKER, buildComment, buildSummary, parseRecords, upsertRecord } = require('./comment.js')

const versionRecord = {
  committed: true,
  sha: '1234567890abcdef',
  repo: 'owner/repo',
  committedAt: '2026-06-07T12:00:00+00:00',
  files: ['package.json', 'package-lock.json'],
  message: 'chore(version): release v1.2.3 [skip ci]',
  push: 'push origin HEAD:refs/heads/feature',
  signing: true,
  force: false,
}

const distRecord = {
  committed: true,
  sha: 'abcdef1234567890',
  repo: 'owner/repo',
  committedAt: '2026-06-07T12:05:00+00:00',
  files: ['dist/'],
  message: 'chore(dist): update bundle [skip ci]',
  push: 'push origin HEAD:refs/heads/feature',
  signing: false,
  force: true,
}

const skippedRecord = {
  committed: false,
  sha: '',
  files: ['dist/'],
  message: 'chore(dist): update bundle [skip ci]',
  push: '--',
  signing: false,
  force: true,
}

test('buildComment includes the stable marker', () => {
  assert.ok(buildComment('', versionRecord).includes(MARKER))
})

test('buildComment preserves existing rows and lists newest commits first', () => {
  const first = buildComment('', versionRecord)
  const second = buildComment(first, distRecord)

  assert.deepEqual(
    parseRecords(second).map((r) => r.sha),
    ['abcdef1234567890', '1234567890abcdef'],
  )
  assert.ok(second.indexOf('abcdef1') < second.indexOf('1234567'))
})

test('buildComment updates an existing commit in place', () => {
  const first = buildComment('', versionRecord)
  const updated = buildComment(first, { ...versionRecord, files: ['package.json'] })
  const records = parseRecords(updated)

  assert.equal(records.length, 1)
  assert.equal(records[0].sha, '1234567890abcdef')
  assert.deepEqual(records[0].files, ['package.json'])
})

test('upsertRecord uses commit SHA as key', () => {
  const records = upsertRecord(upsertRecord([], versionRecord), distRecord)
  const updated = upsertRecord(records, { ...versionRecord, message: 'updated message' })

  assert.deepEqual(
    updated.map((r) => r.sha),
    ['1234567890abcdef', 'abcdef1234567890'],
  )
  assert.equal(updated[0].message, 'updated message')
})

test('buildComment merges records from duplicate existing comments', () => {
  const first = buildComment('', versionRecord)
  const second = buildComment('', distRecord)
  const merged = buildComment([first, second], versionRecord)

  assert.deepEqual(
    parseRecords(merged).map((r) => r.sha),
    ['abcdef1234567890', '1234567890abcdef'],
  )
})

test('buildSummary renders committed and skipped records', () => {
  const committed = buildSummary(versionRecord)
  const skipped = buildSummary(skippedRecord)

  assert.ok(committed.includes('`committed`'))
  assert.ok(committed.includes('`1234567890abcdef`'))
  assert.ok(skipped.includes('`skipped`'))
  assert.ok(skipped.includes('`dist/`'))
})

test('buildComment renders a linked commit SHA when repo is present', () => {
  const comment = buildComment('', versionRecord)
  assert.ok(comment.includes('https://github.com/owner/repo/commit/1234567890abcdef'))
  assert.ok(comment.includes('1234567 committed 2 files'))
})

test('buildComment renders a plain SHA when repo is absent', () => {
  const noRepoRecord = { ...versionRecord }
  delete noRepoRecord.repo
  const comment = buildComment('', noRepoRecord)
  assert.ok(comment.includes('1234567 committed 2 files'))
  assert.ok(!comment.includes('github.com'))
})

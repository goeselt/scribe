'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { upsertComment } = require('./github.js')
const { MARKER, buildComment, parseRecords } = require('./comment.js')

const recordA = {
  committed: true,
  sha: 'aaaaaaa',
  repo: 'owner/repo',
  committedAt: '2026-06-07T12:00:00Z',
  files: ['a.js'],
  message: 'commit A',
}
const recordB = {
  committed: true,
  sha: 'bbbbbbb',
  repo: 'owner/repo',
  committedAt: '2026-06-07T12:05:00Z',
  files: ['b.js'],
  message: 'commit B',
}

function makeTestOps(comments = []) {
  let nextId = 1
  return {
    find: (marker) => Promise.resolve(comments.filter((c) => c.body.includes(marker))),
    create: (body) => {
      const c = { id: nextId++, body }
      comments.push(c)
      return Promise.resolve(c)
    },
    update: (id, body) => {
      const c = comments.find((c) => c.id === id)
      c.body = body
      return Promise.resolve(c)
    },
    del: (id) => {
      const i = comments.findIndex((c) => c.id === id)
      if (i >= 0) comments.splice(i, 1)
      return Promise.resolve(null)
    },
    delay: () => Promise.resolve(),
  }
}

test('creates a new comment when none exists', async () => {
  const comments = []
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), makeTestOps(comments))

  assert.equal(comments.length, 1)
  assert.deepEqual(
    parseRecords(comments[0].body).map((r) => r.sha),
    ['aaaaaaa'],
  )
})

test('updates existing comment with a second record', async () => {
  const comments = []
  const ops = makeTestOps(comments)
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), ops)
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordB), ops)

  assert.equal(comments.length, 1)
  assert.deepEqual(
    parseRecords(comments[0].body)
      .map((r) => r.sha)
      .sort(),
    ['aaaaaaa', 'bbbbbbb'],
  )
})

test('merges and deduplicates when two comments exist (concurrent-POST scenario)', async () => {
  // Pre-populate as if two workflows both POSTed before either had a chance to verify.
  const comments = [
    { id: 1, body: buildComment('', recordA) },
    { id: 2, body: buildComment('', recordB) },
  ]
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), makeTestOps(comments))

  assert.equal(comments.length, 1)
  assert.deepEqual(
    parseRecords(comments[0].body)
      .map((r) => r.sha)
      .sort(),
    ['aaaaaaa', 'bbbbbbb'],
  )
})

test('does not throw when a duplicate comment was already deleted concurrently', async () => {
  // Simulate stale find result: find returns [C1, C2] on the first call, but C2 is already gone
  // by the time del is called (removed by a concurrent invocation).
  const comments = [{ id: 1, body: buildComment('', recordA) }]

  let findCalls = 0
  const ops = {
    ...makeTestOps(comments),
    find: (marker) => {
      findCalls++
      if (findCalls === 1) {
        return Promise.resolve(
          [comments[0], { id: 2, body: buildComment('', recordB) }].filter((c) => c.body.includes(marker)),
        )
      }
      return Promise.resolve(comments.filter((c) => c.body.includes(marker)))
    },
    del: (id) => {
      if (id === 2) return Promise.reject(new Error('GitHub API DELETE --> HTTP 404: not found'))
      const i = comments.findIndex((c) => c.id === id)
      if (i >= 0) comments.splice(i, 1)
      return Promise.resolve(null)
    },
  }

  await assert.doesNotReject(upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), ops))
  assert.equal(comments.length, 1)
})

test('is idempotent when called twice with the same record', async () => {
  const comments = []
  const ops = makeTestOps(comments)
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), ops)
  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), ops)

  assert.equal(comments.length, 1)
  assert.equal(parseRecords(comments[0].body).length, 1)
})

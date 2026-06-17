'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { upsertComment, normalizeLoginHint, authenticatedLogin, listComments } = require('./github.js')
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

function makeTestOps(comments = [], viewerLogin = 'scribe-bot') {
  let nextId = 1
  return {
    login: () => Promise.resolve(viewerLogin),
    find: (marker, authorLogin) =>
      Promise.resolve(comments.filter((c) => c.body.includes(marker) && c.user?.login === authorLogin)),
    create: (body) => {
      const c = { id: nextId++, body, user: { login: viewerLogin } }
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
    { id: 1, body: buildComment('', recordA), user: { login: 'scribe-bot' } },
    { id: 2, body: buildComment('', recordB), user: { login: 'scribe-bot' } },
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
  const comments = [{ id: 1, body: buildComment('', recordA), user: { login: 'scribe-bot' } }]

  let findCalls = 0
  const ops = {
    ...makeTestOps(comments),
    find: (marker, authorLogin) => {
      findCalls++
      if (findCalls === 1) {
        return Promise.resolve(
          [comments[0], { id: 2, body: buildComment('', recordB), user: { login: 'scribe-bot' } }].filter(
            (c) => c.body.includes(marker) && c.user?.login === authorLogin,
          ),
        )
      }
      return Promise.resolve(comments.filter((c) => c.body.includes(marker) && c.user?.login === authorLogin))
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

test('does not update or delete marker comments owned by another user', async () => {
  const foreignBody = buildComment('', recordA)
  const comments = [{ id: 99, body: foreignBody, user: { login: 'someone-else' } }]

  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordB), makeTestOps(comments))

  assert.equal(comments.length, 2)
  assert.equal(comments.find((c) => c.id === 99).body, foreignBody)
  assert.deepEqual(
    parseRecords(comments.find((c) => c.id !== 99).body).map((r) => r.sha),
    ['bbbbbbb'],
  )
})

test('fails when authenticated user login is missing', async () => {
  const ops = { ...makeTestOps([]), login: () => Promise.resolve('') }

  await assert.rejects(
    upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordA), ops),
    /authenticated user login/,
  )
})

test('uses the author login hint when ops resolve it', async () => {
  const comments = [{ id: 99, body: buildComment('', recordA), user: { login: 'release-app[bot]' } }]
  const ops = {
    ...makeTestOps(comments),
    login: (fallbackLogin) => Promise.resolve(fallbackLogin),
  }

  await upsertComment(null, null, 1, MARKER, (b) => buildComment(b, recordB), ops, 'release-app[bot]')

  assert.equal(comments.length, 1)
  assert.deepEqual(
    parseRecords(comments[0].body)
      .map((r) => r.sha)
      .sort(),
    ['aaaaaaa', 'bbbbbbb'],
  )
})

// normalizeLoginHint

test('normalizeLoginHint accepts a plain GitHub username', () => {
  assert.equal(normalizeLoginHint('octocat'), 'octocat')
})

test('normalizeLoginHint accepts a single-character username', () => {
  assert.equal(normalizeLoginHint('a'), 'a')
})

test('normalizeLoginHint accepts a username with hyphens', () => {
  assert.equal(normalizeLoginHint('my-release-bot'), 'my-release-bot')
})

test('normalizeLoginHint accepts a bot login with [bot] suffix', () => {
  assert.equal(normalizeLoginHint('my-app[bot]'), 'my-app[bot]')
})

test('normalizeLoginHint trims surrounding whitespace before validating', () => {
  assert.equal(normalizeLoginHint('  octocat  '), 'octocat')
})

test('normalizeLoginHint rejects a login starting with a hyphen', () => {
  assert.equal(normalizeLoginHint('-invalid'), '')
})

test('normalizeLoginHint rejects a login ending with a hyphen', () => {
  assert.equal(normalizeLoginHint('invalid-'), '')
})

test('normalizeLoginHint rejects a login with spaces or special characters', () => {
  assert.equal(normalizeLoginHint('bad user!'), '')
})

test('normalizeLoginHint returns an empty string for null or undefined', () => {
  assert.equal(normalizeLoginHint(null), '')
  assert.equal(normalizeLoginHint(), '')
})

// authenticatedLogin

test('authenticatedLogin returns the login from the /user response', async () => {
  const mockRequest = () => Promise.resolve({ login: 'release-bot' })
  assert.equal(await authenticatedLogin('token', '', mockRequest), 'release-bot')
})

test('authenticatedLogin falls back to the hint when /user returns no login field', async () => {
  const mockRequest = () => Promise.resolve({ id: 42 })
  assert.equal(await authenticatedLogin('token', 'my-app[bot]', mockRequest), 'my-app[bot]')
})

test('authenticatedLogin falls back to the hint on a 4xx response', async () => {
  const mockRequest = () => Promise.reject(new Error('GitHub API GET /user --> HTTP 403: forbidden'))
  assert.equal(await authenticatedLogin('token', 'my-app[bot]', mockRequest), 'my-app[bot]')
})

test('authenticatedLogin rethrows non-4xx errors', async () => {
  const mockRequest = () => Promise.reject(new Error('GitHub API GET /user --> HTTP 503: unavailable'))
  await assert.rejects(() => authenticatedLogin('token', 'fallback', mockRequest), /HTTP 503/)
})

// listComments pagination

test('listComments returns all comments from a single page', async () => {
  const page = [{ id: 1 }, { id: 2 }]
  let calls = 0
  const mockRequest = () => {
    calls++
    return Promise.resolve(page)
  }
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.equal(calls, 1)
  assert.deepEqual(result, page)
})

test('listComments fetches subsequent pages when a full page of 100 is returned', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }))
  const page2 = [{ id: 101 }, { id: 102 }]
  let calls = 0
  const mockRequest = () => Promise.resolve(calls++ === 0 ? page1 : page2)
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.equal(calls, 2)
  assert.equal(result.length, 102)
})

test('listComments returns an empty array when the first page is empty', async () => {
  const mockRequest = () => Promise.resolve([])
  const result = await listComments('token', 'owner/repo', 1, mockRequest)
  assert.deepEqual(result, [])
})

'use strict'

const https = require('node:https')

function request(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'scribe',
        ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }

    const req = https.request(options, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        if (res.statusCode >= 400) {
          reject(new Error(`GitHub API ${method} ${path} --> HTTP ${res.statusCode}: ${raw}`))
          return
        }
        resolve(raw ? JSON.parse(raw) : null)
      })
    })

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

async function listComments(token, repo, prNumber) {
  const comments = []
  let page = 1
  for (;;) {
    const batch = await request('GET', `/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`, token)
    if (!Array.isArray(batch) || batch.length === 0) return comments

    comments.push(...batch)
    if (batch.length < 100) return comments
    page++
  }
}

async function findComments(token, repo, prNumber, marker) {
  const comments = await listComments(token, repo, prNumber)
  return comments.filter((c) => typeof c.body === 'string' && c.body.includes(marker))
}

function makeOps(token, repo, prNumber) {
  return {
    find: (marker) => findComments(token, repo, prNumber, marker),
    create: (body) => request('POST', `/repos/${repo}/issues/${prNumber}/comments`, token, { body }),
    update: (id, body) => request('PATCH', `/repos/${repo}/issues/comments/${id}`, token, { body }),
    del: (id) => request('DELETE', `/repos/${repo}/issues/comments/${id}`, token),
    delay: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
}

function ignore404(err) {
  if (String(err?.message).includes('HTTP 404')) return null
  throw err
}

async function upsertComment(token, repo, prNumber, marker, buildBody, ops) {
  ops = ops ?? makeOps(token, repo, prNumber)
  let written = null

  for (let attempt = 0; attempt < 3; attempt++) {
    const comments = await ops.find(marker)
    const keeper = comments[0] ?? null
    const body = buildBody(comments.map((c) => c.body))

    if (keeper) {
      written = normalize(keeper.body) === normalize(body) ? keeper : await ops.update(keeper.id, body)
    } else {
      written = await ops.create(body)
    }

    for (const duplicate of comments.slice(1)) {
      await ops.del(duplicate.id).catch(ignore404)
    }

    await ops.delay(250 * (attempt + 1))
    const synced = await ops.find(marker)
    if (synced.length === 1 && normalize(buildBody(synced.map((c) => c.body))) === normalize(synced[0].body)) {
      return synced[0]
    }
  }

  return written
}

function normalize(text) {
  return String(text ?? '').replace(/\r\n/g, '\n')
}

module.exports = { upsertComment }

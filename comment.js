'use strict'

const MARKER = '<!-- scribe -->'
const RECORDS_RE = /<!-- scribe-records: ([A-Za-z0-9+/=]+) -->/
const MAX_COMMENT_RECORDS = 50
const MAX_STORED_FILES = 50
const MAX_STORED_FILE_LENGTH = 120
const MAX_STORED_MESSAGE_LENGTH = 500
const MAX_STORED_PUSH_LENGTH = 160
const SHA_RE = /^[0-9a-f]{7,64}$/i
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/

function clean(str) {
  return String(str ?? '')
    .replace(/\s+/g, ' ')
    .replace(/`/g, "'")
    .trim()
}

function cell(str, maxLen) {
  let text = clean(str)
  if (maxLen && text.length > maxLen) text = `${text.slice(0, maxLen - 3)}...`
  return `\`${text.replace(/\|/g, '\\|')}\``
}

function shortSha(sha) {
  return sha ? String(sha).slice(0, 7) : '--'
}

function resultText(record) {
  return record.committed ? 'committed' : 'skipped - no staged changes'
}

function encodeRecords(records) {
  return Buffer.from(JSON.stringify(records), 'utf8').toString('base64')
}

function limited(value, maxLen) {
  const text = clean(value)
  return text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeFilesForStorage(files) {
  if (!Array.isArray(files)) return []
  return files
    .map((f) => limited(f, MAX_STORED_FILE_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_STORED_FILES)
}

function normalizeRecordForStorage(record) {
  const sha = clean(record?.sha)
  if (!SHA_RE.test(sha)) return null

  const repo = clean(record?.repo)
  return {
    committed: Boolean(record?.committed),
    sha,
    ...(REPO_RE.test(repo) ? { repo } : {}),
    committedAt: limited(record?.committedAt, 40),
    files: normalizeFilesForStorage(record?.files),
    message: limited(record?.message, MAX_STORED_MESSAGE_LENGTH),
    push: limited(record?.push, MAX_STORED_PUSH_LENGTH),
    signing: Boolean(record?.signing),
    force: Boolean(record?.force),
  }
}

function parseRecords(body) {
  const bodies = Array.isArray(body) ? body : [body]
  const records = []

  for (const value of bodies) {
    const match = String(value ?? '').match(RECORDS_RE)
    if (!match) continue

    try {
      const parsed = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8'))
      if (Array.isArray(parsed)) records.push(...parsed.map(normalizeRecordForStorage).filter(Boolean))
    } catch {
      // Ignore malformed hidden state; visible Markdown remains informational.
    }
  }

  return records
}

function upsertRecord(records, next) {
  const index = records.findIndex((r) => r.sha === next.sha)
  if (index === -1) return [...records, next]

  const updated = [...records]
  updated[index] = next
  return updated
}

function sortRecords(records) {
  return [...records].sort((a, b) => String(b.committedAt ?? '').localeCompare(String(a.committedAt ?? '')))
}

function filesCell(files) {
  const list = Array.isArray(files) ? files : []
  if (list.length === 0) return '--'
  return list.map((f) => cell(f, 60)).join('<br>')
}

function commitCell(r) {
  const sha7 = shortSha(r.sha)
  const count = r.files?.length ?? 0
  const noun = count === 1 ? 'file' : 'files'
  const label = `${sha7} committed ${count} ${noun}`
  if (r.repo && r.sha) return `[${label}](https://github.com/${r.repo}/commit/${r.sha})`
  return label
}

function summaryCommitCell(record) {
  if (!record.sha) return '--'
  if (record.repo) return `[${record.sha}](https://github.com/${record.repo}/commit/${record.sha})`
  return `\`${record.sha}\``
}

function commentTable(records) {
  const rows = records.map((r) => [commitCell(r), filesCell(r.files), cell(r.message, 72)].join(' | '))

  return ['| Commit | Files | Message |', '| :-- | :-- | :-- |', ...rows.map((r) => `| ${r} |`)].join('\n')
}

function buildComment(existingBody, record) {
  const next = normalizeRecordForStorage(record)
  if (!next) throw new Error('comment record is missing a valid commit sha')

  const records = sortRecords(upsertRecord(parseRecords(existingBody), next)).slice(0, MAX_COMMENT_RECORDS)
  return [
    MARKER,
    `<!-- scribe-records: ${encodeRecords(records)} -->`,
    '',
    '## Scribe',
    '',
    'Scribe committed the following file updates to this pull request.',
    '',
    commentTable(records),
  ].join('\n')
}

function summaryTable(record) {
  return [
    '| Field | Value |',
    '| :-- | :-- |',
    `| Result | \`${resultText(record)}\` |`,
    `| Commit | ${summaryCommitCell(record)} |`,
    `| Files | ${filesCell(record.files)} |`,
    `| Message | ${cell(record.message, 100)} |`,
    `| Push | ${cell(record.push, 100)} |`,
    `| Signing | \`${record.signing ? 'yes' : 'no'}\` |`,
    `| Force add | \`${record.force ? 'yes' : 'no'}\` |`,
  ].join('\n')
}

function buildSummary(record) {
  return ['## Scribe', '', summaryTable(record), ''].join('\n')
}

module.exports = { MARKER, MAX_COMMENT_RECORDS, buildComment, buildSummary, parseRecords, upsertRecord }

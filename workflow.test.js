'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeWorkflowCommandValue, fail, warn, log, setDefaultOutputs } = require('./workflow.js')

function captureStdout(fn) {
  const chunks = []
  const originalWrite = process.stdout.write
  process.stdout.write = (chunk) => {
    chunks.push(chunk)
    return true
  }

  try {
    fn()
  } finally {
    process.stdout.write = originalWrite
  }

  return chunks.join('')
}

test('escapeWorkflowCommandValue escapes workflow command control characters', () => {
  assert.equal(escapeWorkflowCommandValue('line 1%25\r\nline 2'), 'line 1%2525%0D%0Aline 2')
})

test('fail escapes annotation text', () => {
  const output = captureStdout(() => fail('bad%thing\nnext'))
  assert.equal(output, '::error title=Scribe::bad%25thing%0Anext\n')
})

test('warn escapes annotation text', () => {
  const output = captureStdout(() => warn('careful\rnow'))
  assert.equal(output, '::warning title=Scribe::careful%0Dnow\n')
})

test('log escapes workflow command control characters', () => {
  const output = captureStdout(() => log('alice\n::warning title=pwned::hi'))
  assert.equal(output, '[scribe] alice%0A::warning title=pwned::hi\n')
})

test('setDefaultOutputs writes stable initial outputs', () => {
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-output-')), 'out')

  setDefaultOutputs({ GITHUB_OUTPUT: outputFile })

  assert.equal(fs.readFileSync(outputFile, 'utf8'), 'committed=false\nsha=\n')
  fs.rmSync(path.dirname(outputFile), { recursive: true, force: true })
})

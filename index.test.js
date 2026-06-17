'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { escapeWorkflowCommandValue, fail, warn, boolInput } = require('./index.js')

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

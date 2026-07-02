'use strict'

const fs = require('node:fs')

function escapeWorkflowCommandValue(value) {
  return String(value ?? '')
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A')
}

function log(message) {
  process.stdout.write(`[scribe] ${escapeWorkflowCommandValue(message)}\n`)
}

function fail(message) {
  process.stdout.write(`::error title=Scribe::${escapeWorkflowCommandValue(message)}\n`)
}

function warn(message) {
  process.stdout.write(`::warning title=Scribe::${escapeWorkflowCommandValue(message)}\n`)
}

function setOutput(name, value, env = process.env) {
  const outputFile = env.GITHUB_OUTPUT
  if (!outputFile) return
  const text = String(value ?? '')
  // GITHUB_OUTPUT is line-based; a line break in the value would inject additional outputs.
  if (/[\r\n]/.test(text)) throw new Error(`output ${name} must be a single line, got ${JSON.stringify(text)}`)
  fs.appendFileSync(outputFile, `${name}=${text}\n`)
}

function setDefaultOutputs(env = process.env) {
  setOutput('committed', 'false', env)
  setOutput('sha', '', env)
}

function eventPayload(env = process.env) {
  const eventPath = env.GITHUB_EVENT_PATH
  if (!eventPath) return {}
  try {
    return JSON.parse(fs.readFileSync(eventPath, 'utf8'))
  } catch (err) {
    throw new Error(`could not read the event payload from GITHUB_EVENT_PATH (${eventPath}): ${err.message}`, {
      cause: err,
    })
  }
}

module.exports = {
  escapeWorkflowCommandValue,
  log,
  fail,
  warn,
  setOutput,
  setDefaultOutputs,
  eventPayload,
}

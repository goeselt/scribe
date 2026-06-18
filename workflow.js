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
  fs.appendFileSync(outputFile, `${name}=${value}\n`)
}

function eventPayload(env = process.env) {
  const eventPath = env.GITHUB_EVENT_PATH
  if (!eventPath) return {}
  return JSON.parse(fs.readFileSync(eventPath, 'utf8'))
}

module.exports = {
  escapeWorkflowCommandValue,
  log,
  fail,
  warn,
  setOutput,
  eventPayload,
}

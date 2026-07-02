'use strict'

const DEFAULT_GIT_USER_NAME = 'github-actions[bot]'
const DEFAULT_GIT_USER_EMAIL = '41898282+github-actions[bot]@users.noreply.github.com'

function input(name, env = process.env) {
  return env[`INPUT_${name}`] ?? ''
}

function boolInput(name, fallback, env = process.env) {
  const raw = input(name, env).trim().toLowerCase() || (fallback ? 'true' : 'false')
  if (raw === 'true') return true
  if (raw === 'false') return false
  throw new Error(`${name.toLowerCase()} must be "true" or "false", got ${JSON.stringify(raw)}`)
}

// A leading dash would let an identity value be parsed as a git option (e.g. --file=<path>) instead of a config value.
function identityValue(name, value, fallback) {
  const text = String(value ?? '').trim() || fallback
  if (text.startsWith('-')) throw new Error(`${name} must not start with "-", got ${JSON.stringify(text)}`)
  return text
}

function resolveGitIdentity(userName, userEmail) {
  return {
    userName: identityValue('git-user-name', userName, DEFAULT_GIT_USER_NAME),
    userEmail: identityValue('git-user-email', userEmail, DEFAULT_GIT_USER_EMAIL),
  }
}

function readInputs(env = process.env) {
  const identity = resolveGitIdentity(input('GIT-USER-NAME', env), input('GIT-USER-EMAIL', env))
  return {
    filesInput: input('FILES', env),
    message: input('MESSAGE', env),
    ...identity,
    signingKey: input('SIGNING-KEY', env),
    force: boolInput('FORCE', false, env),
    token: input('GITHUB-TOKEN', env),
    postComment: boolInput('PR-COMMENT', true, env),
    skipCi: boolInput('SKIP-CI', true, env),
  }
}

module.exports = {
  DEFAULT_GIT_USER_NAME,
  DEFAULT_GIT_USER_EMAIL,
  input,
  boolInput,
  resolveGitIdentity,
  readInputs,
}

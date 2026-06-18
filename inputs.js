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
  throw new Error(`${name} must be "true" or "false", got ${JSON.stringify(raw)}`)
}

function resolveGitIdentity(userName, userEmail) {
  return {
    userName: String(userName ?? '').trim() || DEFAULT_GIT_USER_NAME,
    userEmail: String(userEmail ?? '').trim() || DEFAULT_GIT_USER_EMAIL,
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

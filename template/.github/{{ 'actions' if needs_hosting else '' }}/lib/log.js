import { appendFileSync } from 'node:fs'

// A workflow-command annotation is a single line: a raw newline would end the
// command and print the rest as ordinary output, so a multi-line explanation
// silently loses everything after the first line. GitHub's escape for that is
// the URL-encoded form of the three characters that can't appear literally.
function escape(message) {
    return String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

export function notice(message, out = console.log) {
    out(`::notice::${escape(message)}`)
}

export function warning(message, out = console.log) {
    out(`::warning::${escape(message)}`)
}

export function error(message, out = console.log) {
    out(`::error::${escape(message)}`)
}

// The step summary is where a refusal has to land as well as in an annotation:
// annotations are easy to scroll past, and "staging was not seeded" is exactly
// the thing someone must not discover by finding an empty table later.
// Absent outside Actions, in which case there is nowhere to write and the
// console output already said it.
export function summary(markdown, env = process.env) {
    if (!env.GITHUB_STEP_SUMMARY) return false
    appendFileSync(env.GITHUB_STEP_SUMMARY, `${markdown}\n`)
    return true
}

export function setOutput(name, value, env = process.env) {
    if (!env.GITHUB_OUTPUT) return false
    // The heredoc form, because a value containing a newline would otherwise
    // be parsed as further key=value lines.
    const delimiter = `ghadelim_${name}_${Math.random().toString(36).slice(2)}`
    appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`)
    return true
}

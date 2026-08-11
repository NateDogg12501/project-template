import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Every stage that talks to AWS goes through here, and every one of them takes
// its runner as a parameter defaulting to this function. That indirection is
// the only reason capacity-gate's pagination and ensure-secrets' write-once
// check are testable at all — a stage calling execFileSync directly could only
// be exercised against a real AWS account, which is to say never.
//
// execFileSync, not exec: arguments are passed as an array straight to the
// process, so a table name or parameter path can never be reinterpreted as
// shell syntax.
export function runAws(args, { input } = {}) {
    return execFileSync('aws', args, {
        encoding: 'utf8',
        // A Scan page or a large ListTables response comfortably exceeds
        // Node's 1MB default, and the failure mode is a truncated buffer
        // rather than an error.
        maxBuffer: 64 * 1024 * 1024,
        input,
    })
}

export function runAwsJson(runner, args, options) {
    const raw = runner(args, options)
    // An empty stdout from a successful call means the CLI printed nothing we
    // can act on; treating it as `{}` would silently look like "no results".
    if (!raw || !raw.trim()) {
        throw new Error(`aws ${args.slice(0, 2).join(' ')} returned no output`)
    }
    return JSON.parse(raw)
}

// Anything carrying a secret, a production item, or a primary key goes to the
// CLI this way rather than as an argument. A process's arguments are readable
// by anything else on the host for as long as it runs; a 0600 file inside a
// 0700 temp directory is not, and it is gone whether the call succeeded or
// threw. Callers never see the path — there is nothing to forget to clean up.
export function runAwsWithJsonInput(runner, args, body, prefix = 'aws-input-') {
    const dir = mkdtempSync(join(tmpdir(), prefix))
    const path = join(dir, 'input.json')

    try {
        writeFileSync(path, JSON.stringify(body), { mode: 0o600 })
        return runner([...args, '--cli-input-json', `file://${path}`])
    } finally {
        rmSync(dir, { recursive: true, force: true })
    }
}

// execFileSync throws an Error carrying the child's stderr; the AWS CLI puts
// its error code there (`ParameterNotFound`, `AccessDeniedException`, ...).
// Callers branch on the code, never on the exit status, which is 254 for
// every client-side error.
export function awsErrorText(err) {
    return [err?.stderr, err?.stdout, err?.message]
        .map((part) => (part == null ? '' : String(part)))
        .join('\n')
}

export function isAwsError(err, code) {
    return awsErrorText(err).includes(code)
}

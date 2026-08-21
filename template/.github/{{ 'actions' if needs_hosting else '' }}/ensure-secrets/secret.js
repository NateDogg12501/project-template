import { randomBytes } from 'node:crypto'
import { pathToFileURL } from 'node:url'

import { awsErrorText, isAwsError, runAws, runAwsWithJsonInput } from '../lib/aws.js'
import { error, notice } from '../lib/log.js'

// 32 bytes, hex-encoded — the same shape as `openssl rand -hex 32`, from a
// CSPRNG that is already in the runtime rather than a subprocess.
export function generateSecret() {
    return randomBytes(32).toString('hex')
}

// Overwrite: false is the load-bearing field. The existence check above is a
// read followed by a write, and two deploys racing would otherwise let the
// second one replace a secret the first had just created — logging out every
// session, which is the exact outcome this stage exists to prevent.
function putParameter(runner, name, value, description) {
    const body = { Name: name, Value: value, Type: 'SecureString', Description: description, Overwrite: false }
    runAwsWithJsonInput(runner, ['ssm', 'put-parameter'], body, 'ensure-secrets-')
}

// Generate-if-absent, never rotate. Regenerating on every deploy invalidates
// every active session, so everyone is logged out each time the project ships;
// rotation stays a deliberate act (delete the parameter, redeploy) rather than
// a side effect of deploying. That makes this idempotent, which also makes a
// re-run after a partial failure safe.
export function ensureSecret({
    runner = runAws,
    name,
    generate = generateSecret,
    description = 'Created by the deploy pipeline. Delete this parameter and redeploy to rotate it.',
    out = console.log,
} = {}) {
    if (!name) throw new Error('ensure-secrets needs a parameter name')

    try {
        // Existence only. --with-decryption is deliberately not passed: this
        // never needs to see the value, and not asking for it means the
        // deploy role needs no kms:Decrypt.
        runner(['ssm', 'get-parameter', '--name', name, '--output', 'json'])
        notice(`${name} already exists — left alone. Delete the parameter and redeploy to rotate it.`, out)
        return { created: false, reason: 'exists' }
    } catch (err) {
        // Only a genuine absence may fall through to creating one. An
        // AccessDenied swallowed here would look identical to "not there yet"
        // and would go on to write a second secret over a working one, or to
        // fail with a much less obvious error.
        if (!isAwsError(err, 'ParameterNotFound')) {
            throw new Error(`could not read ${name}: ${awsErrorText(err).trim()}`)
        }
    }

    try {
        putParameter(runner, name, generate(), description)
    } catch (err) {
        // Overwrite is false, so a parameter that appeared between the read
        // and the write is reported rather than clobbered — and for this
        // stage that race has the outcome it wanted anyway.
        if (isAwsError(err, 'ParameterAlreadyExists')) {
            notice(`${name} was created concurrently — left alone.`, out)
            return { created: false, reason: 'raced' }
        }
        throw new Error(`could not create ${name}: ${awsErrorText(err).trim()}`)
    }

    notice(`${name} did not exist and was created as a SecureString.`, out)
    return { created: true, reason: 'created' }
}

export function main({ runner = runAws, env = process.env, out = console.log } = {}) {
    try {
        ensureSecret({ runner, name: env.PARAMETER_NAME, out })
        return 0
    } catch (err) {
        error(`ensure-secrets failed: ${err.message ?? err}`, out)
        return 1
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main())
}

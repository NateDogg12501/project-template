import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { ensureSecret, generateSecret, main } from '../secret.js'

const NAME = '/demo/staging/session_secret'

function awsError(code) {
    return Object.assign(new Error('exit 254'), { stderr: `An error occurred (${code}) when calling the operation` })
}

// Records every call, and — because the value is handed over in a file rather
// than in argv — reads that file while the "CLI" is notionally running, which
// is the only moment it exists.
function fakeRunner(handlers) {
    const calls = []
    const seen = []
    const runner = (args) => {
        calls.push(args)
        const operation = args[1]
        const inputFlag = args.indexOf('--cli-input-json')
        if (inputFlag !== -1) {
            const path = args[inputFlag + 1].replace(/^file:\/\//, '')
            seen.push({ path, body: JSON.parse(readFileSync(path, 'utf8')) })
        }
        const handler = handlers[operation]
        if (!handler) throw new Error(`unexpected aws call: ${args.join(' ')}`)
        if (handler instanceof Error) throw handler
        return typeof handler === 'function' ? handler(args) : JSON.stringify(handler)
    }
    return Object.assign(runner, { calls, seen, operations: () => calls.map((args) => args[1]) })
}

function silent() {
    const lines = []
    return Object.assign((line) => lines.push(String(line)), { text: () => lines.join('\n') })
}

describe('generateSecret', () => {
    it('is 32 bytes of hex', () => {
        expect(generateSecret()).toMatch(/^[0-9a-f]{64}$/)
    })

    it('differs every time', () => {
        expect(generateSecret()).not.toBe(generateSecret())
    })
})

describe('ensureSecret', () => {
    // The property the stage exists for: a second deploy must not log everyone
    // out. Asserting no put-parameter call happened is the only way to see it —
    // a rotated secret is otherwise indistinguishable from a fresh one.
    it('does not write when the parameter already exists', () => {
        const runner = fakeRunner({ 'get-parameter': { Parameter: { Name: NAME } } })
        const result = ensureSecret({ runner, name: NAME, out: silent() })

        expect(result).toMatchObject({ created: false, reason: 'exists' })
        expect(runner.operations()).toEqual(['get-parameter'])
    })

    it('creates a SecureString when the parameter is absent', () => {
        const runner = fakeRunner({ 'get-parameter': awsError('ParameterNotFound'), 'put-parameter': { Version: 1 } })
        const result = ensureSecret({ runner, name: NAME, generate: () => 'abc123', out: silent() })

        expect(result.created).toBe(true)
        expect(runner.seen[0].body).toMatchObject({
            Name: NAME,
            Value: 'abc123',
            Type: 'SecureString',
            // Without this an existing secret could be silently replaced by a
            // retry that raced the existence check.
            Overwrite: false,
        })
    })

    it('never puts the value in the command line', () => {
        const runner = fakeRunner({ 'get-parameter': awsError('ParameterNotFound'), 'put-parameter': { Version: 1 } })
        ensureSecret({ runner, name: NAME, generate: () => 'super-secret-value', out: silent() })

        expect(runner.calls.flat().join(' ')).not.toContain('super-secret-value')
    })

    it('removes the temporary file holding the secret', () => {
        const runner = fakeRunner({ 'get-parameter': awsError('ParameterNotFound'), 'put-parameter': { Version: 1 } })
        ensureSecret({ runner, name: NAME, generate: () => 'abc123', out: silent() })

        expect(existsSync(runner.seen[0].path)).toBe(false)
    })

    it('removes the temporary file even when the write fails', () => {
        const runner = fakeRunner({ 'get-parameter': awsError('ParameterNotFound'), 'put-parameter': awsError('ThrottlingException') })

        expect(() => ensureSecret({ runner, name: NAME, out: silent() })).toThrow(/could not create/)
        expect(existsSync(runner.seen[0].path)).toBe(false)
    })

    // An AccessDenied that reads as "not there yet" would go on to write a
    // second secret over a working one, or fail much further from the cause.
    it('does not treat a denied read as an absent parameter', () => {
        const runner = fakeRunner({ 'get-parameter': awsError('AccessDeniedException') })

        expect(() => ensureSecret({ runner, name: NAME, out: silent() })).toThrow(/AccessDenied/)
        expect(runner.operations()).toEqual(['get-parameter'])
    })

    it('treats a parameter created concurrently as success', () => {
        const runner = fakeRunner({
            'get-parameter': awsError('ParameterNotFound'),
            'put-parameter': awsError('ParameterAlreadyExists'),
        })

        expect(ensureSecret({ runner, name: NAME, out: silent() })).toMatchObject({ created: false, reason: 'raced' })
    })

    it('refuses to run without a parameter name', () => {
        expect(() => ensureSecret({ runner: fakeRunner({}), out: silent() })).toThrow(/parameter name/)
    })
})

describe('main', () => {
    it('returns non-zero when the parameter name is missing', () => {
        const out = silent()

        expect(main({ runner: fakeRunner({}), env: {}, out })).toBe(1)
        expect(out.text()).toContain('::error::')
    })

    it('returns zero on an existing parameter', () => {
        const runner = fakeRunner({ 'get-parameter': { Parameter: { Name: NAME } } })

        expect(main({ runner, env: { PARAMETER_NAME: NAME }, out: silent() })).toBe(0)
    })
})

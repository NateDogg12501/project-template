import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
    assertSeedableEnvironment,
    assertSeedableTable,
    batchWrite,
    chunk,
    clearTable,
    copySanitized,
    loadSanitizer,
    main,
    sanitizeAll,
    scanPages,
    tableKeyNames,
} from '../seed.js'

const SOURCE = 'demo-production-items'
const TARGET = 'demo-staging-items'
const NO_SLEEP = { sleep: () => Promise.resolve() }

const scratch = []

afterEach(() => {
    while (scratch.length) rmSync(scratch.pop(), { recursive: true, force: true })
})

// Writes a sanitizer module to disk, because loading one is a real dynamic
// import of a real file — the thing that decides whether a project has
// supplied one at all.
function writeSanitizer(source) {
    const dir = mkdtempSync(join(tmpdir(), 'seed-test-'))
    scratch.push(dir)
    const path = join(dir, 'sanitize-seed.mjs')
    writeFileSync(path, source)
    return path
}

function missingPath() {
    const dir = mkdtempSync(join(tmpdir(), 'seed-test-'))
    scratch.push(dir)
    return join(dir, 'not-written.mjs')
}

// Reads back whatever the caller handed the CLI in --cli-input-json, which is
// where every request body goes, so assertions can look at what would actually
// have been sent to AWS.
function fakeRunner(handler) {
    const calls = []
    const runner = (args) => {
        const flag = args.indexOf('--cli-input-json')
        const body = flag === -1 ? null : JSON.parse(readFileSync(args[flag + 1].replace(/^file:\/\//, ''), 'utf8'))
        const call = { operation: args[1], body, args }
        calls.push(call)
        const result = handler(call, calls)
        if (result instanceof Error) throw result
        return JSON.stringify(result ?? {})
    }
    return Object.assign(runner, {
        calls,
        operations: () => calls.map((call) => call.operation),
        writes: () => calls.filter((call) => call.operation === 'batch-write-item'),
    })
}

function silent() {
    const lines = []
    return Object.assign((line) => lines.push(String(line)), { text: () => lines.join('\n') })
}

function awsError(code) {
    return Object.assign(new Error('exit 254'), { stderr: `An error occurred (${code}) when calling the operation` })
}

describe('refusing to run anywhere but staging', () => {
    it('accepts staging', () => {
        expect(() => assertSeedableEnvironment('staging')).not.toThrow()
    })

    it.each(['production', 'prod', '', undefined])('refuses %s', (environment) => {
        expect(() => assertSeedableEnvironment(environment)).toThrow(/refuses to run/)
    })

    // The environment input says what the deploy believes it is doing; the
    // table name says what would actually be written to.
    it.each(['demo-production-items', 'demo-items', '', undefined])('refuses to write to %s', (table) => {
        expect(() => assertSeedableTable(table)).toThrow(/refuses to write/)
    })

    it.each(['demo-staging-items', 'demo-staging'])('accepts %s', (table) => {
        expect(() => assertSeedableTable(table)).not.toThrow()
    })
})

describe('sanitizeAll', () => {
    const items = [
        { id: { S: '1' }, child_name: { S: 'Ada' } },
        { id: { S: '2' }, child_name: { S: 'Grace' } },
    ]

    it('keeps what the sanitizer returns and drops what it nulls', () => {
        const result = sanitizeAll(items, (item) => (item.id.S === '2' ? null : { id: item.id }))

        expect(result.kept).toEqual([{ id: { S: '1' } }])
        expect(result.dropped).toBe(1)
    })

    it('leaves no trace of a redacted attribute', () => {
        const result = sanitizeAll(items, ({ id }) => ({ id, child_name: { S: 'REDACTED' } }))

        expect(JSON.stringify(result.kept)).not.toContain('Ada')
        expect(JSON.stringify(result.kept)).not.toContain('Grace')
    })

    // `item => item` is the laziest possible sanitizer and copies production
    // verbatim. Nothing else can tell it apart from a real one, so it is
    // refused by construction.
    it('refuses a sanitizer that hands back the item it was given', () => {
        expect(() => sanitizeAll(items, (item) => item)).toThrow(/unchanged/)
    })

    // Skipping the bad item would write a partially sanitized table, which is
    // indistinguishable from a sanitized one.
    it('fails the whole seed when the sanitizer throws on one item', () => {
        expect(() => sanitizeAll(items, () => { throw new Error('boom') })).toThrow(/threw on item 0/)
    })

    it('refuses a non-object return', () => {
        expect(() => sanitizeAll(items, () => 'nope')).toThrow(/expected an item object/)
    })
})

describe('chunk', () => {
    it('splits into batches of 25, the BatchWriteItem limit', () => {
        const chunks = chunk(Array.from({ length: 60 }, (_, i) => i))

        expect(chunks.map((c) => c.length)).toEqual([25, 25, 10])
    })
})

describe('scanPages', () => {
    it('follows LastEvaluatedKey to the end of the table', () => {
        const pages = [
            { Items: [{ id: { S: '1' } }], LastEvaluatedKey: { id: { S: '1' } } },
            { Items: [{ id: { S: '2' } }] },
        ]
        const runner = fakeRunner(() => pages.shift())

        const items = [...scanPages(runner, SOURCE)].flat()

        expect(items).toHaveLength(2)
        expect(runner.calls[1].body.ExclusiveStartKey).toEqual({ id: { S: '1' } })
    })

    // Keys can be personal data in their own right, so they go in a file like
    // everything else rather than onto the command line.
    it('never puts a request body on the command line', () => {
        const runner = fakeRunner(() => ({ Items: [] }))
        ;[...scanPages(runner, SOURCE)]

        expect(runner.calls[0].args.join(' ')).not.toContain('TableName')
    })
})

describe('batchWrite', () => {
    // BatchWriteItem can return 200 and still decline items. Ignoring
    // UnprocessedItems is how a seed reports success having written half a
    // table.
    it('retries the items DynamoDB declined', async () => {
        const responses = [
            { UnprocessedItems: { [TARGET]: [{ PutRequest: { Item: { id: { S: '2' } } } }] } },
            { UnprocessedItems: {} },
        ]
        const runner = fakeRunner(() => responses.shift())

        await batchWrite(runner, TARGET, [1, 2].map((n) => ({ PutRequest: { Item: { id: { S: String(n) } } } })), NO_SLEEP)

        expect(runner.writes()).toHaveLength(2)
        expect(runner.writes()[1].body.RequestItems[TARGET]).toHaveLength(1)
    })

    it('fails when items are still unprocessed after every attempt', async () => {
        const runner = fakeRunner(() => ({ UnprocessedItems: { [TARGET]: [{ PutRequest: { Item: {} } }] } }))

        await expect(batchWrite(runner, TARGET, [{ PutRequest: { Item: {} } }], { ...NO_SLEEP, attempts: 2 }))
            .rejects.toThrow(/still unprocessed/)
    })
})

describe('loadSanitizer', () => {
    it('is null when the project has not written one', async () => {
        expect(await loadSanitizer(missingPath())).toBeNull()
    })

    it('accepts a default export', async () => {
        const path = writeSanitizer('export default (item) => ({ ...item })')

        expect(typeof await loadSanitizer(path)).toBe('function')
    })

    it('accepts a named sanitize export', async () => {
        const path = writeSanitizer('export function sanitize(item) { return { ...item } }')

        expect(typeof await loadSanitizer(path)).toBe('function')
    })

    // Present but unusable is a bug in the project's file, not an absence —
    // reading it as "no sanitizer" would turn a typo into a silent skip.
    it('throws when the file exists but exports nothing usable', async () => {
        const path = writeSanitizer('export const nothing = 1')

        await expect(loadSanitizer(path)).rejects.toThrow(/exports no sanitize function/)
    })
})

describe('copySanitized', () => {
    it('sanitizes each page before reading the next', async () => {
        const pages = [
            { Items: [{ id: { S: '1' }, child_name: { S: 'Ada' } }], LastEvaluatedKey: { id: { S: '1' } } },
            { Items: [{ id: { S: '2' }, child_name: { S: 'Grace' } }] },
        ]
        const order = []
        const runner = fakeRunner((call) => {
            order.push(call.operation)
            return call.operation === 'scan' ? pages.shift() : {}
        })

        const result = await copySanitized(runner, { source: SOURCE, target: TARGET, sanitize: ({ id }) => ({ id }) }, NO_SLEEP)

        expect(result).toMatchObject({ read: 2, written: 2, dropped: 0 })
        expect(order).toEqual(['scan', 'batch-write-item', 'scan', 'batch-write-item'])
    })
})

describe('clearTable', () => {
    it('deletes by key, using placeholders so a reserved word cannot break the projection', async () => {
        const pages = [{ Items: [{ name: { S: 'a' } }, { name: { S: 'b' } }] }]
        const runner = fakeRunner((call) => (call.operation === 'scan' ? pages.shift() : {}))

        expect(await clearTable(runner, TARGET, ['name'], NO_SLEEP)).toBe(2)
        expect(runner.calls[0].body.ProjectionExpression).toBe('#k0')
        expect(runner.calls[0].body.ExpressionAttributeNames).toEqual({ '#k0': 'name' })
        expect(runner.writes()[0].body.RequestItems[TARGET][0]).toHaveProperty('DeleteRequest')
    })
})

describe('main', () => {
    function envFor(overrides = {}) {
        return { ENVIRONMENT: 'staging', SOURCE_TABLE: SOURCE, TARGET_TABLE: TARGET, CLEAR_TARGET: 'false', ...overrides }
    }

    it('refuses production and reads nothing', async () => {
        const runner = fakeRunner(() => ({}))
        const out = silent()

        expect(await main({ runner, env: envFor({ ENVIRONMENT: 'production', TARGET_TABLE: 'demo-production-items' }), out })).toBe(1)
        expect(runner.calls).toHaveLength(0)
        expect(out.text()).toContain('::error::')
    })

    // The refusal that every freshly scaffolded DATABASE project hits. It must
    // not fail the deploy — staging with no data is a working staging — and it
    // must not be quiet, or someone reads an empty table as a bug.
    it('refuses to copy anything when the project has no sanitizer, without failing the deploy', async () => {
        const runner = fakeRunner(() => ({}))
        const out = silent()

        const code = await main({ runner, env: envFor({ SANITIZER: missingPath() }), out })

        expect(code).toBe(0)
        expect(out.text()).toContain('::warning::')
        expect(runner.calls).toHaveLength(0)
    })

    it('refuses when the production table does not exist yet', async () => {
        const runner = fakeRunner(() => awsError('ResourceNotFoundException'))
        const out = silent()

        expect(await main({ runner, env: envFor({ SANITIZER: writeSanitizer('export default (i) => ({ ...i })') }), out })).toBe(0)
        expect(out.text()).toContain('::warning::')
    })

    it('copies sanitized items and leaves the raw values behind', async () => {
        const sanitizer = writeSanitizer('export default ({ id }) => ({ id, child_name: { S: "REDACTED" } })')
        const pages = [{ Items: [{ id: { S: '1' }, child_name: { S: 'Ada' } }] }]
        const runner = fakeRunner((call) => {
            if (call.operation === 'describe-table') return { Table: { KeySchema: [{ AttributeName: 'id' }] } }
            if (call.operation === 'scan') return pages.shift() ?? { Items: [] }
            return {}
        })

        expect(await main({ runner, env: envFor({ SANITIZER: sanitizer }), out: silent(), options: NO_SLEEP })).toBe(0)

        const written = JSON.stringify(runner.writes().map((call) => call.body))
        expect(written).toContain('REDACTED')
        expect(written).not.toContain('Ada')
    })

    it('fails rather than seeding when the sanitizer does nothing', async () => {
        const sanitizer = writeSanitizer('export default (item) => item')
        const pages = [{ Items: [{ id: { S: '1' }, child_name: { S: 'Ada' } }] }]
        const runner = fakeRunner((call) => {
            if (call.operation === 'scan') return pages.shift() ?? { Items: [] }
            return {}
        })
        const out = silent()

        expect(await main({ runner, env: envFor({ SANITIZER: sanitizer }), out, options: NO_SLEEP })).toBe(1)
        expect(runner.writes()).toHaveLength(0)
        expect(out.text()).toContain('::error::')
    })

    it('refuses to copy a table onto itself', async () => {
        const out = silent()

        expect(await main({ runner: fakeRunner(() => ({})), env: envFor({ SOURCE_TABLE: TARGET }), out })).toBe(1)
        expect(out.text()).toContain('onto itself')
    })
})

// A DynamoDB table always has at least a partition key, so "no keys" is not a
// table shape — it is a describe this code could not read. The old `?? []`
// spelled the two the same way and handed an empty key list to `clearTable`,
// which built a scan with an empty ProjectionExpression; DynamoDB rejects
// that, so it did fail — two steps away, wearing a ValidationException that
// names neither this function nor the table it could not describe.
describe('tableKeyNames', () => {
    it('returns the key attribute names', () => {
        const runner = fakeRunner(() => ({
            Table: { KeySchema: [{ AttributeName: 'pk' }, { AttributeName: 'sk' }] },
        }))

        expect(tableKeyNames(runner, TARGET)).toEqual(['pk', 'sk'])
    })

    it.each([
        ['no KeySchema at all', { Table: {} }],
        ['an empty KeySchema', { Table: { KeySchema: [] } }],
        ['a KeySchema that is not an array', { Table: { KeySchema: {} } }],
    ])('refuses %s rather than reporting a table with no keys', (_what, response) => {
        const runner = fakeRunner(() => response)

        expect(() => tableKeyNames(runner, TARGET)).toThrow(/KeySchema/)
    })

    it('refuses a KeySchema whose entries have no attribute name', () => {
        const runner = fakeRunner(() => ({ Table: { KeySchema: [{ KeyType: 'HASH' }] } }))

        expect(() => tableKeyNames(runner, TARGET)).toThrow(/unreadable/i)
    })

    // The message has to name the table: this runs against the *target*, and
    // "which table could not be described" is the whole of the diagnosis.
    it('names the table it could not describe', () => {
        const runner = fakeRunner(() => ({ Table: {} }))

        expect(() => tableKeyNames(runner, TARGET)).toThrow(new RegExp(TARGET))
    })
})

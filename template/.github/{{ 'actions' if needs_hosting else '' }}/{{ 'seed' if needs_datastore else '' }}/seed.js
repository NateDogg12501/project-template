import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { awsErrorText, isAwsError, runAws, runAwsJson, runAwsWithJsonInput } from '../lib/aws.js'
import { error, notice, setOutput, summary, warning } from '../lib/log.js'

// BatchWriteItem takes at most 25 requests per call.
const BATCH_SIZE = 25
const MAX_PAGES = 10_000

// The only environment this stage will ever write to. Not a default, not an
// input — a constant, because "which environments may be seeded from
// production" is not a per-project question.
export const SEEDABLE_ENVIRONMENT = 'staging'

export function assertSeedableEnvironment(environment) {
    if (environment !== SEEDABLE_ENVIRONMENT) {
        throw new Error(
            `seed refuses to run against "${environment}". It copies data out of the production table, and the only `
            + `place that data may land is ${SEEDABLE_ENVIRONMENT}. Nothing was read and nothing was written.`,
        )
    }
}

// A second, independent check on the destination. The environment input says
// what this deploy believes it is doing; the table name says what would
// actually be written to. They are derived from the same answer today, and the
// day they stop agreeing is the day this matters.
export function assertSeedableTable(name) {
    if (!name || !/-staging(-|$)/.test(name)) {
        throw new Error(
            `seed refuses to write to "${name}": a destination table must be named for the ${SEEDABLE_ENVIRONMENT} `
            + 'environment. Nothing was read and nothing was written.',
        )
    }
}

// A project's own file, because only the project knows which attributes are
// sensitive. Absent is the normal state of a freshly scaffolded project, and
// it is answered by refusing to seed rather than by copying production
// verbatim — hence the null return rather than a throw.
export async function loadSanitizer(path, { load = (url) => import(url) } = {}) {
    const absolute = resolve(path)
    if (!existsSync(absolute)) return null

    const module = await load(pathToFileURL(absolute).href)
    const sanitize = module.default ?? module.sanitize

    // Present but unusable is a bug in the project's own file, not an absence.
    // Treating it as "no sanitizer" would turn a typo into a silent skip.
    if (typeof sanitize !== 'function') {
        throw new Error(`${path} exists but exports no sanitize function (expected a default export, or a named export "sanitize")`)
    }
    return sanitize
}

// Items are in DynamoDB's AttributeValue form — `{ name: { S: 'Ada' } }` —
// exactly as Scan returned them and exactly as BatchWriteItem wants them.
// Nothing here unmarshals them into plain JavaScript first: a hand-written
// unmarshaller would have to turn `{ N: "12345678901234567890" }` into a
// JavaScript number and hand back something different from what it was given.
// Losing precision while copying data is a worse failure than an awkward
// shape, and the shape is only awkward once, in one file per project.
export function sanitizeAll(items, sanitize) {
    const kept = []
    let dropped = 0

    for (const [index, item] of items.entries()) {
        let result
        try {
            result = sanitize(item)
        } catch (err) {
            // One bad item fails the whole seed. Skipping it would write a
            // partially sanitized table, which is indistinguishable from a
            // sanitized one.
            throw new Error(`the sanitizer threw on item ${index}: ${err?.message ?? err}`)
        }

        if (result === null || result === undefined) {
            dropped += 1
            continue
        }
        if (typeof result !== 'object' || Array.isArray(result)) {
            throw new Error(`the sanitizer returned ${typeof result} for item ${index}; expected an item object or null`)
        }
        // The laziest possible sanitizer — `item => item` — copies production
        // verbatim, and nothing else can tell that apart from a real one. So
        // returning the object it was handed is refused: build a new item
        // (`const clean = { ...item }`) and return that.
        if (result === item) {
            throw new Error(
                `the sanitizer returned item ${index} unchanged (the same object it was given). Return a new object — `
                + '`const clean = { ...item }` — so that a sanitizer which does nothing cannot look like one that does.',
            )
        }

        kept.push(result)
    }

    return { kept, dropped }
}

export function chunk(array, size = BATCH_SIZE) {
    const chunks = []
    for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
    return chunks
}

// Production items and primary keys go to the CLI in a file rather than in
// argv for the same reason the session secret does — see lib/aws.js.
export function* scanPages(runner, table, request = {}) {
    let startKey

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const body = { TableName: table, ...request, ...(startKey ? { ExclusiveStartKey: startKey } : {}) }
        const raw = runAwsWithJsonInput(runner, ['dynamodb', 'scan', '--no-paginate', '--output', 'json'], body, 'seed-scan-')
        const response = JSON.parse(raw)

        yield response.Items ?? []

        if (!response.LastEvaluatedKey) return
        startKey = response.LastEvaluatedKey
    }

    throw new Error(`scan of ${table} did not finish within ${MAX_PAGES} pages`)
}

const wait = (ms) => new Promise((done) => { setTimeout(done, ms) })

// BatchWriteItem can accept a call and still decline individual items, handing
// them back in UnprocessedItems with a 200. Ignoring that field is how a seed
// reports success having written most of the table.
export async function batchWrite(runner, table, requests, { attempts = 5, sleep = wait } = {}) {
    let pending = requests

    for (let attempt = 0; attempt < attempts && pending.length > 0; attempt += 1) {
        if (attempt > 0) await sleep(2 ** attempt * 100)

        const raw = runAwsWithJsonInput(runner, ['dynamodb', 'batch-write-item', '--output', 'json'], { RequestItems: { [table]: pending } }, 'seed-write-')
        pending = JSON.parse(raw)?.UnprocessedItems?.[table] ?? []
    }

    if (pending.length > 0) {
        throw new Error(`${pending.length} items were still unprocessed after ${attempts} attempts writing to ${table}`)
    }
}

// A DynamoDB table always has at least a partition key, so an empty key list
// is not a table shape — it is a describe this code could not read. The old
// `?? []` spelled the two the same way, and `clearTable` then built a scan
// with an empty ProjectionExpression, which DynamoDB rejects. So it did fail,
// two steps away from the cause and wearing a ValidationException that names
// neither this function nor the table it could not describe. Failing here says
// the true thing in the place that knows it.
export function tableKeyNames(runner, table) {
    const described = runAwsJson(runner, ['dynamodb', 'describe-table', '--table-name', table, '--output', 'json'])
    const schema = described.Table?.KeySchema

    if (!Array.isArray(schema) || schema.length === 0) {
        throw new Error(`describe-table returned no KeySchema for ${table}, so its key attributes are unknown`)
    }

    const names = schema.map((element) => element.AttributeName)
    if (names.some((name) => typeof name !== 'string' || name === '')) {
        throw new Error(`describe-table returned an unreadable KeySchema for ${table}: ${JSON.stringify(schema)}`)
    }
    return names
}

export function tableExists(runner, table) {
    try {
        runAwsJson(runner, ['dynamodb', 'describe-table', '--table-name', table, '--output', 'json'])
        return true
    } catch (err) {
        if (isAwsError(err, 'ResourceNotFoundException')) return false
        throw err
    }
}

// Reseed means replace: a staging table that keeps yesterday's rows alongside
// today's is not a copy of production. Only ever reached after
// assertSeedableTable.
export async function clearTable(runner, table, keyNames, options = {}) {
    // A key attribute can be named `name`, `status`, or any of DynamoDB's
    // hundreds of reserved words, so the projection goes through placeholders
    // rather than naming attributes directly.
    const names = Object.fromEntries(keyNames.map((key, index) => [`#k${index}`, key]))
    const request = {
        ProjectionExpression: Object.keys(names).join(','),
        ExpressionAttributeNames: names,
    }

    let deleted = 0
    for (const items of scanPages(runner, table, request)) {
        for (const batch of chunk(items)) {
            await batchWrite(runner, table, batch.map((Key) => ({ DeleteRequest: { Key } })), options)
            deleted += batch.length
        }
    }
    return deleted
}

// Page by page, not table then transform: a production page is sanitized and
// written before the next is read, so raw production data exists only for as
// long as one page takes to process and is never accumulated, never written to
// disk, and never uploaded as an artifact.
export async function copySanitized(runner, { source, target, sanitize }, options = {}) {
    let read = 0
    let written = 0
    let dropped = 0

    for (const items of scanPages(runner, source)) {
        read += items.length
        const result = sanitizeAll(items, sanitize)
        dropped += result.dropped

        for (const batch of chunk(result.kept)) {
            await batchWrite(runner, target, batch.map((Item) => ({ PutRequest: { Item } })), options)
            written += batch.length
        }
    }

    return { read, written, dropped }
}

function refuse(message, out, env) {
    warning(message, out)
    summary(`### Staging was not seeded\n\n${message}\n`, env)
    setOutput('seeded', 'false', env)
    return 0
}

export async function main({ runner = runAws, env = process.env, out = console.log, options = {} } = {}) {
    const source = env.SOURCE_TABLE
    const target = env.TARGET_TABLE
    const sanitizerPath = env.SANITIZER || 'scripts/sanitize-seed.js'

    try {
        // Order matters. Both refusals are decided before anything reads the
        // production table, so a deploy that cannot seed safely never pulls
        // the data out in the first place.
        assertSeedableEnvironment(env.ENVIRONMENT)
        assertSeedableTable(target)
        if (!source) throw new Error('seed needs a source table')
        if (source === target) throw new Error(`seed refuses to copy ${source} onto itself`)

        const sanitize = await loadSanitizer(sanitizerPath)
        if (!sanitize) {
            return refuse(
                `${sanitizerPath} does not exist, so nothing was copied out of ${source}. This project's production data can `
                + 'only leave the production table through a sanitizer this project writes — the template cannot know which '
                + `attributes are sensitive. Copy scripts/sanitize-seed.example.js to ${sanitizerPath}, make it redact or drop `
                + `whatever must not exist in ${SEEDABLE_ENVIRONMENT}, and redeploy. Until then staging runs against an empty table.`,
                out,
                env,
            )
        }

        if (!tableExists(runner, source)) {
            return refuse(`${source} does not exist yet — there is nothing to seed from. Staging runs against an empty table.`, out, env)
        }

        if (env.CLEAR_TARGET !== 'false') {
            const deleted = await clearTable(runner, target, tableKeyNames(runner, target), options)
            notice(`Cleared ${deleted} existing items from ${target}.`, out)
        }

        const result = await copySanitized(runner, { source, target, sanitize }, options)
        const message = `Seeded ${target} with ${result.written} sanitized items from ${source} (${result.read} read, ${result.dropped} dropped by the sanitizer).`
        notice(message, out)
        summary(`### Staging seeded\n\n${message}\n`, env)
        setOutput('seeded', 'true', env)
        return 0
    } catch (err) {
        error(`seed failed: ${(err?.message ?? String(err))} ${awsErrorText(err).includes('An error occurred') ? awsErrorText(err).trim() : ''}`.trim(), out)
        setOutput('seeded', 'false', env)
        return 1
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().then((code) => process.exit(code))
}

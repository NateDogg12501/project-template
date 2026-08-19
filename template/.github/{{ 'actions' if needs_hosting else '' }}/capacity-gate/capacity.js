import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { awsErrorText, runAws, runAwsJson } from '../lib/aws.js'
import { error } from '../lib/log.js'

// DynamoDB's always-free allowance is 25 read and 25 write capacity units,
// shared by every table in every project in one AWS account and region. The
// default threshold leaves headroom for the table this deploy is about to
// create, which is not in the sum yet.
export const ALWAYS_FREE_UNITS = 25
export const DEFAULT_THRESHOLD = 20

// ListTables returns at most 100 names per call. This bound only exists so a
// backend that never stops returning LastEvaluatedTableName can't spin
// forever; 1000 pages is 100,000 tables, far past any account this gate runs
// against.
const MAX_PAGES = 1000

function units(value) {
    const n = Number(value)
    return Number.isFinite(n) ? n : 0
}

// Paginated by hand rather than by letting the AWS CLI do it. The CLI does
// auto-paginate `list-tables` today, but that is a CLI default and not a
// promise: the day it changes, or the day someone adds `--max-items`, this
// gate would quietly start summing the first hundred tables and calling the
// account healthy. Explicit pagination is a behaviour of ours, and it is the
// thing the tests pin.
export function listTableNames(runner) {
    const names = []
    let startAfter

    for (let page = 0; page < MAX_PAGES; page += 1) {
        const args = ['dynamodb', 'list-tables', '--no-paginate', '--output', 'json']
        if (startAfter) args.push('--exclusive-start-table-name', startAfter)

        const response = runAwsJson(runner, args)
        names.push(...(response.TableNames ?? []))

        const next = response.LastEvaluatedTableName
        if (!next) return names
        // Without this, a backend that echoes the same cursor back turns into
        // an infinite loop that burns Actions minutes rather than failing.
        if (next === startAfter) {
            throw new Error(`list-tables returned the same cursor twice (${next}) — refusing to loop`)
        }
        startAfter = next
    }

    throw new Error(`list-tables did not finish within ${MAX_PAGES} pages`)
}

export function describeTable(runner, name) {
    return runAwsJson(runner, ['dynamodb', 'describe-table', '--table-name', name, '--output', 'json'])
}

// Every global secondary index carries provisioned throughput of its own and
// it counts against the same allowance as the table's — summing only the
// table's own numbers is the obvious way to under-report, which for a gate
// means passing when it should have failed.
//
// On-demand (PAY_PER_REQUEST) tables report zero provisioned capacity, so they
// drop out of the sum on their own. That is deliberate rather than incidental:
// only provisioned capacity counts against the 25. Nothing here branches on
// BillingMode to achieve it — the number is the truth, and `BillingModeSummary`
// is absent altogether on a table whose billing mode was never changed.
// Local secondary indexes are correctly ignored: they share the table's
// throughput rather than holding their own.
export function tableCapacity(describeOutput) {
    const table = describeOutput?.Table ?? {}
    const provisioned = table.ProvisionedThroughput ?? {}

    const indexes = (table.GlobalSecondaryIndexes ?? []).map((index) => ({
        name: index.IndexName ?? '(unnamed index)',
        read: units(index.ProvisionedThroughput?.ReadCapacityUnits),
        write: units(index.ProvisionedThroughput?.WriteCapacityUnits),
    }))

    const read = units(provisioned.ReadCapacityUnits) + indexes.reduce((sum, i) => sum + i.read, 0)
    const write = units(provisioned.WriteCapacityUnits) + indexes.reduce((sum, i) => sum + i.write, 0)

    return {
        name: table.TableName ?? '(unnamed table)',
        billingMode: table.BillingModeSummary?.BillingMode ?? 'PROVISIONED',
        read,
        write,
        indexes,
    }
}

export function summarize(describeOutputs, threshold) {
    const rows = describeOutputs.map(tableCapacity)
    const totalRead = rows.reduce((sum, row) => sum + row.read, 0)
    const totalWrite = rows.reduce((sum, row) => sum + row.write, 0)

    // Read and write are separate allowances — 25 of each — so either one
    // over the threshold is over.
    const exceeded = []
    if (totalRead > threshold) exceeded.push('read')
    if (totalWrite > threshold) exceeded.push('write')

    return { rows, totalRead, totalWrite, threshold, exceeded, over: exceeded.length > 0 }
}

// "Over capacity" on its own sends someone to the console to work out which
// project is holding the units. Naming the tables lets them decide on the spot,
// which is the difference between a gate that gets fixed and a gate that gets
// raised.
export function render(summary, { region } = {}) {
    const where = region ? ` in ${region}` : ''
    const lines = [
        `DynamoDB provisioned capacity${where} — threshold ${summary.threshold} of the ${ALWAYS_FREE_UNITS}-unit always-free allowance`,
        '',
        `  ${'TABLE'.padEnd(48)}${'READ'.padStart(7)}${'WRITE'.padStart(8)}`,
    ]

    if (summary.rows.length === 0) {
        lines.push('  (no DynamoDB tables in this account and region)')
    }

    for (const row of summary.rows) {
        const suffix = row.read === 0 && row.write === 0 ? '  (nothing provisioned — not counted)' : ''
        lines.push(`  ${row.name.padEnd(48)}${String(row.read).padStart(7)}${String(row.write).padStart(8)}${suffix}`)
        for (const index of row.indexes) {
            lines.push(`    index ${index.name.padEnd(40)}${String(index.read).padStart(7)}${String(index.write).padStart(8)}`)
        }
    }

    lines.push(`  ${'-'.repeat(63)}`)
    lines.push(`  ${'TOTAL'.padEnd(48)}${String(summary.totalRead).padStart(7)}${String(summary.totalWrite).padStart(8)}`)

    return lines.join('\n')
}

// An unparseable threshold fails rather than falling back to the default. A
// gate that quietly substitutes a number nobody asked for is a gate whose
// answer nobody can trust.
export function parseThreshold(raw) {
    if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_THRESHOLD

    const value = Number(String(raw).trim())
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`threshold must be a non-negative number, got ${JSON.stringify(raw)}`)
    }
    return value
}

function parseArgs(argv) {
    const options = {}
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--threshold') options.threshold = argv[i + 1]
        // Test and local-debugging affordance only: reads pre-collected
        // describe-table output instead of calling AWS. Nothing in
        // action.yml passes it.
        if (argv[i] === '--fixture') options.fixture = argv[i + 1]
    }
    return options
}

export function main({ runner = runAws, argv = process.argv.slice(2), env = process.env, out = console.log } = {}) {
    try {
        const options = parseArgs(argv)
        const threshold = parseThreshold(options.threshold ?? env.THRESHOLD)
        const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || ''

        if (threshold >= ALWAYS_FREE_UNITS) {
            out(`::warning::capacity-gate threshold is ${threshold}, at or above the ${ALWAYS_FREE_UNITS}-unit always-free allowance — it cannot stop the account leaving the free tier.`)
        }

        const describeOutputs = options.fixture
            ? JSON.parse(readFileSync(options.fixture, 'utf8'))
            : listTableNames(runner).map((name) => describeTable(runner, name))

        const summary = summarize(describeOutputs, threshold)
        out(render(summary, { region }))

        if (summary.over) {
            error(
                `DynamoDB provisioned ${summary.exceeded.join(' and ')} capacity is over the ${threshold}-unit deploy threshold `
                + `(read ${summary.totalRead}, write ${summary.totalWrite} of ${ALWAYS_FREE_UNITS} always-free). `
                + 'Reduce provisioned capacity, or move a table to on-demand, before deploying. The breakdown above names every table holding units.',
                out,
            )
            return 1
        }

        return 0
    } catch (err) {
        // Any failure here — a denied API call, malformed output, a bad
        // threshold — fails the deploy. The one thing this must never do is
        // report "fine" because it could not look.
        error(`capacity-gate could not determine account DynamoDB capacity: ${awsErrorText(err).trim() || err}`, out)
        return 1
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exit(main())
}

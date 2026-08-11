import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
    ALWAYS_FREE_UNITS,
    DEFAULT_THRESHOLD,
    listTableNames,
    main,
    parseThreshold,
    render,
    summarize,
    tableCapacity,
} from '../capacity.js'

const SCRIPT = fileURLToPath(new URL('../capacity.js', import.meta.url))
const OVER = fileURLToPath(new URL('./fixtures/over-threshold.json', import.meta.url))
const UNDER = fileURLToPath(new URL('./fixtures/under-threshold.json', import.meta.url))

// A runner stands in for the AWS CLI: it is handed the argument array and
// returns what the CLI would have printed. Every call is recorded so the tests
// can assert on what was asked for, not just on what came back.
function fakeRunner(responses) {
    const calls = []
    return Object.assign(
        (args) => {
            calls.push(args)
            const response = responses.shift()
            if (response === undefined) throw new Error(`unexpected aws call: ${args.join(' ')}`)
            if (response instanceof Error) throw response
            return JSON.stringify(response)
        },
        { calls },
    )
}

function provisioned(name, read, write, indexes = []) {
    return {
        Table: {
            TableName: name,
            BillingModeSummary: { BillingMode: 'PROVISIONED' },
            ProvisionedThroughput: { ReadCapacityUnits: read, WriteCapacityUnits: write },
            ...(indexes.length ? { GlobalSecondaryIndexes: indexes } : {}),
        },
    }
}

function gsi(name, read, write) {
    return { IndexName: name, ProvisionedThroughput: { ReadCapacityUnits: read, WriteCapacityUnits: write } }
}

describe('tableCapacity', () => {
    it("counts every GSI's own throughput on top of the table's", () => {
        const capacity = tableCapacity(provisioned('items', 5, 5, [gsi('by-date', 3, 2), gsi('by-owner', 1, 1)]))

        expect(capacity.read).toBe(9)
        expect(capacity.write).toBe(8)
        expect(capacity.indexes).toHaveLength(2)
    })

    it('reports zero for an on-demand table, so it drops out of the sum', () => {
        const capacity = tableCapacity({
            Table: {
                TableName: 'items',
                BillingModeSummary: { BillingMode: 'PAY_PER_REQUEST' },
                ProvisionedThroughput: { ReadCapacityUnits: 0, WriteCapacityUnits: 0 },
                GlobalSecondaryIndexes: [gsi('by-date', 0, 0)],
            },
        })

        expect(capacity.read).toBe(0)
        expect(capacity.write).toBe(0)
        expect(capacity.billingMode).toBe('PAY_PER_REQUEST')
    })

    // A table whose billing mode was never changed comes back with no
    // BillingModeSummary at all. Reading the numbers rather than branching on
    // the mode is what makes that a non-event.
    it('counts a table that reports no BillingModeSummary', () => {
        const capacity = tableCapacity({
            Table: { TableName: 'legacy', ProvisionedThroughput: { ReadCapacityUnits: 7, WriteCapacityUnits: 3 } },
        })

        expect(capacity).toMatchObject({ read: 7, write: 3, billingMode: 'PROVISIONED' })
    })

    // LSIs share the table's throughput rather than holding their own, so
    // adding them would double-count.
    it('ignores local secondary indexes', () => {
        const capacity = tableCapacity({
            Table: {
                TableName: 'items',
                ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
                LocalSecondaryIndexes: [{ IndexName: 'by-sort' }],
            },
        })

        expect(capacity.read).toBe(5)
    })
})

describe('listTableNames', () => {
    it('follows LastEvaluatedTableName until the account is exhausted', () => {
        const runner = fakeRunner([
            { TableNames: ['a', 'b'], LastEvaluatedTableName: 'b' },
            { TableNames: ['c'], LastEvaluatedTableName: 'c' },
            { TableNames: ['d'] },
        ])

        expect(listTableNames(runner)).toEqual(['a', 'b', 'c', 'd'])
        expect(runner.calls).toHaveLength(3)
        expect(runner.calls[1]).toContain('--exclusive-start-table-name')
        expect(runner.calls[1]).toContain('b')
        // The first call must not carry a cursor, or it would start mid-list.
        expect(runner.calls[0]).not.toContain('--exclusive-start-table-name')
    })

    // The whole point of paginating: a truncated list makes the gate
    // under-report forever, and under-reporting looks exactly like passing.
    it('does not stop at the first page', () => {
        const runner = fakeRunner([
            { TableNames: ['over-the-limit'], LastEvaluatedTableName: 'over-the-limit' },
            { TableNames: ['second-page'] },
        ])

        expect(listTableNames(runner)).toContain('second-page')
    })

    it('refuses to loop when the cursor stops advancing', () => {
        const runner = fakeRunner([
            { TableNames: ['a'], LastEvaluatedTableName: 'a' },
            { TableNames: ['a'], LastEvaluatedTableName: 'a' },
        ])

        expect(() => listTableNames(runner)).toThrow(/same cursor twice/)
    })
})

describe('summarize', () => {
    it('is over when only the read side exceeds the threshold', () => {
        const summary = summarize([provisioned('items', 21, 1)], 20)

        expect(summary.over).toBe(true)
        expect(summary.exceeded).toEqual(['read'])
    })

    it('is over when only the write side exceeds the threshold', () => {
        const summary = summarize([provisioned('items', 1, 21)], 20)

        expect(summary.exceeded).toEqual(['write'])
    })

    it('is not over at exactly the threshold', () => {
        expect(summarize([provisioned('items', 20, 20)], 20).over).toBe(false)
    })
})

describe('render', () => {
    it('names every table and index holding units', () => {
        const summary = summarize([provisioned('kids-ledger-production-items', 5, 5, [gsi('by-date', 5, 5)])], 20)
        const text = render(summary, { region: 'us-east-1' })

        expect(text).toContain('kids-ledger-production-items')
        expect(text).toContain('by-date')
        expect(text).toContain('us-east-1')
        expect(text).toMatch(/TOTAL\s+10\s+10/)
    })
})

describe('parseThreshold', () => {
    it('defaults when nothing is supplied', () => {
        expect(parseThreshold(undefined)).toBe(DEFAULT_THRESHOLD)
        expect(parseThreshold('')).toBe(DEFAULT_THRESHOLD)
    })

    // Silently substituting the default for a typo would mean the gate answers
    // a question nobody asked.
    it('rejects a value it cannot parse rather than falling back', () => {
        expect(() => parseThreshold('twenty')).toThrow(/non-negative number/)
        expect(() => parseThreshold('-1')).toThrow(/non-negative number/)
    })
})

describe('main', () => {
    function capture() {
        const lines = []
        return Object.assign((line) => lines.push(String(line)), { lines, text: () => lines.join('\n') })
    }

    // The test this stage exists for. Per STANDARDS.md, the two worst
    // regressions this pipeline has had were both checks that passed having
    // verified nothing — so the gate's failing path is the one that has to be
    // pinned, not its passing path.
    it('fails over the threshold and prints the per-table breakdown', () => {
        const out = capture()
        const code = main({ argv: ['--fixture', OVER, '--threshold', '20'], env: {}, out })

        expect(code).toBe(1)
        expect(out.text()).toContain('::error::')
        expect(out.text()).toContain('kids-ledger-production-items')
        expect(out.text()).toContain('recipe-box-production-items')
        // 5 + 5 (GSI) + 8 + 0 (on-demand) + 4
        expect(out.text()).toMatch(/TOTAL\s+22\s+22/)
    })

    it('passes under the threshold', () => {
        const out = capture()

        expect(main({ argv: ['--fixture', UNDER, '--threshold', '20'], env: {}, out })).toBe(0)
        expect(out.text()).not.toContain('::error::')
    })

    it('reads the threshold from the environment when no flag is given', () => {
        const out = capture()

        expect(main({ argv: ['--fixture', UNDER], env: { THRESHOLD: '4' }, out })).toBe(1)
    })

    it('warns that a threshold at or above the allowance cannot gate anything', () => {
        const out = capture()
        main({ argv: ['--fixture', UNDER, '--threshold', String(ALWAYS_FREE_UNITS)], env: {}, out })

        expect(out.text()).toContain('::warning::')
    })

    // Failing closed is the whole contract: a denied ListTables must not read
    // as an empty account.
    it('fails when it cannot ask AWS at all', () => {
        const out = capture()
        const runner = fakeRunner([Object.assign(new Error('exit 254'), { stderr: 'AccessDeniedException' })])

        expect(main({ runner, argv: [], env: {}, out })).toBe(1)
        expect(out.text()).toContain('AccessDeniedException')
    })

    it('fails on an unparseable threshold', () => {
        const out = capture()

        expect(main({ argv: ['--fixture', UNDER, '--threshold', 'lots'], env: {}, out })).toBe(1)
    })

    it('describes every table the paginated list returned', () => {
        const out = capture()
        const runner = fakeRunner([
            { TableNames: ['a'], LastEvaluatedTableName: 'a' },
            { TableNames: ['b'] },
            provisioned('a', 1, 1),
            provisioned('b', 1, 1),
        ])

        expect(main({ runner, argv: ['--threshold', '20'], env: {}, out })).toBe(0)
        expect(runner.calls.filter((args) => args[1] === 'describe-table')).toHaveLength(2)
    })
})

// The unit tests above assert a return value; this asserts the thing the
// workflow actually observes, which is the process exit status.
describe('the script as the action runs it', () => {
    it('exits non-zero over the threshold', () => {
        let status = 0
        try {
            execFileSync(process.execPath, [SCRIPT, '--fixture', OVER, '--threshold', '20'], { encoding: 'utf8' })
        } catch (err) {
            status = err.status
        }

        expect(status).not.toBe(0)
    })

    it('exits zero under the threshold', () => {
        const output = execFileSync(process.execPath, [SCRIPT, '--fixture', UNDER, '--threshold', '20'], { encoding: 'utf8' })

        expect(output).toContain('TOTAL')
    })
})

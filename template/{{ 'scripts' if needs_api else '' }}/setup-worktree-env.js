#!/usr/bin/env node
// Auto-assigns non-colliding host ports for this checkout's .env so that
// multiple git worktrees of this repo can each run `docker compose up` at
// the same time. Generalized from MokapiExample's version: instead of a
// hardcoded port list, it scans .env.example for any KEY=NUMBER line whose
// key ends in "_PORT" and offsets all of them — so adding a new *_PORT
// variable to .env.example is enough, no edit needed here.
//
// How it decides ports: lists all worktrees for this repo and finds this
// checkout's position in that list. Position 0 (the primary checkout) keeps
// the default ports. Every other position gets an offset of 20 * position
// added to each base port — big enough that no worktree's ports can ever
// collide with another's.

import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const repoRoot = execSync('git rev-parse --show-toplevel').toString().trim()

const worktreePaths = execSync('git worktree list --porcelain')
    .toString()
    .trim()
    .split('\n\n')
    .map((block) => block.split('\n')[0].replace(/^worktree /, ''))
    .map((p) => path.resolve(p))

const index = worktreePaths.indexOf(path.resolve(repoRoot))
const offset = index > 0 ? index * 20 : 0

const envPath = path.join(repoRoot, '.env')
const examplePath = path.join(repoRoot, '.env.example')

const exampleContent = fs.readFileSync(examplePath, 'utf8')

let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : exampleContent

const portKeys = [...exampleContent.matchAll(/^([A-Z0-9_]*_PORT)=(\d+)/gm)]
    .map(([, key, value]) => [key, Number(value)])

if (portKeys.length === 0) {
    console.log('No *_PORT keys found in .env.example — nothing to offset.')
    process.exit(0)
}

const assigned = {}
for (const [key, baseValue] of portKeys) {
    assigned[key] = baseValue + offset
    const re = new RegExp(`^#?${key}=.*$`, 'm')
    const line = `${key}=${assigned[key]}`
    envContent = re.test(envContent) ? envContent.replace(re, line) : `${envContent}\n${line}\n`
}

fs.writeFileSync(envPath, envContent)

const summary = Object.entries(assigned).map(([k, v]) => `${k}=${v}`).join(', ')
if (offset > 0) {
    console.log(`Worktree detected (position ${index} of ${worktreePaths.length}) — assigned ${summary} in .env`)
} else {
    console.log(`Primary checkout — using default ports: ${summary} in .env`)
}

import { defineConfig } from 'vitest/config'

// Nearly empty, and it still has to exist — without a config here vitest
// searches upward, finds backend/'s or frontend/'s, and reports "No test files
// found" while exiting 0. See STANDARDS.md's "Testing".
export default defineConfig({
    test: {
        // One directory per stage, each with its own test/ — so a stage stays
        // separable: deleting the directory takes its tests with it and
        // nothing else notices.
        include: ['*/test/**/*.test.js'],
        environment: 'node',
    },
})

import { defineConfig } from 'vitest/config'

// This file ships even though it is barely more than vitest's defaults, and
// that is the point: with no config *in this package*, vitest searches upward
// from here, and a config belonging to an unrelated parent directory wins.
// The failure is silent — vitest reports "No test files found" and exits 0, so
// CI stays green while testing nothing. Don't delete it because it looks empty.
export default defineConfig({
    test: {
        environment: 'node',
        include: ['test/**/*.test.js'],
    },
})

# Deploy pipeline stages

One directory per stage, each a composite action that `../workflows/deploy.yml`
calls in order. `deploy.yml` sequences; the logic lives here. See
[`docs/deploy.md`](../../docs/deploy.md) for what each stage does, how the
deploy is triggered, and the `deploy-result.json` contract the orchestrator
reads.

## Adding a stage

A stage is contributed by a capability, the same way a CI job is — see
[STANDARDS.md](https://github.com/NateDogg12501/project-template/blob/main/STANDARDS.md)'s
"The contract". Concretely:

1. `<stage>/action.yml` — a composite action taking everything it needs as
   inputs. No stage reads a repository variable or a project name directly;
   `deploy.yml` is where project-specific values are filled in, which is what
   keeps a stage runnable on its own.
2. `<stage>/<stage>.js` — if it is more than a few lines of shell. Node is
   preinstalled on the runner and these scripts have no dependencies, so the
   stage needs no `npm install` at deploy time.
3. `<stage>/test/` — its own tests, picked up by `vitest.config.js` here and
   run by CI's `pipeline-stages` job.
4. A step in `deploy.yml`, gated on the capability that owns the stage.

There is deliberately **no registry** — no manifest that says "DATABASE
contributes `seed`" with machinery to assemble the workflow from it. Stages are
separable so that one can be written later; assembling them declaratively is an
extension point with one consumer today, which is how extension points end up
wrong. `docs/decisions.md` in project-template records that as deferred.

## Testing

```bash
npm ci
npm test
```

Anything that talks to AWS takes its runner as a parameter (`lib/aws.js`), so
pagination, retries and refusals are exercised against recorded calls rather
than against an account. That indirection is the only reason these are testable
at all.

# CD Pipeline — Requirements & Phasing (rev 3.1)

**Living design document.** This file describes the four-repo continuous deployment pipeline across terraform-modules, project-template, idea-workflow, and kids-ledger. It is versioned and revised as implementation progresses. See `STANDARDS.md` for how cross-repo design documents are kept.

---

Jira-gated continuous deployment across terraform-modules, project-template, idea-workflow, and kids-ledger.

Status: requirements settled; phasing in Part 6; execution prompts in cd-pipeline-handoffs/. Rev 3.1 date: 2026-08-09

rev 3.1 — one correction found while writing the execution prompts: Jira Automation needs three rules, not two. A human gate has no orchestrator running to chain from. See C8.

## What changed since rev 2

|   | Change | Driver |
|---|---|---|
| 1 | One shared Terraform state bucket for all projects, keyed <project>/<env>/terraform.tfstate. Removes state_bucket_name from copier.yml entirely. | Your question. It's the better design and it deletes a per-project bootstrap step. |
| 2 | Shared auth credentials at /shared/* in SSM, not per project. | Your note. |
| 3 | Nothing is manual after a one-time account bootstrap. Per-project OIDC roles and session secrets are created by the pipeline. | Your note, repeated three times. Fair. |
| 4 | New account-scoped repo (aws-account) holding OIDC provider, shared bucket, shared secrets, budgets, and the provisioner role. | Falls out of 1–3. |
| 5 | Account capacity gate — a real check that sums provisioned DynamoDB capacity across the account and fails the deploy. | Your "can anything be driven by counting dynamo tables?" — yes, and it plugs the exact hole the per-module gate can't. |
| 6 | Ready for Review renamed PR Ready; hosted flow terminates at Deployed (Done). Non-hosted handling explicitly deferred. | Your note. You're right that it was badly named. |
| 7 | Target repo becomes a Jira dropdown; base_branch dropped. Plan schema → v3. | Your note. |
| 8 | Stages composed now (composite actions), stage registry deferred. | Your question — answered in C6. |
| 9 | AWS account assumption corrected. | Your correction. It changes the risk, not the requirement. |
| 10 | Liquibase reframed — it doesn't apply to DynamoDB. Added properly to deferred. | Your note. |
| 11 | Part 7: how cross-project context is kept, with kids-ledger named as the flagship. | Your question. |
| 12 | Part 6: phasing. | You said go. |

## Part 0 — Responses to this round

### One state bucket for everything, not one per project

Agreed, and it's better than what rev 2 had. Adopting it.

```
s3://<account>-tfstate/
    kids-ledger/staging/terraform.tfstate
    kids-ledger/production/terraform.tfstate
    recipe-box/staging/terraform.tfstate
```

What it buys beyond simplicity:

- state_bucket_name disappears from copier.yml — along with its 3–63-character lowercase-no-underscores validator, which existed only because S3 bucket names are a single global namespace. One bucket, named once, ever.
- Per-project terraform/bootstrap/ disappears. That directory exists solely to create the project's state bucket. With a shared bucket there's nothing per-project left to bootstrap.
- One lifecycle policy, one versioning setting, one place to look.
- S3-native locking (use_lockfile) is per-key, so no contention between projects.

The one thing it costs, and the mitigation: blast radius. A misconfigured policy could let project A read or write project B's state. Fix it in IAM rather than in bucket topology — each project's deploy role gets s3:*Object scoped to arn:aws:s3:::<bucket>/<project>/* and nothing wider. That's a standard prefix-scoped policy, and it's generated per project by the provisioner (B3), so it can't be forgotten.

Note backend.tf still can't interpolate — but this actually helps: the bucket is now a constant across every project, so the literal is fine and only the key varies, which is already passed at init.

### Jira status naming

You're right, and both halves of your read are right.

- Ready for Review → PR Ready. Cheap to do: STATUS_READY_FOR_REVIEW is already a repo variable, so it's a Jira status rename plus a variable update.
- Deployed is the Done-category terminal for the hosted flow. Confirmed — that's what C1 does.
- Non-hosted is deferred, not designed around. Since most projects will be hosted, a non-hosted build simply terminates at PR Ready and stops. No routing complexity, no category gymnastics.

Does deferring it cost anything later? No. The branch point is one if in Phase B (is this repo deployable? — C3), and it has to exist regardless because the answer can be "no" for a repo that isn't yours. Deferring means not building a second terminal path, not skipping a decision that gets more expensive.

### Target repo as a dropdown; drop base_branch

Agreed on both, and this is squarely what your own feedback loop predicted. assumptions:report exists to surface "plan answers ordered by how often they get hand-edited," and describes that ranking as the intake backlog — a field humans keep fixing is a question the intake form should be asking instead of letting the architect guess. target.repo is the canonical example.

Jira: a single-select custom field, options synced from the GitHub org's repo list. setup/fields.ts already creates custom fields; this adds option-list support plus a jira:repos:sync command.

base_branch is dropped. Always main. Your instinct is right: a change against a non-main branch is rare enough that a comment plus re-plan is the correct handling, not a field on every ticket forever.

Plan schema → version: 3. Removing a field is exactly the "tightening validation" case docs/payload-contract.md says needs a version bump. v2 plans normalize forward with base_branch ignored.

### Your AWS account — corrected, and it raises the stakes

You're right that the account is post-2025-07-15. But note what "upgraded to paid" means under the new model:

| Plan | When credits run out |
|---|---|
| Free | AWS shuts the account down. No bill. |
| Paid ← you | Billing starts at standard on-demand rates immediately. No shutdown. |

So the safety net I assumed you might have from a legacy account, you also don't have from a new one — the Paid plan is specifically the variant that bills rather than stops. A1 gets more important, not less.

Two things I cannot check from here and need you to confirm in the console:

- Whether budgets already exist — Billing → Budgets. (I have no AWS credentials in this session and shouldn't.)
- Your remaining credit balance and expiry — Billing → Credits. Worth knowing, because the day credits run out is the day charges start silently.

Yes, budgets can be Terraform. aws_budgets_budget is a first-class resource. It goes in the account bootstrap (A1/P2), so the guardrail is version-controlled rather than click-configured. If budgets already exist, the Terraform either imports them or replaces them — worth deciding once you've looked.

### Counting DynamoDB tables as a gate — yes, and it's the missing piece

This is a good idea and it plugs the exact hole the per-module gate structurally cannot.

The account capacity gate: before any apply, call ListTables, then DescribeTable on each, and sum ProvisionedThroughput across the region. Fail the deploy if the total exceeds a threshold (recommend 20 of 25, leaving headroom for the table about to be created).

Why it works where the module gate doesn't: dynamodb-single-table's precondition computes within_always_free from its own read_capacity + write_capacity + GSIs ≤ 25. It's correct and it's honest about its limit — five projects can each pass at 6 units and collectively sit at 30. The account gate sees the sum.

Two details:

- On-demand tables report zero provisioned capacity, so they're correctly ignored — only provisioned capacity counts against the 25.
- It runs as a stage in the deploy pipeline (C6), using the deploy role, which needs dynamodb:ListTables and dynamodb:DescribeTable added. Also runnable as a scheduled check.

This becomes the account-level half of A1, alongside the budget.

### No manual steps — how far that can actually go

Taking this seriously, here's the honest floor.

What becomes fully automatic:

| Was manual | Now |
|---|---|
| Create the project's state bucket | Gone — shared bucket (B2) |
| Create per-project OIDC deploy roles | Pipeline does it via the provisioner role (B3) |
| aws ssm put-parameter for SESSION_SECRET | Pipeline generates it if absent (B4) |
| aws ssm put-parameter for auth credentials | Gone — shared at /shared/* (B4) |

What cannot be: the very first account bootstrap. The OIDC identity provider must exist before anything can assume a role via OIDC — you cannot bootstrap OIDC over OIDC. So one terraform apply runs with real admin credentials, once, ever, for the whole account. After that everything is keyless and automatic, including every future project.

That's a materially different proposition from rev 2's "one manual step per project."

Session secret — one adjustment to what you proposed. You said you're fine pushing a session secret on deploy. Regenerating it on every deploy invalidates every active session, so everyone gets logged out each time you ship. Recommend generate-if-absent: first deploy to an environment creates it, subsequent deploys leave it alone. Same automation, no logout churn, and rotation stays a deliberate act (delete the parameter, redeploy).

Shared username/password — accepted, with the trade-off named. One credential across all projects means one compromise reaches all of them, and you can't revoke access to one project without revoking all. For personal/demo projects that's a reasonable trade. Keep the SSM path a variable rather than a hardcoded /shared/... so moving a project to its own credential later is a value change, not a code change.

### Composing stages now — no reason not to, with one carve-out

Build the stages now. Defer the registry.

The stages themselves — capacity-gate, terraform-apply, seed, smoke-test — cost essentially nothing extra to write as composite actions (.github/actions/<stage>/action.yml) called from a thin deploy.yml, versus writing the same logic inline. And retrofitting composition later means rewriting a workflow that by then has real behaviour in it. So compose from the start.

What should wait is the declarative capability→stage registry — a manifest that says "DATABASE contributes seed and data-integrity-check," with machinery to assemble the workflow from it. That's real infrastructure with exactly one consumer today. Building it now means designing an extension point against a single example, which is how extension points end up wrong. Write the stages as separable units; let the second and third capability tell you what the registry should look like.

### Liquibase — it doesn't apply to DynamoDB, and the real need is different

Liquibase and Flyway are relational schema-migration tools: versioned DDL, ordered changesets, a tracking table. DynamoDB has no schema to migrate — tables are attribute-free except for keys, and index changes are structural rather than declarative.

So there are two distinct future needs, and only one of them is Liquibase:

1. A relational capability (RDS/Postgres, or Aurora Serverless). That's where Liquibase or Flyway belongs, as a db-migrate stage owned by that capability. Note it's a genuine cost decision — RDS is not in Always Free beyond the intro period.
2. DynamoDB data migrations — backfills, attribute renames, key reshapes. Index changes are Terraform's job; data changes need a migrations/ convention and a runner. Same shape as Liquibase (ordered, versioned, tracked, run-once) but a different tool, most likely a small in-repo script.

Both are in Part 5 (deferred). Worth recording now because #2 will bite before #1 does.

## Part 1 — Current state

### idea-workflow

Two workflows dispatched from Jira Automation on destination status. Nine statuses and thirteen directed transitions generated from orchestrator/src/setup/statuses.ts, provisioned by jira:provision:apply via setup/workflow.ts. Two managed workflows (one scoped to Idea alone so the intake gate applies without hitting other types).

README: "Still deliberately absent: any deploy step. Every path stops at a pull request."

### project-template

Copier. Capabilities: needs_api, needs_ui, needs_hosting, needs_datastore. Terraform has an S3 backend plus a per-project bootstrap/. CI enforces tag-pinned module sources and fails if it finds zero pinned sources.

Governing rule: a capability owns its files, its tests, and its CI job.

### terraform-modules

lambda-web-app, dynamodb-single-table, s3-bucket. Tag-pinned, cost_acknowledged preconditions.

Verified this round: dynamodb-single-table already supports PAY_PER_REQUEST, and within_always_free already treats on-demand as billable so the gate fires correctly. No module change is needed for B5. Naming can also stay at the root-config level (the modules take app_name/table_name as plain strings), so no module change is needed for environment parameterization either. That shrinks P1 to the OIDC modules alone.

### kids-ledger

Local committed terraform.tfstate, no backend.tf, environment-free resource names, no deploy workflow, dist-lambda.zip committed. Already has backend/Dockerfile and docker-compose.yml.

## Part 2 — Target model

### Environments are an ordered list

```yaml
environments:
  - name: staging
    promotes_to: production
    auto_deploy: true
    jira_status: Staging Review
  - name: production
    promotes_to: null
    auto_deploy: false
    jira_status: Deployed
```

Adding a third environment is a list entry plus a Jira status. Nothing counts to two.

### The flow

```
Spec Review ──[Build Plan]──► Approved ──► Building ──► (PR open, CI green)
                                                            │  auto_deploy: true
                                                            ▼
                                            Deploying to Staging ──► apply(staging)
                                                            │
                                                            ▼
                                                    Staging Review   ◄── manual review
                                                            │
                                                       [Ship It]     ← human gate
                                                            ▼
                                            Deploying to Production ──► merge → main
                                                            │            apply(production)
                                                            ▼
                                                    Deployed  (Done)
```

Non-hosted builds terminate at PR Ready (Done) and stop. Deferred, not designed around.

### Capabilities grow a pipeline dimension

| Capability | Files | Tests | CI job | Pipeline stages (new) |
|---|---|---|---|---|
| API | backend/ | vitest | backend | — |
| UI | frontend/ | vitest | frontend | — |
| HOSTED | terraform/ | — | terraform | capacity-gate, terraform-apply, smoke-test |
| DATABASE | tf blocks | — | rides HOSTED | seed |

Stages are built as composite actions now; the registry that assembles them from capability declarations is deferred (Part 0).

## Part 3 — Requirements

### A — Foundations

#### A1. Cost guardrails, in Terraform, with a real account-level gate

Your account is on the Paid plan, which bills rather than stops. Two mechanisms, both account-scoped, both in the aws-account config:

- aws_budgets_budget — a zero-spend budget with email notification at the first cent. Version-controlled, not click-configured. Confirm what already exists before this runs.
- The account capacity gate — sums provisioned DynamoDB capacity across the region and fails the deploy above a threshold (default 20 of 25). Runs as a pipeline stage before every apply. This is the account-wide check the per-module cost_acknowledged precondition structurally cannot be.
- Free Tier usage alerts enabled.
- A doctor-style check that all three exist, matching the modules:doctor / gh:doctor pattern. A guardrail nobody verifies is a guardrail that silently isn't there.

#### A2. Environments are declared as an ordered list

No code may assume exactly two.

#### A3. Local / CI parity via docker compose + amazon/dynamodb-local

docker compose up -d --build stays the "run this locally" standard. DATABASE projects add amazon/dynamodb-local — official AWS image, free forever, no account, no auth token. The same compose stack runs in CI as the integration gate before any AWS is touched.

Gives 1:1 between local and CI. Does not give 1:1 with deployed staging, and shouldn't be sold as doing so.

#### A4. The datastore endpoint is configuration, not an abstraction layer

The AWS SDK honours AWS_ENDPOINT_URL_DYNAMODB. Set it → DynamoDB Local; unset → real DynamoDB. The code path is byte-identical, which is the point: a hand-written abstraction means local and deployed exercise different code, and the bugs live in the difference.

Standard to add: one place constructs the SDK client and reads the endpoint from environment. That single choke point is the "clean separation" — one file, not a repository pattern.

### B — Infrastructure

#### B1. Environment-parameterized Terraform

terraform/ takes an environment variable threaded into resource names and SSM paths: kids-ledger-staging, kids-ledger-staging-transactions. Composed at the root config, so no terraform-modules change is required.

#### B2. One shared state bucket

s3://<account>-tfstate/<project>/<environment>/terraform.tfstate, supplied at init via -backend-config="key=...". Bucket created once in the account bootstrap.

Removes state_bucket_name and its validator from copier.yml, and removes per-project terraform/bootstrap/ entirely. Isolation is enforced by prefix-scoped IAM per project, not by separate buckets.

#### B3. OIDC: account-level provider, pipeline-created project roles

Account bootstrap creates: the GitHub OIDC identity provider, and a provisioner role that idea-workflow's repo can assume.

The pipeline creates, per project: two deploy roles (staging, production). Trust policy pins repo:<org>/<name>:ref:refs/heads/main for production; staging accepts any ref from that repo. That pin is the "only main deploys to prod" guarantee, enforced by AWS rather than YAML.

The provisioner role can create IAM roles, which is powerful. Constrain it:

- A permissions boundary on every role it creates, so a created role can never exceed the boundary regardless of what policy is attached.
- An IAM path prefix (/project-deploy/) with an iam:PermissionsBoundary condition, so it can only create roles in that path and only with that boundary.
- Scoped to creating roles, not users, and no iam:PassRole beyond what it creates.

New terraform-modules modules: github-oidc-provider (account) and github-oidc-deploy-role (per project). Name the prerequisite vs application module distinction in the modules README so the repo doesn't drift into a junk drawer.

#### B4. Secrets: shared where possible, generated where not

| Secret | Scope | How |
|---|---|---|
| AUTH_USERNAME, AUTH_PASSWORD_HASH | Shared across all projects at /shared/auth_* | Created once in account bootstrap |
| SESSION_SECRET | Per project per environment | Generated if absent on deploy; left alone if present |

The SSM path stays a variable, not a hardcoded /shared/..., so moving a project onto its own credential later is a value change.

Trade-off recorded: one shared credential means one compromise reaches every project, and you cannot revoke one project without revoking all.

#### B5. Staging datastore: a real on-demand DynamoDB table

Reseeded from a sanitized prod export. No module change needed — dynamodb-single-table already supports PAY_PER_REQUEST and its gate already treats it as billable.

Honest arithmetic for a hand-clicked staging app (~2,000 writes + 10,000 reads/month): under half a cent per month, ~$0.05/year per project. Storage is KB-scale, inside the free 25 GB.

Why not the alternatives:

| Alternative | Why not |
|---|---|
| Provisioned 1/1 (literally $0.00) | Holds 2 of the account-wide 25 as a standing reservation whether used or not, and staging traffic is bursty — exactly what on-demand bills better for. Still a real option if you want the literal zero. |
| amazon/dynamodb-local on a server | Needs a persistent host, and DynamoDB Local has no authentication — a public one is wide open. Adding a server to secure, to save $0.05/year. |
| Sidecar into the Lambda | Doesn't work — see below. |
| Share prod's table with a prefix | Removes the isolation staging exists for. |

Why "database inside the Lambda" cannot work. Lambda does have external extensions — separate processes in the same execution environment, which is how the Lambda Web Adapter you already use works — so the mechanism is real. It fails on: image size (~1 GB vs a 250 MB zip limit); cold start (10–30 s boot plus reseed); concurrency (two warm environments = two divergent databases); and fatally, durability — the execution environment is frozen between invocations and destroyed after idleness, and /tmp does not survive that. Every cold start hands you an empty database, failing nondeterministically. This kills every datastore-in-the-Lambda design identically.

The reason to use a real staging table is durability, not cost.

Carried details: export prod via Scan, not PITR export (PITR bills per GB-month); and sanitization is a real tested step — kids-ledger's data is children's names and transaction history.

### C — Pipeline

#### C1. Statuses and transitions

New (pipeline-set): Deploying to Staging, Staging Review, Deploying to Production, Deployed (Done), Deploy Failed.

New human transitions: Ship It, Retry Deploy, Reject Staging (→ Needs Decision).

Renamed: Ready for Review → PR Ready (stays Done-category; terminal for non-hosted only). Cheap because STATUS_READY_FOR_REVIEW is already a repo variable.

Per the load-bearing note in statuses.ts: every new transitionTo needs a matching directed edge in the same change, or the deploy succeeds while the ticket silently doesn't move.

#### C2. Orchestration: hybrid

```
Jira Automation ──dispatch──► idea-workflow (Phase C/D)
                                   │  resolves target repo
                                   │  gh workflow run deploy.yml --field environment=staging
                                   ▼
                        generated repo's deploy.yml
                                   │  OIDC assume → stages → terraform apply
                                   ▼
                        idea-workflow polls run, moves ticket
```

Jira Automation stays at one rule pair and one token. AWS trust stays scoped per-repo. Deploy logic lives in project-template. All Jira writes stay in idea-workflow, so statuses.ts remains the single source of truth.

#### C3. How the pipeline knows a project is deployable

Does .github/workflows/deploy.yml exist in the target repo? If gh workflow run 404s, it isn't deployable. The thing that does the deploying answers whether deploying is possible, so it cannot go stale relative to itself.

#### C4. Intake: target repo is a dropdown

Single-select Jira field, options synced from the GitHub org. base_branch dropped; always main. Plan schema → v3; v2 normalizes forward.

#### C5. Artifact strategy — a ladder

| Rung | What | Promotion? | Parity | Cost | Module change |
|---|---|---|---|---|---|
| 1 — v1 | Build at deploy time from the branch (staging) and main (prod). Zip. | No | Partial | $0 | none |
| 2 | Build once, tag by SHA, store the zip in the shared state bucket. Prod deploys the exact artifact staging ran. | Yes | Partial | ~$0.01/mo | lambda-web-app gains optional source_s3_bucket/source_s3_key |
| 3 | Container image in ECR, same image everywhere. | Yes | Full | ECR: 500 MB free 12 months only, then $0.10/GB-mo | lambda-web-app reworked (MAJOR) |

Rung 3 is technically clean — Lambda Web Adapter supports container images with one COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:<ver> /lambda-adapter /opt/extensions/lambda-adapter line, and backend/Dockerfile already exists. The objections are that ECR is not Always Free, container Lambdas cold-start slower, and it's a MAJOR module bump every project re-pins.

Ship rung 1; plan rung 2 next; treat rung 3 as its own milestone. A3 (compose + dynamodb-local locally) is independent of all three.

#### C6. Deploy workflow is composed stages

deploy.yml takes an environment input and calls composite actions in .github/actions/:

| Stage | Owner | Does |
|---|---|---|
| capacity-gate | template | Sums account DynamoDB provisioned capacity; fails above threshold |
| ensure-secrets | template | Generates SESSION_SECRET if absent |
| terraform-apply | HOSTED | init -backend-config=key=... → plan → apply |
| seed | DATABASE | Reseeds staging from sanitized prod export |
| smoke-test | HOSTED | Hits the Function URL health path; fails the deploy if it doesn't answer |

Registry deferred; separability is not.

#### C7. Actions minutes

2,000 min/mo private, hard stop, no bill. A full ticket ≈ 15–25 min end to end → 80–130 tickets/month. Not a constraint; stated so nothing casually adds a 30-minute idle poll.

#### C8. Jira Automation: three rules, not two (correction, rev 3.1)

Rev 3's assumption 5 said Automation stays at two rules because "new triggers are chained by the orchestrator." That is true for staging and false for production, and the difference is where the human is.

Phase C (staging) is chained by Phase B — orchestrator to orchestrator, no rule needed.

But Ship It is a human pressing a button in Jira. No orchestrator is running at that moment, so nothing exists to chain from. Only a Jira Automation rule can bridge Jira → GitHub.

| Rule | Trigger status | event_type | Fires |
|---|---|---|---|
| 1 (existing) | Ready to Build | idea-plan | Phase A |
| 2 (existing) | Approved | idea-build | Phase B → chains Phase C |
| 3 (new) | Deploying to Production | idea-ship | Phase D |

Same shape as the others, and it inherits their reasoning: trigger on destination status, never on a transition name. Both Ship It and Retry Production Deploy land in Deploying to Production, and both must fire.

Single-project rules don't count against the Free plan's global execution limit, so this stays free. The general principle rev 3 was reaching for still holds — every trigger that can be chained, is — it just isn't every trigger. A human gate needs a rule by construction.

### D — Migration

#### D1. kids-ledger (disposable)

terraform destroy, copier update onto the new template, deploy as kids-ledger-production through the pipeline itself. Data lost by agreement. Git history still demonstrates the journey.

## Part 4 — Decisions log

| # | Decision | Chosen | Rev |
|---|---|---|---|
| D1 | Platform | GitHub Actions | 1 |
| D2 | Orchestration | Hybrid — orchestrator dispatches, target repo applies | 1 |
| D3 | Artifact strategy | Ladder: rung 1 now, 2 next, 3 deliberate | 2 |
| D4 | Staging datastore | Real on-demand table, seeded from sanitized prod | 1 |
| D5 | kids-ledger | Disposable | 1 |
| D6 | Env isolation | Single account, name-suffixed | 1 |
| D7 | AWS auth | OIDC; account provider + pipeline-created project roles | 3 (revised) |
| D8 | Local/CI datastore | amazon/dynamodb-local; LocalStack dropped | 2 |
| D9 | Environment model | Ordered list | 2 |
| D10 | Deployability signal | Presence of deploy.yml | 2 |
| D11 | Terraform state | One shared bucket, prefix-scoped IAM | 3 |
| D12 | Auth credentials | Shared at /shared/*; path stays a variable | 3 |
| D13 | SESSION_SECRET | Generated if absent, not on every deploy | 3 |
| D14 | Account cost gate | Sum provisioned DynamoDB capacity; fail above 20/25 | 3 |
| D15 | Intake | Target repo dropdown; base_branch dropped; Plan v3 | 3 |
| D16 | Stage composition | Composite actions now; registry deferred | 3 |

### Standing assumptions

- Staging is one shared environment per project. One ticket in Staging Review at a time.
- Deploy to staging is automatic after a green build.
- Deploy lives inside HOSTED, not a new needs_cd flag.
- Ship It squash-merges; production deploys are triggered explicitly, not by on: push: main.
- Jira Automation goes to three rules, not two. (Corrected in rev 3.1 — see C8.)
- Rollback out of scope for v1 — Deploy Failed, fix forward.
- Non-hosted projects terminate at PR Ready. No second terminal path built.
- A new aws-account repo is acceptable. If you'd rather it live inside idea-workflow as infra/, say so — it changes P2's location and nothing else.

### Known limitations accepted for v1

- Prod rebuilds from main rather than promoting the reviewed artifact (rung 1).
- Per-module cost_acknowledged can't see account totals — now mitigated by D14.
- Container-image parity deferred (rung 3).
- One terraform apply with admin credentials, once ever, to bootstrap the account.
- One shared credential across projects; no per-project revocation.

## Part 5 — Deferred

| Want | Door kept open by |
|---|---|
| More environments to promote through | A2 — ordered list |
| Ephemeral and hosted data options | A4 — endpoint is configuration |
| Dockerized containers everywhere | C5 rung 3; A3 already does it locally |
| Tagged artifacts | C5 rung 2 |
| Capabilities owning pipelines, quality gates, agents | C6 — stages separable; registry when there's a 2nd/3rd consumer |
| Orchestrator agents defining projects | Environment list + stage composition are both declarative |
| Relational capability + Liquibase/Flyway | New capability with a db-migrate stage. Genuine cost decision — RDS isn't Always Free. |
| DynamoDB data migrations | migrations/ convention + runner as a db-migrate stage. Will bite before the relational need does. |
| Per-project credentials | B4 keeps the SSM path a variable |
| Non-hosted second terminal path | C3's deployability check exists regardless |
| Rollback / redeploy-previous | Rung 2 makes it trivial (redeploy an older SHA's artifact) |

## Part 6 — Phasing

### Sizing and model guidance

| Model | Use for |
|---|---|
| Opus 5 | IAM/trust-policy design, the Jira state machine, prompt changes (STANDARDS: prompts are product, not config), anything where a silent wrong answer is the failure mode |
| Sonnet 5 | Well-specified Terraform and workflow authoring with existing patterns to follow |
| Haiku 4.5 | Docs moves, mechanical renames |

### Dependency graph

```
P1 (TM: OIDC modules)
 ├─► P2 (aws-account bootstrap)
 │    ├─► P9 (per-project AWS provisioning)
 │    └─► P3 (PT: terraform env + shared backend)
 │         ├─► P4 (PT: deploy stages)
 │         │    └─► P8 (IW: Phase C/D)
 │         └─► P10 (kids-ledger migration)
 └─────────────────────────────────────────────► P12 (E2E proof)

P5  (PT: compose + dynamodb-local)      independent ──► P10
P6  (IW: status vocabulary)             independent ──► P8
P7  (IW: intake dropdown + Plan v3)     independent
P11 (docs home + flagship loop)         independent
```

### The phases

| # | Repo | Scope | Depends on | Model | Size |
|---|---|---|---|---|---|
| P1 | terraform-modules | github-oidc-provider + github-oidc-deploy-role modules, permissions-boundary support, README's prerequisite-vs-application note, release tag. No changes to lambda-web-app or dynamodb-single-table — verified unnecessary. | — | Opus | M |
| P2 | new aws-account | OIDC provider, shared tfstate bucket, /shared/* auth params, aws_budgets_budget, provisioner role + boundary, capacity-gate IAM. One-time local apply, then workflow_dispatch. | P1 | Opus | M |
| P3 | project-template | environment variable + name composition; backend key at init; delete state_bucket_name, its validator, and per-project bootstrap/; terraform plan per env in CI; STANDARDS + decisions entries. | P1, P2 | Sonnet | M |
| P4 | project-template | deploy.yml + composite actions: capacity-gate, ensure-secrets, terraform-apply, seed, smoke-test. | P3 | Sonnet (Opus for capacity-gate) | L |
| P5 | project-template | amazon/dynamodb-local in compose for DATABASE; single SDK-client choke point reading AWS_ENDPOINT_URL_DYNAMODB; tests; CI integration gate. | — | Sonnet | M |
| P6 | idea-workflow | New statuses + directed transitions in statuses.ts/workflow.ts; rename → PR Ready; provisioning, doctor, statuses.test.ts pins. | — | Opus | M |
| P7 | idea-workflow | Target-repo select field + option sync from the org; jira:repos:sync; drop base_branch; Plan v3 + forward normalization; architect prompt update. | — | Opus | M |
| P8 | idea-workflow | Phase C (dispatch staging deploy, poll, comment, transition) and Phase D (squash-merge, dispatch prod deploy, poll, → Deployed); Deploy Failed handling. | P6, P4 | Opus | L |
| P9 | idea-workflow | Assume provisioner role; apply a small per-project config creating the two deploy roles. Removes the last per-project manual step. | P2, P8 | Opus | M |
| P10 | kids-ledger | terraform destroy; copier update; redeploy as kids-ledger-production through the pipeline; verify. | P3, P4, P5 | Sonnet | M |
| P11 | project-template | Move this doc to docs/; STANDARDS "flagship loop" section; CLAUDE.md pointers. | — | Haiku | S |
| P12 | — | One real Idea ticket, Start Planning → Deployed. Fix what breaks. | all | Opus | M |

### Suggested waves — 3–4 worktrees per session

#### Wave 1 — foundations, all independent. Nothing here blocks on anything.

| Worktree | Phase | Model |
|---|---|---|
| A | P1 terraform-modules OIDC | Opus |
| B | P6 idea-workflow statuses | Opus |
| C | P5 compose + dynamodb-local | Sonnet |
| D | P11 docs home | Haiku |

#### Wave 2 — the AWS spine plus intake.

| Worktree | Phase | Model | Note |
|---|---|---|---|
| A | P2 account bootstrap | Opus | Includes the one-time local apply |
| B | P3 template terraform | Sonnet | Needs P2's bucket name — agree it in Wave 1 to unblock early |
| C | P7 intake dropdown + Plan v3 | Opus | |

#### Wave 3 — the pipeline itself.

| Worktree | Phase | Model | Note |
|---|---|---|---|
| A | P4 deploy stages | Sonnet + Opus | |
| B | P8 Phase C/D | Opus | Can start against a stubbed deploy.yml |
| C | P9 per-project provisioning | Opus | Merge after P8 |

#### Wave 4 — prove it.

| Worktree | Phase | Model |
|---|---|---|
| A | P10 kids-ledger migration | Sonnet |
| B | P12 end-to-end ticket | Opus |

### Critical path

P1 → P2 → P3 → P4 → P8 → P12. Six phases. Everything else is slack.

The single biggest early unblock: agree the shared bucket's name in Wave 1. P3 needs only that string from P2, so naming it up front lets Wave 2 run truly parallel instead of serially.

## Part 7 — Keeping cross-project context

Your question: how do you use kids-ledger as the flagship to trial ideas, then bring them back into the pattern?

The downward path already exists. project-template/STANDARDS.md is explicitly the single source of truth ("Lives here, not copied into each project"), and generated projects carry .copier-answers.yml, so copier update pulls template changes down.

The upward path is what's missing. Proposal — a documented four-step loop, added to STANDARDS as "The flagship loop":

1. Trial it in kids-ledger. Log it in kids-ledger's docs/decisions.md with why.
2. Ask whether it generalizes. Some things are kids-ledger-specific and should stay there. This step is the one that gets skipped, and skipping it is how a template accretes one project's accidents.
3. If it generalizes, change project-template or terraform-modules, citing the kids-ledger decision entry as the evidence. Standards change → STANDARDS.md entry + template docs/decisions.md entry. That discipline already exists; this just names where the evidence comes from.
4. copier update other projects when they're ready. Nothing moves on its own — same philosophy as the module tag pins.

Where multi-repo design docs live. This document spans four repos and belongs to none of them. project-template is already the root of cross-project truth, so: project-template/docs/cd-pipeline.md, with STANDARDS.md linking to it and each repo's CLAUDE.md pointing at STANDARDS. That's P11.

Also worth adding to STANDARDS: name kids-ledger as the flagship explicitly. Right now nothing says which project is the trial ground, so a future session has no way to know that kids-ledger's decisions log carries more weight than any other project's.

## Sources

### GitHub Actions

- [Update to GitHub Actions pricing](https://github.blog/changelog/2024-01-17-github-actions-short-lived-self-hosted-runner-tokens-in-public-beta/)
- [2026 pricing changes](https://github.blog/changelog/2024-10-17-github-actions-free-minutes-for-non-public-repositories-in-organization-and-team-accounts/)
- [Self-hosted fee postponed](https://github.blog/changelog/2025-02-05-github-actions-delay-in-self-hosted-runner-changes/)
- [Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions)
- [Managing environments for deployment](https://docs.github.com/en/actions/deployment/targeting-different-environments/using-environments-for-deployment)

### LocalStack / DynamoDB Local

- [LocalStack archived — OSS alternatives compared](https://www.localstack.cloud/blog/localstack-oss-support-ends)
- [DynamoDB Local — AWS docs](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/DynamoDBLocal.html)

### AWS

- [DynamoDB pricing 2026](https://aws.amazon.com/dynamodb/pricing/on-demand/)
- [AWS Free Tier in 2026 — what changed](https://aws.amazon.com/blogs/aws-cloud-financial-management/aws-free-tier-policy-update/)
- [Tracking Free Tier usage / zero-spend budget](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/tracking-free-tier-usage.html)
- [Amazon ECR pricing](https://aws.amazon.com/ecr/pricing/)
- [Lambda Web Adapter](https://github.com/aws/aws-lambda-web-adapter)
- [GitHub Actions OIDC → AWS with Terraform](https://registry.terraform.io/modules/hashicorp/go-aws-github-oidc/aws/latest)

const BADGE =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMjAiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAxMjAgMjQiPjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjMGY3NjZlIi8+PHRleHQgeD0iNjAiIHk9IjE2IiBmb250LWZhbWlseT0ic2Fucy1zZXJpZiIgZm9udC1zaXplPSIxMSIgZmlsbD0iI2ZmZiIgdGV4dC1hbmNob3I9Im1pZGRsZSI+YnVpbGQgcGFzc2luZzwvdGV4dD48L3N2Zz4='

export const SAMPLE_MARKDOWN = `# ledger-sync

![build passing][badge]

Two-way sync between **Postgres** and your accounting system — with idempotent
retries, ~~nightly batch jobs~~ real-time webhooks and an audit trail.
See the [changelog](#changelog) or https://example.com/docs for details.

## Installation

\`\`\`bash
npm install ledger-sync
npx ledger-sync init --schema public
\`\`\`

## Configuration

| Option        | Type      | Default   | Description                          |
| ------------- | :-------: | --------: | ------------------------------------ |
| \`batchSize\`   | number    | \`500\`     | Rows per upsert batch                |
| \`retry\`       | boolean   | \`true\`    | Retry failed webhooks with backoff   |
| \`timezone\`    | string    | \`"UTC"\`   | Used for daily reconciliation        |

\`\`\`ts
import { createSync } from 'ledger-sync'

const sync = createSync({ batchSize: 250, retry: true })
await sync.start()
\`\`\`

> **Note**
> Webhook secrets are read from \`LEDGER_SYNC_SECRET\` and never logged.

## Roadmap

- [x] Incremental sync with cursors
- [x] Dry-run mode
- [ ] Multi-currency reconciliation
- [ ] Web dashboard
  1. Read-only view
  2. Manual conflict resolution

## Architecture

![Architecture diagram](https://example.com/images/architecture.png)

1. Changes are captured with logical replication.
2. Each change is mapped to an accounting entry.
3. Entries are pushed in batches; failures are retried with exponential backoff.

<details>
<summary>Raw HTML is allowed, but sanitized</summary>

<p onclick="alert('never runs')">Event handlers and <code>&lt;script&gt;</code> tags are stripped.</p>
<script>alert('this never runs')</script>

</details>

---

## Changelog

### 2.1.0
- Added \`--dry-run\` flag
- Fixed timezone drift in daily reconciliation

### 2.0.0
- **Breaking:** Node 20+ required

[badge]: ${BADGE}
`

# Paige Manifest

## Mission

Paige is a documentation agent for software teams. It should understand product
signals, inspect the relevant evidence, and decide what documentation should
change—or whether nothing should change.

## Current Product

Paige currently responds only to direct messages in Slack. Chat SDK handles the
Slack transport and Eve runs the model conversation.

Paige can inspect every configured repository through the authenticated
`repository_read` tool. Each sandbox keeps a shallow Git object cache that
supports exact-revision reads and comparisons without requiring a populated
working tree. Evidence repositories remain read-only. The documentation
repository can be edited in a protected worktree, reviewed as a digest-bound
patch, and published only through an explicitly approved draft-PR writeback.
Paige can also read bounded GitHub releases, open issues, open pull requests,
tags, and recent commits for configured repositories without entering the
sandbox. There is no product database or automated writeback.

## Stack

- Eve
- Chat SDK
- Vercel Connect
- Microsandbox
- Next.js and React
- Drizzle and libSQL
- pnpm and Turborepo

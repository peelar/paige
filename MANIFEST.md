# Paige Manifest

## Mission

Paige is a documentation agent for software teams. It should understand product
signals, inspect the relevant evidence, and decide what documentation should
change—or whether nothing should change.

## Current Product

Paige currently responds only to direct messages in Slack. Chat SDK handles the
Slack transport and Eve runs the model conversation.

On first contact, Paige offers to connect one documentation repository and
optional product evidence repositories. It validates access, summarizes the
complete proposal, and activates it only after confirmation. The active setup
is stored once for the agent, so every connected channel shares it;
unconfirmed changes stay inside the conversation.

Paige can inspect active repositories through authenticated tools. Evidence
repositories remain read-only. The documentation repository can be edited in a
protected worktree, reviewed as a digest-bound patch, and published only
through an explicitly approved draft-PR writeback. Paige can also read bounded
GitHub metadata without entering the sandbox.

## Stack

- Eve
- Chat SDK
- Vercel Connect
- Microsandbox
- Next.js and React
- Drizzle and libSQL
- pnpm and Turborepo

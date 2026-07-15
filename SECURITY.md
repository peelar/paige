# Security Policy

Paige currently accepts Slack direct messages, sends them to a model through
Eve, and posts the response back to Slack. It has no repository integration or
product database. Reports involving Slack webhook verification, connector
credentials, model input or output, and Eve's default harness boundary are
especially useful.

## Supported Versions

Paige is pre-1.0. Security fixes target the latest `main` branch and, after the
first release, the latest tagged release. Older snapshots are not supported.

## Report a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/peelar/paige/security/advisories/new).
Do not open a public issue for an undisclosed vulnerability.

Include the affected revision, trust boundary, minimal reproduction, and
observed impact. Never include credentials or private Slack content.

Please do not access data you do not own, degrade a service, or publish details
before there has been a reasonable opportunity to investigate. This is a
single-maintainer project, so there is no guaranteed response timetable, but
good-faith reports will be handled privately and credited when desired.

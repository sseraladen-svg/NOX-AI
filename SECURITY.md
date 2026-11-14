# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's
"Report a vulnerability" button (Security tab of this repository) or contact the
maintainer privately. Include the affected route or file, steps to reproduce and the
impact. You will get a reply as soon as possible.

## Handling of secrets

- Never commit `.env` files, API keys or tokens. `.env.example` holds names only.
- `NOX_AI_SECRET` encrypts stored provider keys and `AUTH_SECRET` signs sessions.
  Rotate both if they were ever exposed, and re-enter provider keys afterwards.

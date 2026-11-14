# Contributing

1. Branch from `main` (`feat/...`, `fix/...`, `chore/...`).
2. Keep one concern per pull request.
3. Before pushing run:
   ```powershell
   npm run typecheck
   npm run lint
   npm test
   npm run build
   ```
4. Database changes: edit `prisma/schema.prisma`, run `npm run db:migrate` and commit the
   generated migration. Never point `db:push` at a database you care about.
5. Do not add dependencies without using them in the same pull request.

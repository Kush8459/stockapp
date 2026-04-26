# Contributing

Thanks for thinking about contributing. This doc covers the minimum to
open a PR that CI will pass.

## Dev setup

See [`docs/development.md`](docs/development.md). TL;DR:

```bash
cp .env.example .env            # set JWT_SECRET
docker compose up -d postgres redis
docker compose --profile tools run --rm migrate up
cd backend && go run ./cmd/seed
# separate terminals:
cd backend && go run ./cmd/server
cd backend && go run ./cmd/price-worker
cd frontend && npm install && npm run dev
```

## Branch / commit conventions

- Branch off `main`. Name branches `<type>/<short-slug>`, e.g.
  `feat/options-support`, `fix/xirr-clamp`, `docs/api-reference`.
- Commits don't need to be squashed — history is squash-merged via the PR
  button. Write the PR title in the shape you want the final commit to
  take.
- Prefix the PR title:
  - `feat:` new user-visible feature
  - `fix:` bug fix
  - `refactor:` internal change with no user impact
  - `docs:` docs only
  - `chore:` tooling, deps, CI
  - `test:` test-only changes

## Before you open the PR

**All of these should pass:**

```bash
# Backend
cd backend
go mod tidy              # no drift
go vet ./...             # no warnings
go test -race ./...      # green
go build ./...           # green

# Frontend
cd frontend
npx tsc --noEmit         # no type errors
npm run build            # succeeds
```

CI runs the same checks on every PR — if anything above is red locally,
the PR won't merge.

## Code conventions

### Go

- Format with `gofmt` / `goimports` on save.
- Keep package boundaries — don't import `transaction` from `portfolio`
  directly; go through an interface if you must cross.
- Money is always `shopspring/decimal.Decimal`. Never `float64`.
- Handler → Service → Repo layering. Don't do SQL in a handler.
- Wrap errors at boundaries: `fmt.Errorf("load user: %w", err)`.
- Tests live alongside the code in `*_test.go`.

### TypeScript

- Don't redefine types that the SDK or API already exposes — import them.
- Use TanStack Query for anything API-backed. No hand-rolled
  `useEffect` + `fetch`.
- Tailwind utility classes; component styles from `src/index.css` only if
  a class is used in 3+ places.
- No `any`. If a field is genuinely dynamic, type it as `unknown` and narrow.

### Commit style

- Short imperative subject line (`fix xirr clamp for short-span SIPs`).
- Reference an issue or PR if relevant (`closes #42`).
- Explain *why* in the body if the change isn't obvious.

## Making a feature change

1. **Discuss first** for anything non-trivial. Open an issue describing
   the shape of the change before you write code — easier to adjust a
   paragraph than to rewrite a PR.
2. **Migration changes are additive.** Never edit a merged migration.
   Write a new one that fixes the prior.
3. **Keep UI and API in sync.** If you change a response shape, update
   the matching TypeScript interface in `frontend/src/hooks/` or
   `frontend/src/lib/types.ts` in the same PR.
4. **Update docs.** If your PR changes how the app is used or deployed,
   update the relevant file in `docs/`. If it's new API, add it to
   [`docs/api.md`](docs/api.md).

## License

By contributing you agree your contributions are licensed under the same
terms as the rest of the project (MIT unless `LICENSE` says otherwise).

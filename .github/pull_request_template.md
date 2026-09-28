## What & why

<!-- What does this change and why? Link the issue it closes. -->

## How it was tested

<!-- Commands you ran and what you checked (e.g. `pnpm test`, `pnpm demo` + export demo-kr-001). -->

## Checklist

- [ ] `pnpm build && pnpm test && pnpm typecheck && pnpm lint` pass locally
- [ ] Tests added / updated for behavior changes (security / invariant test if touching auth, SSRF, IDOR, streaming or the de-identifier)
- [ ] User-visible text is translated in all four locales (vi / en / ja / ko)
- [ ] Docs updated (README / examples / `.env.example`) if behavior or configuration changed
- [ ] No real patient data, secrets or credentials in code, fixtures or screenshots

# Execution Plan: Root Directory Cleanup

## Analysis
- All imports use relative paths (`./`, `../`) — no changes needed for imports since everything moves together into `frontend/src/`
- No `@/` alias imports used in practice
- Key config changes needed: index.html script src, vite.config.ts paths, tsconfig.json paths

## Steps
1. Delete `._*` macOS junk files
2. Create `frontend/src/` directory structure
3. Move source files (.tsx/.ts, components/, services/) into `frontend/src/`
4. Move config files (index.html, package.json, etc.) into `frontend/`
5. Update `frontend/index.html` — script src `/index.tsx` → `/src/index.tsx`
6. Update `frontend/vite.config.ts` — fix `loadEnv` path, `@` alias path
7. Update `frontend/tsconfig.json` — fix `@/` path alias
8. Create `characters/` dir, move character files
9. Create `docs/` dir, move doc files
10. Delete root `dist/` and `node_modules/`
11. Run `npm install` and `npx vite build` in `frontend/` to verify
12. Git add all changes and commit

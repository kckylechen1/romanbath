# Delegated Task

Clean up the messy root directory of /Volumes/Storage/RomanBath.

## Current mess
The root has everything dumped together: React frontend source files, Rust backend (zeroclaw/), character cards, docs, config files, macOS junk.

## Target structure
```
/Volumes/Storage/RomanBath/
├── frontend/              # React app (move all frontend source here)
│   ├── src/               # All .tsx/.ts source files
│   │   ├── App.tsx
│   │   ├── index.tsx
│   │   ├── components/
│   │   ├── services/
│   │   ├── constants.ts
│   │   ├── types.ts
│   │   ├── i18n.ts
│   │   └── vite-env.d.ts
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── zeroclaw/              # Rust backend (already organized)
├── backend/               # SillyTavern submodule (keep as-is)
├── characters/            # Character cards
│   ├── jayne_card.json
│   └── shy_cousin.png
├── docs/                  # Documentation
│   ├── CHANGELOG.md
│   ├── DEVELOPMENT_LOG.md
│   └── ROADMAP.md
├── plugins/               # Keep as-is
├── README.md              # Keep in root
├── .env, .env.example, .env.local
├── .gitignore, .gitmodules
└── .claude/               # Keep as-is
```

## Steps
1. Delete all `._*` macOS resource fork junk files
2. Create `frontend/src/` directory
3. Move all .tsx/.ts source files into `frontend/src/`:
   - App.tsx, index.tsx
   - components/ (entire directory)
   - services/ (entire directory)
   - constants.ts, types.ts, i18n.ts, vite-env.d.ts
4. Move frontend config files to `frontend/`:
   - index.html, package.json, package-lock.json, tsconfig.json, vite.config.ts
5. Update `frontend/index.html` — change script src from `/index.tsx` to `/src/index.tsx`
6. Update `frontend/vite.config.ts` — set root to `frontend/` if needed, or adjust paths
7. Update `frontend/tsconfig.json` — adjust include paths for new src/ layout
8. Update ALL import paths in moved .tsx/.ts files — relative imports between moved files need to stay correct (they were all in root before, now they're in src/)
9. Create `characters/` directory, move jayne_card.json and shy_cousin.png there
10. Create `docs/` directory, move CHANGELOG.md, DEVELOPMENT_LOG.md, ROADMAP.md there
11. Update `frontend/package.json` scripts if they reference file paths
12. Delete `dist/` and `node_modules/` from root (they'll be regenerated in frontend/)
13. Run `cd frontend && npm install` to verify
14. Run `cd frontend && npx vite build` to verify the build works

## IMPORTANT
- All imports in the moved .tsx/.ts files were relative to root. Now they're in `src/`. 
  - Files that imported `./components/Foo` now need `./components/Foo` (still correct since components/ is also in src/)
  - Files that imported `./services/bar` now need `./services/bar` (still correct)
  - index.tsx imports `./App` — still correct
  - The only thing that changes is index.html's script reference
- Do NOT modify any files in zeroclaw/, backend/, or .git/
- After moving, git add everything and commit

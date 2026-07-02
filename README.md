<div align="center">
  <img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="Roman Bath Banner" width="100%" />
  
  # 🏛️ 罗马大浴场 Roman Bath
  
  **A modern glassmorphic frontend for character roleplay — powered by ZeroClaw**
  
  [![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
</div>

---

## 📖 About

**罗马大浴场 (Roman Bath)** is a sleek, dark-themed UI for AI character chat. It connects to the **[ZeroClaw](zeroclaw/) Gateway** for streaming chat and character cards. Roman Bath is the frontend; ZeroClaw handles models, prompts, and lorebooks server-side.

### ✨ Features

- 🎨 **Glassmorphic design** — dark theme, frosted panels, smooth animations
- 🌐 **Multi-language UI** — English, 简体中文, 繁體中文
- 💬 **Streaming chat** — SSE via `POST /api/chat`
- 👤 **Character management** — import, create, edit, export cards (`~/.zeroclaw/characters/`)
- ⚙️ **Generation tuning** — temperature, top-p, penalties, scene mode
- 📱 **Responsive** — desktop and mobile

Optional surfaces such as image generation, TTS, voice input, group chat, bookmarks, affect readouts, and Studio inspectors are disabled by default and must be enabled explicitly with `VITE_ENABLE_*` flags.

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+
- **Rust** (for ZeroClaw) — [rustup.rs](https://rustup.rs/)
- An LLM provider configured in ZeroClaw (`~/.zeroclaw/config.toml`)

### Installation

```bash
git clone https://github.com/kckylechen1/romanbath.git
cd romanbath/frontend && npm install
```

Optional environment file (repo root):

```bash
cp .env.example .env
# Default gateway port is 42617 — change VITE_ZEROCLAW_PORT if needed.
# Optional product surfaces are disabled by default in .env.example.
```

### Run (recommended)

```bash
cd frontend && npm start
```

This starts:

| Service | URL |
|---------|-----|
| ZeroClaw Gateway | `http://127.0.0.1:42617` |
| Roman Bath (Vite) | `http://127.0.0.1:5173` |

Open **http://127.0.0.1:5173** in your browser. On first launch the frontend auto-pairs with the gateway.

### Run separately

```bash
# Terminal 1 — gateway
cd zeroclaw && cargo run --no-default-features --features gateway,agent-runtime -- gateway start -p 42617

# Terminal 2 — frontend only
cd frontend && npm run dev
```

---

## ⚙️ Configuration

### Models & API keys

Roman Bath does **not** hold LLM API keys. Configure providers in ZeroClaw:

```bash
# Typical location
~/.zeroclaw/config.toml
```

Use **Settings → Backend** in the UI to test gateway connectivity.

### Characters

- Cards live in `~/.zeroclaw/characters/*.json`
- Optional avatars: `~/.zeroclaw/characters/<Name>.png`
- Import via **Import Character** in the sidebar (SillyTavern V2 JSON / PNG cards)
- Sample cards in repo: `characters/`

### Chat history

Conversations are stored in **browser localStorage** (`romanbath_chat_history_v1`). Clearing site data removes history.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_ZEROCLAW_PORT` | `42617` | Gateway port for Vite dev proxy |
| `ZEROCLAW_CARGO_FEATURES` | `gateway,agent-runtime` | Cargo features used by `frontend/scripts/dev-full.mjs` for the gateway |
| `VITE_ENABLE_IMAGE_GEN` | `false` | Show image generation actions and modal |
| `VITE_ENABLE_TTS` | `false` | Show TTS settings and read-aloud actions |
| `VITE_ENABLE_VOICE_INPUT` | `false` | Show microphone input |
| `VITE_ENABLE_GROUP_CHAT` | `false` | Show group chat manager |
| `VITE_ENABLE_STUDIO` | `false` | Show context/tree/memory Studio rail |
| `VITE_ENABLE_AFFECT` | `false` | Show affect readouts and avatar mood glow |
| `VITE_ENABLE_BOOKMARKS` | `false` | Show bookmark checkpoint controls |

---

## 🕹️ How to Use

1. **Import or create a character** — sidebar → Import Character / Create Character
2. **Select a character** — click a contact in the left panel
3. **Chat** — type and send; Enter sends, Shift+Enter newline (IME-safe for Chinese)
4. **Tune generation** — Settings → Generation (temperature, max tokens, scene mode, …)
5. **Opt in to extras only when needed** — set the matching `VITE_ENABLE_*` flag and restart Vite

---

## 🛠️ Tech Stack

| Layer | Stack |
|-------|--------|
| Frontend | React 19, TypeScript, Vite, Tailwind (CDN), Lucide |
| Backend | ZeroClaw Gateway (Rust) — chat, characters, lorebooks |
| Cards | SillyTavern V2 format via `zeroclaw-cards` |

---

## 📁 Project Structure

```
romanbath/
├── frontend/                 # Roman Bath UI
│   ├── src/
│   │   ├── components/       # CharacterList, MessageBubble, SettingsPanel, …
│   │   ├── services/
│   │   │   ├── zeroclawService.ts   # Gateway client (chat, characters, optional extras)
│   │   │   ├── chatService.ts       # localStorage chat history
│   │   │   └── …
│   │   └── App.tsx
│   └── scripts/dev-full.mjs  # npm start — gateway + vite
├── zeroclaw/                 # ZeroClaw (Rust) — gateway & runtime
├── characters/               # Example character cards
└── .env.example
```

---

## 🔧 Development

```bash
cd frontend
npm run dev          # frontend only (gateway must be running)
npm start            # gateway + frontend
npm run build        # production static build
npm test             # vitest
```

Gateway API (dev proxy forwards `/api`, `/health`, `/pair`):

- `GET /api/characters` — list cards
- `POST /api/chat` — SSE streaming chat
- Optional media endpoints remain in ZeroClaw but are not surfaced by the default Roman Bath UI

---

## 🤝 Contributing

Contributions welcome. Fork, branch, PR.

---

## 📜 License

AGPL-3.0 — see [LICENSE](LICENSE).

---

## 🙏 Acknowledgments

- [ZeroClaw](zeroclaw/) — gateway and character runtime
- [SillyTavern](https://github.com/SillyTavern/SillyTavern) — character card format ecosystem
- [TailwindCSS](https://tailwindcss.com/) · [Lucide](https://lucide.dev/)

---

<div align="center">
  <sub>Built with ❤️ for the roleplay community</sub>
</div>

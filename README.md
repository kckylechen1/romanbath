<div align="center">
  <img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="Roman Bath Banner" width="100%" />
  
  # 🏛️ 罗马大浴场 Roman Bath
  
  **A Modern, Glassmorphic Frontend for SillyTavern**
  
  [![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
</div>

---

## 📖 About

**罗马大浴场 (Roman Bath)** is a modern, sleek frontend redesign for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It provides a premium glassmorphic UI experience while connecting to your existing SillyTavern backend for AI-powered roleplay conversations.

### ✨ Features

- 🎨 **Premium Glassmorphic Design** - Dark theme with frosted glass panels, smooth animations, and modern aesthetics
- 🌐 **Multi-Language Support** - English, 简体中文, 繁體中文
- 🤖 **Multiple AI Providers** - Supports SillyTavern backend, OpenRouter, OpenAI, Google Gemini, Claude, and more
- 💬 **Real-time Streaming** - Live character responses with typing indicators
- 👤 **Character Management** - Browse and select characters from your SillyTavern library
- ⚙️ **Advanced Settings** - Fine-tune generation parameters (temperature, top-p, penalties, etc.)
- 📱 **Responsive Design** - Works on desktop and mobile devices

---

## 🖼️ Screenshots

<div align="center">
  <i>Screenshots coming soon...</i>
  <!-- Add your screenshots here -->
  <!-- <img src="screenshots/chat.png" alt="Chat Interface" width="80%" /> -->
</div>

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** (v18 or higher)
- (Recommended) **Git submodules** enabled (this repo vendors SillyTavern as a submodule)

### Installation

1. **Clone the repository**
   ```bash
   git clone --recurse-submodules https://github.com/kckylechen1/romanbath.git
   cd romanbath
   ```

   If you already cloned without submodules:
   ```bash
   git submodule update --init --recursive
   ```

2. **Install dependencies**
   ```bash
   cd frontend && npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys (optional - for direct API access)
   ```

4. **Run the development server**
   ```bash
   cd frontend && npm start
   ```

   This launches:
   - SillyTavern backend at `http://127.0.0.1:8000`
   - Roman Bath frontend at `http://127.0.0.1:5173`

5. **Open in browser**
   Navigate to `http://localhost:5173`

---

## ⚙️ Configuration

### Connecting to SillyTavern

By default, Roman Bath connects to SillyTavern at `http://127.0.0.1:8000`.

If you use `npm start` from `frontend/`, SillyTavern is started automatically.

If you run the frontend only (`npm run dev` from `frontend/`), you must start SillyTavern separately and ensure it is reachable.

Troubleshooting:
- If `backend/SillyTavern` is missing, you cloned without submodules. Run `git submodule update --init --recursive`.

### Direct API Access (Optional)

You can also use AI providers directly without SillyTavern:

| Provider | Environment Variable | Get API Key |
|----------|---------------------|-------------|
| OpenRouter | `VITE_OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| OpenAI | `VITE_OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google Gemini | `VITE_GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Claude | `VITE_CLAUDE_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

---

## 🕹️ How to Use

1. **Import a character**
   - Click **Import Character** in the left sidebar and select a character card.

2. **Pick a character / start a chat**
   - Select a character from **Contacts**.
   - Use **New Chat** to start fresh.

3. **Configure your AI provider**
   - Open **Settings → API 连接 / API**.
   - Choose a provider (SillyTavern, OpenAI, OpenRouter, Google Gemini, Grok/xAI, Perplexity, etc.).
   - Paste your API key and set the model name (free-form input).

4. **Chat with streaming responses**
   - Type in the composer, send, and watch tokens stream in real time.

5. **Go beyond 1:1 chats**
   - Create **Group Chats** and manage members.
   - Enable **TTS** if you want voice output.
   - Use bookmarks and history tools to keep long sessions manageable.

---

## ✅ What This Project Delivers

- A modern, glassmorphic SillyTavern frontend with a faster workflow
- One-command local dev (`npm start`) that boots backend + frontend
- Multi-provider support with flexible model naming (no hardcoded dropdown)
- Roleplay-first UX: character browsing, import, groups, streaming, and tuning controls

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: TailwindCSS (via CDN), Glassmorphism design
- **Icons**: Lucide React
- **Fonts**: Inter, JetBrains Mono
- **Backend Integration**: SillyTavern API (vendored as a Git submodule)

---

## 📁 Project Structure

```
romanbath/
├── frontend/              # React frontend
│   ├── src/
│   │   ├── components/    # React components
│   │   │   ├── ApiProviderSelector.tsx
│   │   │   ├── CharacterList.tsx
│   │   │   ├── GroupChatManager.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   └── SettingsPanel.tsx
│   │   ├── services/      # API and data services
│   │   │   ├── chatService.ts
│   │   │   ├── groupChatService.ts
│   │   │   ├── geminiService.ts
│   │   │   └── sillyTavernService.ts
│   │   ├── App.tsx        # Main application component
│   │   ├── constants.ts   # Configuration constants
│   │   ├── i18n.ts        # Internationalization
│   │   ├── types.ts       # TypeScript type definitions
│   │   └── index.tsx      # Entry point
│   ├── index.html         # Entry HTML file
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.ts
├── backend/               # SillyTavern submodule
│   └── SillyTavern/
├── zeroclaw/              # Rust backend (memory system)
├── characters/            # Character cards
├── docs/                  # Documentation
├── plugins/               # Plugins
├── .env.example
└── README.md
```

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📜 License

This project is licensed under the AGPL-3.0 License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [SillyTavern](https://github.com/SillyTavern/SillyTavern) - The amazing backend that makes this possible
- [TailwindCSS](https://tailwindcss.com/) - For the beautiful utility-first CSS framework
- [Lucide](https://lucide.dev/) - For the gorgeous icon set

---

<div align="center">
  <sub>Built with ❤️ for the roleplay community</sub>
</div>

<div align="center">
  <img src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" alt="Etheria Tavern Banner" width="100%" />
  
  # ✨ Etheria Tavern
  
  **A Modern, Glassmorphic Frontend for SillyTavern**
  
  [![Made with React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-6.0-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
</div>

---

## 📖 About

Etheria Tavern is a modern, sleek frontend redesign for [SillyTavern](https://github.com/SillyTavern/SillyTavern). It provides a premium glassmorphic UI experience while connecting to your existing SillyTavern backend for AI-powered roleplay conversations.

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
- **SillyTavern** backend running locally (default: `http://localhost:8000`)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/etheria-tavern.git
   cd etheria-tavern
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your API keys (optional - for direct API access)
   ```

4. **Run the development server**
   ```bash
   npm run dev
   ```

5. **Open in browser**
   Navigate to `http://localhost:5173`

---

## ⚙️ Configuration

### Connecting to SillyTavern

By default, Etheria Tavern connects to SillyTavern at `http://localhost:8000`. Make sure:

1. SillyTavern is running (`npm start` in your SillyTavern directory)
2. CORS is enabled in SillyTavern's settings
3. The "Listen" option is enabled for external connections

### Direct API Access (Optional)

You can also use AI providers directly without SillyTavern:

| Provider | Environment Variable | Get API Key |
|----------|---------------------|-------------|
| OpenRouter | `VITE_OPENROUTER_API_KEY` | [openrouter.ai/keys](https://openrouter.ai/keys) |
| OpenAI | `VITE_OPENAI_API_KEY` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Google Gemini | `VITE_GOOGLE_API_KEY` | [aistudio.google.com](https://aistudio.google.com/apikey) |
| Claude | `VITE_CLAUDE_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |

---

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Styling**: TailwindCSS, Glassmorphism design
- **Icons**: Lucide React
- **Fonts**: Inter, JetBrains Mono
- **Backend Integration**: SillyTavern API

---

## 📁 Project Structure

```
etheria-tavern/
├── components/           # React components
│   ├── ApiProviderSelector.tsx
│   ├── CharacterList.tsx
│   ├── MessageBubble.tsx
│   └── SettingsPanel.tsx
├── services/            # API and data services
│   ├── chatService.ts
│   ├── geminiService.ts
│   ├── personaService.ts
│   └── sillyTavernService.ts
├── App.tsx              # Main application component
├── constants.ts         # Configuration constants
├── i18n.ts              # Internationalization
├── types.ts             # TypeScript type definitions
└── index.html           # Entry HTML file
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

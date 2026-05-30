# 🏛️ 罗马大浴场 Roman Bath - 开发日志

---

## 📅 2024-12-28

### ✅ 已完成功能

#### 1. Toast 通知系统
- 创建了 `Toast.tsx` 组件和 `useToast` hook
- 支持 success, error, warning, info, loading 类型
- 自动消失和手动关闭
- 优雅的动画效果

#### 2. Markdown 渲染器
- 创建了 `MarkdownRenderer.tsx` 组件
- 支持代码块、列表、表头等 Markdown 语法
- 与角色扮演文本格式化器共存

#### 3. 本地反代 API (Local Proxy) 集成
- 在 `ApiProviderSelector.tsx` 中添加了 "本地反代 (Local Proxy)" 选项
- 支持配置 API URL、API Key 和 Model
- 使用 OpenAI 兼容格式 (`/v1/chat/completions`)
- 在 `vite.config.ts` 中配置了 `/local-api` 代理以绕过 CORS
- 在 `sillyTavernService.ts` 中实现了本地 API 调用逻辑

#### 4. 真实 API 连接测试
- 在保存 API Key 后自动测试连接
- 支持 OpenAI, OpenRouter, Google, Perplexity, Local Proxy
- 显示连接成功/失败/无效 Key 的状态
- 处理 401/403/429 等错误码

#### 5. API Key 输入框改进
- 切换 Provider 时自动清空并加载对应的 Key
- 每个 Provider 的 Key 独立保存到 localStorage
- 修复了重复显示 API Key 输入框的 bug

#### 6. 消息格式化改进
- 重写了 `formatMessageContent` 函数
- 动作 (`*斜体*`) 显示为金色斜体
- 对话 (`"引号"`) 显示为青色
- 动作和对话之间自动添加空行分隔
- 支持多种引号格式：`"" '' 「」『』`

#### 7. 增强错误处理
- 更详细的错误消息分类
- API Key 错误、速率限制、网络错误、超时错误
- 在消息气泡中显示错误信息
- 添加了相关的 i18n 翻译

#### 8. 开发环境优化
- Vite 端口固定为 5173
- 添加 strictPort 防止端口冲突

---

## 📅 2024-12-25 ~ 2024-12-27

### ✅ 已完成功能

#### 1. AI 角色扮演增强
- 正确传递角色数据（人格、场景、示例对话、系统提示）
- 添加明确的角色扮演指令到 API 调用

#### 2. 聊天参数配置
- 正确传递 `max_tokens` 和 `thinkingBudget` 到后端
- 防止 AI 回复被截断

#### 3. 高级采样器设置
- 新增 "Custom" 样式预设
- 实现 Top-K, Min-P, Top-A, Typical-P 等高级参数
- 为四种预设样式优化采样器组合
- 添加所有参数的多语言翻译

#### 4. UI 颜色重设计
- 实现高级中性配色方案
- 深色模式优化
- 玻璃态效果增强

---

## 🐛 已知问题

1. **聊天保存失败** - `POST /api/chats/save` 偶尔返回 400 错误
2. **字体选择** - 用户希望能够自定义字体（待实现）

---

## 📝 技术细节

### 文件更改列表

| 文件 | 更改类型 | 描述 |
|------|---------|------|
| `components/Toast.tsx` | 新增 | Toast 通知组件 |
| `components/MarkdownRenderer.tsx` | 新增 | Markdown 渲染器 |
| `components/MessageBubble.tsx` | 修改 | 消息格式化逻辑 |
| `components/ApiProviderSelector.tsx` | 修改 | 添加本地反代选项 |
| `components/SettingsPanel.tsx` | 修改 | API 连接测试、Key 输入框改进 |
| `services/sillyTavernService.ts` | 修改 | 本地 API 调用逻辑 |
| `App.tsx` | 修改 | Toast 集成、错误处理 |
| `vite.config.ts` | 修改 | 本地 API 代理配置 |
| `i18n.ts` | 修改 | 错误消息翻译 |

---

*最后更新: 2024-12-28*

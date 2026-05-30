# Delegated Task

请修复 ZeroClaw xAI 实现中发现的所有 P0 和 P1 问题：

P0 严重问题：
1. 添加安全策略强制执行到所有工具 (xai_tts.rs, xai_image_gen.rs, xai_video_gen.rs) - 参考 image_gen.rs L281-290 的模式
2. 修复路径遍历漏洞 - 净化 output_filename，参考 image_gen.rs L75-78 的安全模式
3. 修复 run_pkce_flow - 移除阻塞 stdin，改用 loopback 回调模式
4. 修复 run_pkce_flow - 修复竞态条件，先绑定 TCP 监听器再显示 URL
5. 修复 run_pkce_flow - 添加超时到 listener.accept()

P1 中等问题：
6. 提取共享凭证解析模块 - 创建 crates/zeroclaw-tools/src/xai_common.rs
7. 提取共享 HTTP 客户端工厂到 xai_common.rs
8. 切换到 tokio::fs 替代 std::fs
9. 添加参考图像文件大小限制（建议最大 10MB 每张）
10. 修复刷新令牌轮换处理 - 优先使用新令牌
11. 集成到 AuthProvider 枚举 - 在 mod.rs 中添加 xAI 变体和相关方法

需要修改的文件：
- /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-providers/src/auth/xai_oauth.rs
- /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-providers/src/auth/mod.rs
- /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-tools/src/xai_tts.rs
- /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-tools/src/xai_image_gen.rs
- /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-tools/src/xai_video_gen.rs
- 创建 /Users/kckylechen/Dev/zeroclaw/crates/zeroclaw-tools/src/xai_common.rs

请确保修复后代码能编译通过，并遵循 ZeroClaw 现有代码风格和最佳实践。

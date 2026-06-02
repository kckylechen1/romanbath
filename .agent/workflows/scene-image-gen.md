---
description: 统一风格场景图生成 — 使用 ZeroClaw gateway 生图 API，保持 film noir 电影风格一致性
---

## 生图 Workflow — RomanBath Scene Image Generation

### 前置条件
- ZeroClaw gateway 运行中 (`:42617`)
- gateway 已配置 xAI OAuth token（`~/.zeroclaw/config.toml` 中 `providers.models.xai.default.api_key`）

### 统一风格参数（所有图共用）

```
基础风格: cinematic photorealistic, film noir aesthetic, 35mm film grain
色调: warm amber + deep shadows, chiaroscuro lighting
构图: shallow depth of field, dramatic composition
分辨率: 1k (默认) 或 2k
```

### 角色视觉锚点

**侯龙涛 (Hou Longtao)**:
- 30多岁中国男性，霸道总裁气质
- 深色西装，短发干练
- 表情：自信、掠夺性、冷笑
- 关键词: `powerful Chinese man in his 30s, dark tailored suit, short neat hair, confident predatory expression`

**苏晚宁 (Su Wanning)**:
- 20多岁中国女性，精英律师
- 黑色长发，真丝衬衫/职业装/黑色蕾丝内衣（视场景）
- 表情：恐惧、屈辱、隐忍、眼眶泛红
- 关键词: `beautiful Chinese woman lawyer in her late 20s, long black hair, silk blouse, tearful humiliated expression, red-rimmed eyes`

### 生图步骤

#### Step 1: 获取配对 token
```bash
CODE=$(curl -s -X POST http://127.0.0.1:42617/admin/paircode/new | python3 -c "import sys,json; print(json.load(sys.stdin)['pairing_code'])")
TOKEN=$(curl -s -X POST http://127.0.0.1:42617/pair -H "X-Pairing-Code: $CODE" -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
```

#### Step 2: 组装 prompt（模板）
```
"[场景描述]，[角色描述]，[光影氛围]，cinematic lighting, film noir aesthetic, shallow depth of field, photorealistic, 35mm film grain"
```

#### Step 3: 调用 API 并保存
```bash
curl -s "http://127.0.0.1:42617/api/image-gen" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"$PROMPT\",\"resolution\":\"1k\"}" \
  | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
if d.get('success') and d.get('image_data_url'):
    b64 = d['image_data_url'].split(',')[1]
    with open('$OUTPUT_PATH','wb') as f:
        f.write(base64.b64decode(b64))
    print('OK:', '$OUTPUT_PATH')
else:
    print('FAIL:', d.get('error','unknown'))
"
```

### 批量生图脚本模板

```bash
#!/bin/bash
# Usage: bash gen_scene.sh <scene_prefix> <output_dir>
# Example: bash gen_scene.sh scene4_ /Volumes/Storage/RomanBath/characters/

SCENE="$1"
OUTDIR="${2:-/Volumes/Storage/RomanBath/characters}"
mkdir -p "$OUTDIR"

# Get token
CODE=$(curl -s -X POST http://127.0.0.1:42617/admin/paircode/new | python3 -c "import sys,json; print(json.load(sys.stdin)['pairing_code'])")
TOKEN=$(curl -s -X POST http://127.0.0.1:42617/pair -H "X-Pairing-Code: $CODE" -H "Content-Type: application/json" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Define prompts array (edit per scene)
PROMPTS=(
  "prompt 1 description here, cinematic lighting, film noir aesthetic, photorealistic"
  "prompt 2 description here, cinematic lighting, film noir aesthetic, photorealistic"
  "prompt 3 description here, cinematic lighting, film noir aesthetic, photorealistic"
)

for i in "${!PROMPTS[@]}"; do
  NUM=$(printf "%02d" $((i+1)))
  OUTFILE="${OUTDIR}/${SCENE}${NUM}.png"
  echo "[$((i+1))/${#PROMPTS[@]}] Generating..."
  curl -s "http://127.0.0.1:42617/api/image-gen" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c "import json; print(json.dumps({'prompt':'${PROMPTS[$i]}','resolution':'1k'}))")" \
    | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
if d.get('success') and d.get('image_data_url'):
    b64 = d['image_data_url'].split(',')[1]
    with open('$OUTFILE','wb') as f:
        f.write(base64.b64decode(b64))
    print('  -> $OUTFILE')
else:
    print('  FAIL:', d.get('error','unknown'))
"
done
echo "Done."
```

### Token 过期处理
```bash
# 刷新 xAI OAuth token
/Volumes/Storage/RomanBath/zeroclaw/target/release/zeroclaw auth refresh --model-provider xai --profile default

# 更新 gateway config 中的 api_key
python3 << 'PYEOF'
import json, os
from cryptography.hazmat.primitives.ciphers.aead import ChaCha20Poly1305
with open(os.path.expanduser("~/.zeroclaw/.secret_key"), "r") as f:
    key = bytes.fromhex(f.read().strip())
with open(os.path.expanduser("~/.zeroclaw/auth-profiles.json")) as f:
    data = json.load(f)
enc = data["profiles"]["xai:default"]["access_token"]
blob = bytes.fromhex(enc[5:])
token = ChaCha20Poly1305(key).decrypt(blob[:12], blob[12:], None).decode()
# Write to config.toml providers.models.xai.default.api_key = token
PYEOF

# 重启 gateway
kill $(lsof -ti :42617)
nohup /Volumes/Storage/RomanBath/zeroclaw/target/release/zeroclaw gateway start > /tmp/zc-gateway.log 2>&1 &
```

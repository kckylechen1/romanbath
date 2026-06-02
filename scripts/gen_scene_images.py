"""Generate images for 苏晚宁 Scene 1-4 using xAI Grok Imagine API (stdlib only)."""
import os, sys, base64, json, time, urllib.request, urllib.error

API_KEY = os.environ.get("XAI_API_KEY") or os.environ.get("XAI_OAUTH_TOKEN")
if not API_KEY:
    print("ERROR: XAI_API_KEY or XAI_OAUTH_TOKEN not set")
    sys.exit(1)

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "characters", "scene_images")
os.makedirs(OUT_DIR, exist_ok=True)

SCENES = [
    {
        "id": "scene1",
        "name": "Scene 1 - Meeting Room",
        "prompt": "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black low ponytail, delicate makeup, sharp intelligent eyes, dark grey business suit, pencil skirt, flesh-colored stockings, sitting at a long conference table in a high-end law firm meeting room, afternoon sunlight through floor-to-ceiling windows, city skyline background, looking up toward the door with a professional expression that is slightly cracking, medium shot, film-like lighting, shallow depth of field",
    },
    {
        "id": "scene2",
        "name": "Scene 2 - Rooftop Bar",
        "prompt": "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black low ponytail slightly messy, delicate makeup, fitted silk blouse, dark grey pencil skirt, flesh-colored stockings, sitting in a luxury hotel rooftop bar at night, city lights through floor-to-ceiling windows, dim amber lighting, leather booth, jazz bar atmosphere, holding a brown envelope with trembling fingers, face pale with shock and fear, eyes wide, lips slightly parted, medium shot, dramatic noir lighting",
    },
    {
        "id": "scene3",
        "name": "Scene 3 - Kneeling",
        "prompt": "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black hair in low ponytail, tear-streaked delicate makeup, black slim strap dress, exposed shoulders and collarbone, kneeling on expensive hotel carpet in a luxury presidential suite at night, city night view through floor-to-ceiling windows, warm dim lighting, crystal chandelier, looking up with tearful eyes, expression of despair and submission, hands weakly supporting herself on the carpet, low angle shot, dramatic chiaroscuro lighting, emotional intensity",
    },
    {
        "id": "scene4",
        "name": "Scene 4 - Humiliation",
        "prompt": "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black hair completely disheveled, tear-streaked and sweat-dampened face, ruined makeup, flushed cheeks, black slim strap dress with one strap slipped off shoulder, kneeling on expensive hotel carpet, head pushed down by a man hand only hand visible, luxury presidential suite at night, dim warm lighting, expression of humiliation, tears streaming down, eyes half-closed in distress, close-up shot, extreme emotional intensity, dramatic lighting, artistic tasteful composition",
    },
]

def api_call(url, data=None, method="POST"):
    payload = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=payload, headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()

for scene in SCENES:
    print(f"Generating: {scene['name']}...", flush=True)
    status, body = api_call("https://api.x.ai/v1/images/generations", {"model": "grok-imagine-image", "prompt": scene["prompt"], "resolution": "1k"})
    if status != 200:
        print(f"  FAILED ({status}): {str(body)[:200]}")
        continue
    data = json.loads(body)
    images = data.get("data", [])
    if not images:
        print(f"  No images: {json.dumps(data)[:300]}")
        continue
    for i, img in enumerate(images):
        b64 = img.get("b64_json")
        url = img.get("url")
        img_bytes = None
        if b64:
            img_bytes = base64.b64decode(b64)
        elif url:
            s, b = api_call(url, method="GET")
            if s == 200:
                img_bytes = b
        if img_bytes:
            fname = f"{scene['id']}.png" if len(images) == 1 else f"{scene['id']}_{i}.png"
            fpath = os.path.join(OUT_DIR, fname)
            with open(fpath, "wb") as f:
                f.write(img_bytes)
            print(f"  Saved: {fpath} ({len(img_bytes)} bytes)")
        else:
            print(f"  No image data")
    time.sleep(1)
print("\nDone!")

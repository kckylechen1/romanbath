#!/bin/bash
# Generate images for 苏晚宁 Scene 1-4 via gateway API
TOKEN="zc_fc0491af667bed07f12667d60fb19ea381247d6da693ac6346a6794de3708aee"
OUT="/Volumes/Storage/RomanBath/characters/scene_images"
mkdir -p "$OUT"

gen() {
  local id=$1 name=$2 prompt=$3
  echo "=== $name ==="
  curl -s -X POST http://localhost:3000/api/image-gen \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"prompt\":\"$prompt\",\"resolution\":\"1k\"}" | python3 -c "
import sys,json,base64
d=json.load(sys.stdin)
if d.get('success') and d.get('image_data_url'):
    b64=d['image_data_url'].split(',')[1]
    with open('$OUT/${id}.png','wb') as f: f.write(base64.b64decode(b64))
    print('Saved ${id}.png')
else:
    print('FAILED:', d.get('error','unknown'))
"
  sleep 2
}

gen "scene1" "Scene 1 - Meeting Room" \
  "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black low ponytail, delicate makeup, sharp intelligent eyes, dark grey business suit, pencil skirt, flesh-colored stockings, sitting at a long conference table in a high-end law firm meeting room, afternoon sunlight through floor-to-ceiling windows, city skyline background, looking up toward the door with a professional expression that is slightly cracking, medium shot, film-like lighting, shallow depth of field"

gen "scene2" "Scene 2 - Rooftop Bar" \
  "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black low ponytail slightly messy, delicate makeup, fitted silk blouse, dark grey pencil skirt, flesh-colored stockings, sitting in a luxury hotel rooftop bar at night, city lights through floor-to-ceiling windows, dim amber lighting, leather booth, jazz bar atmosphere, holding a brown envelope with trembling fingers, face pale with shock and fear, eyes wide, lips slightly parted, medium shot, dramatic noir lighting"

gen "scene3" "Scene 3 - Kneeling at Midnight" \
  "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black hair in low ponytail, tear-streaked delicate makeup, black slim strap dress, exposed shoulders and collarbone, kneeling on expensive hotel carpet in a luxury presidential suite at night, city night view through floor-to-ceiling windows, warm dim lighting, crystal chandelier, looking up with tearful eyes, expression of despair and submission, hands weakly supporting herself on the carpet, low angle shot, dramatic chiaroscuro lighting, emotional intensity"

gen "scene4" "Scene 4 - Humiliation" \
  "(masterpiece, best quality, highly detailed), cinematic photorealistic, 1girl, Su Wanning, early 30s, beautiful Chinese woman, mature, black hair completely disheveled, tear-streaked and sweat-dampened face, ruined makeup, flushed cheeks, black slim strap dress with one strap slipped off shoulder, kneeling on expensive hotel carpet, head pushed down by a man hand only hand visible, luxury presidential suite at night, dim warm lighting, expression of humiliation, tears streaming down, eyes half-closed in distress, close-up shot, extreme emotional intensity, dramatic lighting, artistic tasteful composition"

echo "Done!"

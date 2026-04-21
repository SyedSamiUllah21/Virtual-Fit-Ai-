"""Quick test: check if SeedEdit-3.0-i2i API access is valid."""
import os
import urllib.request
import urllib.error
import json

KEY = (
    os.getenv("ARK_API_KEY")
    or os.getenv("SEEDEDIT_API_KEY")
    or os.getenv("SEEDREAM_API_KEY")
    or ""
).strip()
URL = (
    os.getenv("ARK_IMAGE_GENERATIONS_ENDPOINT")
    or os.getenv("SEEDEDIT_I2I_ENDPOINT")
    or os.getenv("SEEDEDIT_EDIT_ENDPOINT")
    or os.getenv("SEEDREAM_EDIT_ENDPOINT")
    or "https://ark.ap-southeast.bytepluses.com/api/v3/images/generations"
).strip()

if not KEY:
    raise SystemExit("ARK_API_KEY is missing.")

model_name = (os.getenv("SEEDEDIT_MODEL") or "seededit-3-0-i2i-250628").strip()
response_format = (os.getenv("SEEDEDIT_RESPONSE_FORMAT") or "url").strip() or "url"
edit_size = (os.getenv("SEEDEDIT_SIZE") or "adaptive").strip() or "adaptive"

try:
    guidance_scale = float(os.getenv("SEEDEDIT_GUIDANCE_SCALE") or "5.5")
except ValueError:
    guidance_scale = 5.5

seed_raw = (os.getenv("SEEDEDIT_SEED") or "21").strip()
try:
    seed_value = int(seed_raw)
except ValueError:
    seed_value = 21

watermark_raw = (os.getenv("SEEDEDIT_WATERMARK") or "true").strip().lower()
watermark = watermark_raw in {"1", "true", "yes", "on"}

payload = json.dumps({
    "model": model_name,
    "prompt": "Make the bubbles heart-shaped",
    "image": "https://picsum.photos/512/512.jpg",
    "response_format": response_format,
    "size": edit_size,
    "seed": seed_value,
    "guidance_scale": guidance_scale,
    "watermark": watermark,
}).encode()
req = urllib.request.Request(URL, data=payload, method="POST")
req.add_header("Authorization", f"Bearer {KEY}")
req.add_header("Content-Type", "application/json")

try:
    with urllib.request.urlopen(req, timeout=90) as r:
        print(f"HTTP {r.status}: {r.read().decode()[:500]}")
except urllib.error.HTTPError as e:
    body = e.read().decode()[:500]
    print(f"HTTP {e.code}: {body}")
except Exception as ex:
    print(f"ERROR: {ex}")

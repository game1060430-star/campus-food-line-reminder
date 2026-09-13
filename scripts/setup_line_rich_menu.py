import json
import os
import urllib.request
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "artifacts" / "line"
OUT_DIR.mkdir(parents=True, exist_ok=True)
IMAGE_PATH = OUT_DIR / "rich_menu.png"


def env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing {name}")
    return value


def request_json(url: str, token: str, payload: dict, method: str = "POST") -> dict:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30) as res:
        body = res.read().decode("utf-8")
        return json.loads(body) if body else {}


def request_bytes(url: str, token: str, data: bytes, content_type: str, method: str = "POST") -> None:
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Authorization": f"Bearer {token}", "Content-Type": content_type},
        method=method,
    )
    with urllib.request.urlopen(req, timeout=30):
        return


def delete_existing_default(token: str) -> None:
    req = urllib.request.Request(
        "https://api.line.me/v2/bot/user/all/richmenu",
        headers={"Authorization": f"Bearer {token}"},
        method="DELETE",
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except urllib.error.HTTPError as exc:
        if exc.code not in (404,):
            raise


def font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "C:/Windows/Fonts/msjh.ttc",
        "C:/Windows/Fonts/NotoSansTC-Regular.otf",
        "C:/Windows/Fonts/arial.ttf",
    ]
    for item in candidates:
        if Path(item).exists():
            return ImageFont.truetype(item, size)
    return ImageFont.load_default()


def center_text(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], text: str, fill: str, fnt: ImageFont.ImageFont) -> None:
    bbox = draw.multiline_textbbox((0, 0), text, font=fnt, spacing=12, align="center")
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    x = box[0] + (box[2] - box[0] - tw) / 2
    y = box[1] + (box[3] - box[1] - th) / 2
    draw.multiline_text((x, y), text, font=fnt, fill=fill, spacing=12, align="center")


def build_image() -> None:
    width, height = 2500, 843
    img = Image.new("RGB", (width, height), "#f3f5f0")
    draw = ImageDraw.Draw(img)
    title_font = font(66)
    small_font = font(30)
    icon_font = font(64)

    tiles = [
        ("查詢已登錄狀況", "看哪些日期已上傳 / 未上傳", "#0f766e", "1"),
        ("設定休假不提醒", "區間設定或月曆點選", "#be123c", "2"),
        ("LINE 操作說明", "已上傳 / 休假 / 查詢格式", "#4338ca", "3"),
    ]
    tile_w = width // 3
    for idx, (label, sub, color, mark) in enumerate(tiles):
        x1 = idx * tile_w
        x2 = width if idx == len(tiles) - 1 else x1 + tile_w
        draw.rectangle((x1, 0, x2, height), fill="#ffffff")
        draw.rectangle((x1 + 22, 28, x2 - 22, height - 28), outline=color, width=9)
        draw.ellipse((x1 + 322, 115, x1 + 486, 279), fill=color)
        center_text(draw, (x1 + 322, 115, x1 + 486, 279), mark, "#ffffff", icon_font)
        center_text(draw, (x1 + 44, 350, x2 - 44, 500), label, "#111827", title_font)
        center_text(draw, (x1 + 58, 555, x2 - 58, 690), sub, "#4b5563", small_font)
        if idx < len(tiles) - 1:
            draw.line((x2, 0, x2, height), fill="#d1d5db", width=6)
    img.save(IMAGE_PATH, "PNG", optimize=True)


def main() -> None:
    load_dotenv(ROOT / ".env")
    token = env("LINE_CHANNEL_ACCESS_TOKEN")
    build_image()
    payload = {
        "size": {"width": 2500, "height": 843},
        "selected": True,
        "name": "食材登錄快捷選單",
        "chatBarText": "快捷操作",
        "areas": [
            {"bounds": {"x": 0, "y": 0, "width": 833, "height": 843}, "action": {"type": "message", "text": "查詢已登錄狀況"}},
            {"bounds": {"x": 833, "y": 0, "width": 834, "height": 843}, "action": {"type": "message", "text": "設定休假不提醒"}},
            {"bounds": {"x": 1667, "y": 0, "width": 833, "height": 843}, "action": {"type": "message", "text": "說明"}},
        ],
    }
    response = request_json("https://api.line.me/v2/bot/richmenu", token, payload)
    rich_menu_id = response["richMenuId"]
    request_bytes(
        f"https://api-data.line.me/v2/bot/richmenu/{rich_menu_id}/content",
        token,
        IMAGE_PATH.read_bytes(),
        "image/png",
    )
    delete_existing_default(token)
    request_bytes(
        f"https://api.line.me/v2/bot/user/all/richmenu/{rich_menu_id}",
        token,
        b"",
        "application/json",
    )
    print(json.dumps({"richMenuId": rich_menu_id, "image": str(IMAGE_PATH)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

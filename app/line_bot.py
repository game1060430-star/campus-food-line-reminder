import base64
import hashlib
import hmac
import json
import os
import secrets
from urllib.parse import urlencode
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Branch, DailyMenu, LineBindingCode, LineUserBinding, UploadConfirmation


LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply"
LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push"


@dataclass
class LineConfig:
    channel_secret: str
    channel_access_token: str
    app_base_url: str

    @classmethod
    def from_env(cls) -> "LineConfig":
        return cls(
            channel_secret=os.getenv("LINE_CHANNEL_SECRET", ""),
            channel_access_token=os.getenv("LINE_CHANNEL_ACCESS_TOKEN", ""),
            app_base_url=os.getenv("APP_BASE_URL", "http://localhost:8000").rstrip("/"),
        )


def verify_line_signature(body: bytes, signature: str | None, secret: str) -> bool:
    if not secret:
        return True
    if not signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    expected = base64.b64encode(digest).decode("utf-8")
    return hmac.compare_digest(expected, signature)


def reply_text(reply_token: str | None, text: str, config: LineConfig | None = None) -> bool:
    if not reply_token:
        return False
    config = config or LineConfig.from_env()
    if not config.channel_access_token:
        return False
    payload = {
        "replyToken": reply_token,
        "messages": [{"type": "text", "text": text[:4900]}],
    }
    request = urllib.request.Request(
        LINE_REPLY_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.channel_access_token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return 200 <= response.status < 300


def push_text(line_user_id: str, text: str, config: LineConfig | None = None) -> bool:
    if not line_user_id:
        return False
    config = config or LineConfig.from_env()
    if not config.channel_access_token:
        return False
    payload = {
        "to": line_user_id,
        "messages": [{"type": "text", "text": text[:4900]}],
    }
    request = urllib.request.Request(
        LINE_PUSH_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {config.channel_access_token}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        return 200 <= response.status < 300


def handle_line_event(event: dict, db: Session, config: LineConfig | None = None) -> str | None:
    if event.get("type") != "message":
        return None
    message = event.get("message") or {}
    if message.get("type") != "text":
        return "目前支援文字指令。請輸入「說明」查看可用操作。"
    source = event.get("source") or {}
    line_user_id = source.get("userId")
    if not line_user_id:
        return "無法取得 LINE 使用者 ID，請確認是從官方帳號對話送出。"
    text = (message.get("text") or "").strip()
    return handle_line_text(text, line_user_id, db, config or LineConfig.from_env())


def handle_line_text(text: str, line_user_id: str, db: Session, config: LineConfig) -> str:
    normalized = text.replace("　", " ").strip()
    if normalized.startswith("綁定"):
        parts = normalized.split()
        if len(parts) < 2:
            return "請輸入「綁定 你的綁定碼」。綁定碼可在系統分店頁產生。"
        return bind_line_user(parts[1], line_user_id, db)

    bindings = active_bindings(line_user_id, db)
    if not bindings:
        return "尚未綁定分店。請先在系統分店頁產生綁定碼，再傳「綁定 綁定碼」。"

    if normalized in {"我的身分", "身分", "權限"}:
        return identity_text(bindings, db)
    if normalized in {"產生店長綁定碼", "新增店長", "店長綁定碼"}:
        return create_operator_code(line_user_id, db)
    if normalized in {"管理員說明", "管理"}:
        return admin_help_text(bindings)
    if normalized in {"安全連結", "登入連結", "網頁入口"}:
        return secure_web_link(config)
    if normalized in {"說明", "help", "Help", "HELP"}:
        return help_text(bindings)
    if normalized in {"今日狀態", "狀態", "今天"}:
        return today_status(bindings, db)
    if normalized in {"登錄狀況", "登錄狀況查詢", "上傳查詢", "查詢登錄"} or normalized.startswith("登錄狀況 "):
        return upload_confirmation_status(normalized, bindings, db)
    if normalized in {"上傳狀態", "任務", "待辦", "官方同步", "同步官方資料", "同步", "驗證碼", "captcha", "CAPTCHA"}:
        return "現在已改成手動下載 Excel 上傳，不再連官方平台登入或同步。請用「整理菜單」產生檔案。"
    if normalized in {"菜單", "排程", "整理菜單", "產生Excel", "產生 Excel"}:
        return f"整理上傳菜單：{secure_web_url(config, '/exports')}"
    if normalized in {"首頁", "主選單", "工作區", "分店管理", "資源共享"}:
        return f"系統首頁：{secure_web_url(config, '/')}"
    if normalized in {"確認上傳", "上傳確認", "我已上傳"}:
        return f"上傳確認：{secure_web_url(config, '/uploads')}"
    if normalized in {"食材", "進貨", "新增食材"}:
        return f"食材主檔：{secure_web_url(config, '/ingredients')}"
    return help_text()


def bind_line_user(code: str, line_user_id: str, db: Session) -> str:
    item = db.scalar(
        select(LineBindingCode).where(
            LineBindingCode.code == code.strip(),
            LineBindingCode.active == True,
        )
    )
    if not item:
        return "綁定碼無效或已停用，請在分店頁重新產生。"
    existing = db.scalar(
        select(LineUserBinding).where(
            LineUserBinding.line_user_id == line_user_id,
            LineUserBinding.branch_id == item.branch_id,
        )
    )
    if existing:
        existing.active = True
        existing.role = item.role or "operator"
    else:
        db.add(LineUserBinding(line_user_id=line_user_id, branch_id=item.branch_id, role=item.role or "operator"))
    item.active = False
    db.commit()
    branch = db.get(Branch, item.branch_id)
    role_name = "管理員" if (item.role or "operator") == "admin" else "店長"
    return f"已綁定「{branch.name if branch else '分店'}」，身分：{role_name}。之後可傳「整理菜單」、「今日狀態」或「安全連結」。"


def active_bindings(line_user_id: str, db: Session) -> list[LineUserBinding]:
    return db.scalars(
        select(LineUserBinding).where(
            LineUserBinding.line_user_id == line_user_id,
            LineUserBinding.active == True,
        )
    ).all()


def is_admin(bindings: list[LineUserBinding]) -> bool:
    return any(b.role == "admin" for b in bindings)


def help_text(bindings: list[LineUserBinding] | None = None) -> str:
    lines = ["可用指令：", "綁定 綁定碼", "整理菜單", "上傳確認", "登錄狀況", "食材", "今日狀態", "安全連結", "我的身分"]
    if bindings and is_admin(bindings):
        lines.extend(["管理員說明", "產生店長綁定碼"])
    return "\n".join(lines)


def admin_help_text(bindings: list[LineUserBinding]) -> str:
    if not is_admin(bindings):
        return "這個指令只有管理員可以使用。"
    return "管理員指令：\n產生店長綁定碼：產生一次性店長綁定碼\n我的身分：查看目前權限"


def secure_web_link(config: LineConfig) -> str:
    url = secure_web_url(config, "/")
    if not url:
        return "尚未設定網頁安全連結，請先設定 WEB_ACCESS_TOKEN。"
    return f"管理員網頁入口：{url}"


def secure_web_url(config: LineConfig, path: str = "/") -> str:
    token = os.getenv("WEB_ACCESS_TOKEN", "").strip()
    if not token:
        return ""
    return f"{config.app_base_url}/login?{urlencode({'token': token, 'next': path})}"


def identity_text(bindings: list[LineUserBinding], db: Session) -> str:
    lines = ["你的綁定身分"]
    for binding in bindings:
        branch = db.get(Branch, binding.branch_id)
        role_name = "管理員" if binding.role == "admin" else "店長"
        lines.append(f"{branch.name if branch else '分店'}：{role_name}")
    return "\n".join(lines)


def create_operator_code(line_user_id: str, db: Session) -> str:
    bindings = active_bindings(line_user_id, db)
    admin_bindings = [b for b in bindings if b.role == "admin"]
    if not admin_bindings:
        return "只有管理員可以產生店長綁定碼。"
    branch_id = admin_bindings[0].branch_id
    branch = db.get(Branch, branch_id)
    code = secrets.token_hex(3).upper()
    while db.scalar(select(LineBindingCode).where(LineBindingCode.code == code)):
        code = secrets.token_hex(3).upper()
    db.add(LineBindingCode(branch_id=branch_id, code=code, role="operator"))
    db.commit()
    return f"已產生「{branch.name if branch else '分店'}」店長綁定碼：{code}\n請店長傳：綁定 {code}\n此碼只能使用一次。"


def today_status(bindings: list[LineUserBinding], db: Session) -> str:
    today = date.today()
    lines = [f"今日狀態 {today.isoformat()}"]
    for binding in bindings:
        branch = db.get(Branch, binding.branch_id)
        if not branch:
            continue
        menus = db.scalars(
            select(DailyMenu).where(
                DailyMenu.branch_id == branch.id,
                DailyMenu.service_date == today,
            )
        ).all()
        menu_text = f"{len(menus)} 道菜" if menus else "尚未排菜"
        lines.append(f"{branch.name}：{menu_text}")
    return "\n".join(lines)


def parse_status_range(text: str) -> tuple[date, date]:
    parts = text.split()
    if len(parts) >= 3:
        start = date.fromisoformat(parts[1])
        end = date.fromisoformat(parts[2])
    elif len(parts) == 2:
        start = date.fromisoformat(parts[1])
        end = start + timedelta(days=13)
    else:
        start = date.today()
        end = start + timedelta(days=13)
    if end < start:
        start, end = end, start
    return start, end


def upload_confirmation_status(text: str, bindings: list[LineUserBinding], db: Session) -> str:
    try:
        start, end = parse_status_range(text)
    except ValueError:
        return "日期格式請用：登錄狀況 2026-09-14 2026-09-30"

    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)

    lines = [f"登錄狀況 {start.isoformat()} ~ {end.isoformat()}"]
    for binding in bindings:
        branch = db.get(Branch, binding.branch_id)
        if not branch:
            continue
        confirmations = {
            item.service_date
            for item in db.scalars(
                select(UploadConfirmation).where(
                    UploadConfirmation.branch_id == branch.id,
                    UploadConfirmation.service_date.in_(days),
                )
            ).all()
        }
        menu_counts: dict[date, int] = {}
        for menu in db.scalars(
            select(DailyMenu).where(
                DailyMenu.branch_id == branch.id,
                DailyMenu.service_date.in_(days),
            )
        ).all():
            menu_counts[menu.service_date] = menu_counts.get(menu.service_date, 0) + 1

        uploaded = [d for d in days if d in confirmations]
        missing = [d for d in days if d.weekday() < 5 and d not in confirmations]
        weekends = [d for d in days if d.weekday() >= 5]

        lines.append(f"\n{branch.name}")
        lines.append(f"已確認：{format_days(uploaded) if uploaded else '無'}")
        lines.append(f"未確認：{format_days(missing) if missing else '無'}")
        if weekends:
            lines.append(f"六日略過：{format_days(weekends)}")
        no_menu = [d for d in days if d.weekday() < 5 and menu_counts.get(d, 0) == 0]
        if no_menu:
            lines.append(f"尚未排菜：{format_days(no_menu)}")
    return "\n".join(lines)


def format_days(days: list[date]) -> str:
    return "、".join(day.strftime("%m/%d") for day in days)

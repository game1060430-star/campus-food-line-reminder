import base64
import hashlib
import hmac
import json
import os
import secrets
import base64
import time
from urllib.parse import urlencode
import urllib.request
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Branch, ClosedDate, DailyMenu, LineBindingCode, LineUserBinding, UploadConfirmation


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
    if normalized in {"設定休假不提醒", "設定不提醒日期", "休假設定", "不提醒設定"}:
        url = line_bound_web_url(config, line_user_id, "/uploads")
        return f"設定休假 / 不提醒日期：{url}" if url else "尚未設定 WEB_ACCESS_TOKEN，無法產生專屬連結。"
    if normalized.startswith(("已上傳", "確認上傳", "上傳完成")):
        return record_upload_confirmation_from_text(normalized, bindings, db)
    if normalized.startswith(("休息", "休息日", "公休", "休假", "不提醒")):
        return record_closed_dates_from_text(normalized, bindings, db)
    if normalized in {"今日狀態", "狀態", "今天"}:
        return today_status(bindings, db)
    if normalized in {"登錄狀況", "登錄狀況查詢", "上傳查詢", "查詢登錄", "查詢已登錄狀況"} or normalized.startswith(("登錄狀況 ", "查詢已登錄狀況 ")):
        return upload_confirmation_status(normalized, bindings, db)
    if normalized in {"上傳狀態", "任務", "待辦", "官方同步", "同步官方資料", "同步", "驗證碼", "captcha", "CAPTCHA"}:
        return "現在已改成手動下載 Excel 上傳，不再連官方平台登入或同步。請用「整理菜單」產生檔案。"
    if normalized in {"菜單", "排程", "整理菜單", "產生Excel", "產生 Excel"}:
        return f"整理上傳菜單：{secure_web_url(config, '/exports')}"
    if normalized in {"首頁", "主選單", "工作區", "分店管理", "資源共享"}:
        return f"系統首頁：{secure_web_url(config, '/')}"
    if normalized in {"確認上傳", "上傳確認", "我已上傳"}:
        url = line_bound_web_url(config, line_user_id, "/uploads")
        return f"上傳確認：{url}" if url else f"上傳確認：{secure_web_url(config, '/uploads')}"
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
    lines = [
        "可用指令：",
        "綁定 綁定碼",
        "已上傳 店名 2026-09-14 2026-09-18",
        "休假 店名 2026-09-18 2026-09-20",
        "不提醒 店名 2026-09-18 2026-09-20",
        "登錄狀況 2026-09-14 2026-09-30",
        "整理菜單",
        "食材",
        "今日狀態",
        "安全連結",
        "我的身分",
    ]
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


def line_bound_web_url(config: LineConfig, line_user_id: str, path: str = "/uploads") -> str:
    token = make_line_access_token(line_user_id)
    if not token:
        return ""
    return f"{config.app_base_url}/line-login?{urlencode({'token': token, 'next': path})}"


def make_line_access_token(line_user_id: str, max_age_seconds: int = 60 * 60 * 24 * 7) -> str:
    secret = os.getenv("WEB_ACCESS_TOKEN", "").strip()
    if not secret:
        return ""
    expires = str(int(time.time()) + max_age_seconds)
    payload = _b64url(f"{line_user_id}|{expires}".encode())
    signature = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


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


def parse_iso_date(value: str) -> date:
    return date.fromisoformat(value.replace("/", "-"))


def dates_between(start: date, end: date) -> list[date]:
    if end < start:
        start, end = end, start
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def find_bound_branch(tokens: list[str], bindings: list[LineUserBinding], db: Session) -> tuple[Branch | None, list[str]]:
    branches = [db.get(Branch, binding.branch_id) for binding in bindings]
    branches = [branch for branch in branches if branch]
    if not branches:
        return None, tokens
    if len(branches) == 1:
        if tokens and tokens[0] == branches[0].name:
            return branches[0], tokens[1:]
        return branches[0], tokens
    if not tokens:
        return None, tokens
    branch_name = tokens[0]
    for branch in branches:
        if branch.name == branch_name:
            return branch, tokens[1:]
    return None, tokens


def parse_branch_date_command(text: str, bindings: list[LineUserBinding], db: Session) -> tuple[Branch | None, date | None, date | None, str | None]:
    parts = text.split()
    if len(parts) < 2:
        return None, None, None, "格式請用：已上傳 店名 2026-09-14 2026-09-18"
    tokens = parts[1:]
    branch, remaining = find_bound_branch(tokens, bindings, db)
    if not branch:
        return None, None, None, "找不到這個分店，請確認店名和 LINE 綁定分店一致。"
    if not remaining:
        return branch, None, None, "請加上日期，例如：2026-09-14 2026-09-18"
    try:
        start = parse_iso_date(remaining[0])
        end = parse_iso_date(remaining[1]) if len(remaining) >= 2 else start
    except ValueError:
        return branch, None, None, "日期格式請用：2026-09-14"
    return branch, start, end, None


def upsert_upload_confirmation(db: Session, branch_id: int, service_date: date, confirmed_by: str, note: str = "") -> None:
    item = db.scalar(
        select(UploadConfirmation).where(
            UploadConfirmation.branch_id == branch_id,
            UploadConfirmation.service_date == service_date,
        )
    )
    if item:
        item.confirmed_by = confirmed_by
        item.note = note or item.note
    else:
        db.add(UploadConfirmation(branch_id=branch_id, service_date=service_date, confirmed_by=confirmed_by, note=note or None))


def upsert_closed_date(db: Session, branch_id: int, service_date: date, reason: str = "") -> None:
    item = db.scalar(
        select(ClosedDate).where(
            ClosedDate.branch_id == branch_id,
            ClosedDate.service_date == service_date,
        )
    )
    if item:
        item.reason = reason or item.reason
    else:
        db.add(ClosedDate(branch_id=branch_id, service_date=service_date, reason=reason or "休息"))


def record_upload_confirmation_from_text(text: str, bindings: list[LineUserBinding], db: Session) -> str:
    branch, start, end, error = parse_branch_date_command(text, bindings, db)
    if error:
        return error.replace("已上傳", "已上傳")
    assert branch and start and end
    days = [day for day in dates_between(start, end) if day.weekday() < 5]
    closed = {
        item.service_date
        for item in db.scalars(
            select(ClosedDate).where(
                ClosedDate.branch_id == branch.id,
                ClosedDate.service_date.in_(days),
            )
        ).all()
    }
    confirmed = [day for day in days if day not in closed]
    for day in confirmed:
        upsert_upload_confirmation(db, branch.id, day, "LINE", "LINE文字確認")
    db.commit()
    skipped = len(days) - len(confirmed)
    return f"已記錄「{branch.name}」{start.isoformat()} ~ {end.isoformat()} 已上傳，共 {len(confirmed)} 天。{'休息日略過 ' + str(skipped) + ' 天。' if skipped else ''}"


def record_closed_dates_from_text(text: str, bindings: list[LineUserBinding], db: Session) -> str:
    branch, start, end, error = parse_branch_date_command(text, bindings, db)
    if error:
        return error.replace("已上傳", "休息")
    assert branch and start and end
    days = dates_between(start, end)
    for day in days:
        upsert_closed_date(db, branch.id, day, "LINE設定休息")
    db.commit()
    return f"已記錄「{branch.name}」{start.isoformat()} ~ {end.isoformat()} 休息，共 {len(days)} 天；這些日期不會提醒未上傳。"


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
        closed = {
            item.service_date
            for item in db.scalars(
                select(ClosedDate).where(
                    ClosedDate.branch_id == branch.id,
                    ClosedDate.service_date.in_(days),
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
        missing = [d for d in days if d.weekday() < 5 and d not in confirmations and d not in closed]
        weekends = [d for d in days if d.weekday() >= 5]
        closed_days = [d for d in days if d in closed]

        lines.append(f"\n{branch.name}")
        lines.append(f"已確認：{format_days(uploaded) if uploaded else '無'}")
        lines.append(f"未確認：{format_days(missing) if missing else '無'}")
        if weekends:
            lines.append(f"六日略過：{format_days(weekends)}")
        if closed_days:
            lines.append(f"休息略過：{format_days(closed_days)}")
        no_menu = [d for d in days if d.weekday() < 5 and d not in closed and menu_counts.get(d, 0) == 0]
        if no_menu:
            lines.append(f"尚未排菜：{format_days(no_menu)}")
    return "\n".join(lines)


def format_days(days: list[date]) -> str:
    return "、".join(day.strftime("%m/%d") for day in days)

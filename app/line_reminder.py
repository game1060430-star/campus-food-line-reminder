import base64
import hashlib
import hmac
import os
import secrets
import time
from datetime import date, timedelta
from urllib.parse import urlencode, urlsplit, urlunsplit, parse_qsl

from fastapi import Depends, FastAPI, Form, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, engine, get_db
from .line_bot import LineConfig, handle_line_event, reply_text, verify_line_signature
from .models import Branch, ClosedDate, LineBindingCode, LineUserBinding, UploadConfirmation
from .services.excel_export import parse_excluded_dates, service_dates
from .services.upload_reminders import send_due_upload_reminders

Base.metadata.create_all(bind=engine)

app = FastAPI(title="食材登錄 LINE 提醒")
BASE = os.path.dirname(__file__)
templates = Jinja2Templates(directory=os.path.join(BASE, "templates"))
app.mount("/static", StaticFiles(directory=os.path.join(BASE, "static")), name="static")

PUBLIC_PREFIXES = ("/api/line/webhook", "/health", "/line-login", "/static/")
DEFAULT_WEEKDAYS = "0,1,2,3,4"


def web_access_token() -> str:
    return os.getenv("WEB_ACCESS_TOKEN", "").strip()


def _b64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _b64url_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def verify_line_access_token(token: str) -> str | None:
    secret = web_access_token()
    if not secret or "." not in (token or ""):
        return None
    payload, signature = token.split(".", 1)
    expected = _b64url(hmac.new(secret.encode(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        line_user_id, expires = _b64url_decode(payload).decode().rsplit("|", 1)
    except Exception:
        return None
    try:
        expired = int(expires) < int(time.time())
    except ValueError:
        return None
    if expired:
        return None
    return line_user_id


def parse_weekdays(raw: str) -> set[int]:
    return {int(x) for x in (raw or DEFAULT_WEEKDAYS).split(",") if x}


def date_today_iso() -> str:
    return date.today().isoformat()


def current_line_user_id(request: Request) -> str | None:
    return getattr(request.state, "line_user_id", None)


def current_access_token(request: Request) -> str:
    return getattr(request.state, "line_access_token", "")


def with_access(request: Request, path: str) -> str:
    access = current_access_token(request)
    if not access:
        return path
    parts = urlsplit(path)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["access"] = access
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def bound_branch_ids(request: Request, db: Session) -> set[int] | None:
    line_user_id = current_line_user_id(request)
    if not line_user_id:
        return None
    return set(
        db.scalars(
            select(LineUserBinding.branch_id).where(
                LineUserBinding.line_user_id == line_user_id,
                LineUserBinding.active == True,
            )
        ).all()
    )


def visible_branches(request: Request, db: Session) -> list[Branch]:
    branches = db.scalars(select(Branch).where(Branch.active == True).order_by(Branch.name)).all()
    allowed = bound_branch_ids(request, db)
    if allowed is None:
        return branches
    return [branch for branch in branches if branch.id in allowed]


def require_branch_allowed(request: Request, db: Session, branch_id: int) -> None:
    allowed = bound_branch_ids(request, db)
    if allowed is not None and branch_id not in allowed:
        raise HTTPException(403)


def confirm_upload_dates(db: Session, branch_id: int, dates: list[date], confirmed_by: str = "", note: str = "") -> None:
    for service_date in dates:
        existing = db.scalar(
            select(UploadConfirmation).where(
                UploadConfirmation.branch_id == branch_id,
                UploadConfirmation.service_date == service_date,
            )
        )
        if existing:
            existing.confirmed_by = confirmed_by or existing.confirmed_by
            existing.note = note or existing.note
        else:
            db.add(UploadConfirmation(branch_id=branch_id, service_date=service_date, confirmed_by=confirmed_by or None, note=note or None))
    db.commit()


def set_closed_dates(db: Session, branch_id: int, dates: list[date], reason: str = "") -> None:
    for service_date in dates:
        existing = db.scalar(select(ClosedDate).where(ClosedDate.branch_id == branch_id, ClosedDate.service_date == service_date))
        if existing:
            existing.reason = reason or existing.reason
        else:
            db.add(ClosedDate(branch_id=branch_id, service_date=service_date, reason=reason or "休息"))
    db.commit()


def clear_closed_dates(db: Session, branch_id: int, dates: list[date]) -> None:
    for item in db.scalars(select(ClosedDate).where(ClosedDate.branch_id == branch_id, ClosedDate.service_date.in_(dates))).all():
        db.delete(item)
    db.commit()


@app.middleware("http")
async def require_access(request: Request, call_next):
    path = request.url.path
    if path.startswith(PUBLIC_PREFIXES):
        return await call_next(request)
    token = web_access_token()
    query_token = request.query_params.get("token", "")
    if token and query_token and secrets.compare_digest(query_token, token):
        return await call_next(request)
    query_access = request.query_params.get("access", "")
    line_user_id = verify_line_access_token(query_access)
    if line_user_id:
        request.state.line_user_id = line_user_id
        request.state.line_access_token = query_access
        return await call_next(request)
    line_user_id = verify_line_access_token(request.cookies.get("line_access", ""))
    if line_user_id:
        request.state.line_user_id = line_user_id
        return await call_next(request)
    if token and request.cookies.get("web_access") == token:
        return await call_next(request)
    return PlainTextResponse("請從 LINE 機器人取得專屬連結。", status_code=403)


@app.get("/health")
def health():
    return {"ok": True, "service": "line-reminder"}


@app.get("/")
def root():
    return RedirectResponse("/uploads", 303)


@app.get("/login")
def admin_login(token: str = "", next: str = "/admin/branches"):
    if not web_access_token() or not secrets.compare_digest(token, web_access_token()):
        raise HTTPException(403)
    if not next.startswith("/") or next.startswith("//"):
        next = "/admin/branches"
    response = RedirectResponse(next, 303)
    response.set_cookie("web_access", token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 30)
    return response


@app.get("/line-login")
def line_login(token: str = "", next: str = "/uploads"):
    line_user_id = verify_line_access_token(token)
    if not line_user_id:
        raise HTTPException(403)
    if not next.startswith("/") or next.startswith("//"):
        next = "/uploads"
    parts = urlsplit(next)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["access"] = token
    target = urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    response = RedirectResponse(target, 303)
    response.set_cookie("line_access", token, httponly=True, samesite="lax", max_age=60 * 60 * 24 * 7)
    return response


@app.get("/uploads", response_class=HTMLResponse)
def uploads_page(request: Request, branch_id: int | None = None, date: str | None = None, db: Session = Depends(get_db)):
    branches = visible_branches(request, db)
    if current_line_user_id(request) and not branches:
        return PlainTextResponse("這個 LINE 帳號尚未綁定任何分店。", status_code=403)
    selected_branch_id = branch_id or (branches[0].id if branches else 0)
    if selected_branch_id:
        require_branch_allowed(request, db, selected_branch_id)
    selected_date = date or date_today_iso()
    start = date_from_iso(selected_date)
    days = [start + timedelta(days=i) for i in range(14)]
    month_start = start.replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    calendar_days = [month_start + timedelta(days=i) for i in range((month_end - month_start).days + 1)]
    previous_month = (month_start - timedelta(days=1)).replace(day=1)
    lookup_days = calendar_days + days
    confirmations = {(c.branch_id, c.service_date): c for c in db.scalars(select(UploadConfirmation).where(UploadConfirmation.service_date.in_(lookup_days))).all()}
    closed_dates = {(c.branch_id, c.service_date): c for c in db.scalars(select(ClosedDate).where(ClosedDate.service_date.in_(lookup_days))).all()}
    return templates.TemplateResponse(
        "line_uploads.html",
        {
            "request": request,
            "branches": branches,
            "selected_branch_id": selected_branch_id,
            "selected_date": selected_date,
            "days": days,
            "calendar_days": calendar_days,
            "calendar_offset": month_start.weekday(),
            "month_start": month_start,
            "previous_month": previous_month,
            "next_month": next_month,
            "confirmations": confirmations,
            "closed_dates": closed_dates,
            "notice": request.query_params.get("notice"),
            "access_token": current_access_token(request),
            "with_access": lambda path: with_access(request, path),
        },
    )


def date_from_iso(value: str) -> date:
    return date.fromisoformat(value)


@app.post("/uploads/confirm")
def confirm_upload(request: Request, branch_id: int = Form(...), start_date: date = Form(...), end_date: date = Form(...), weekdays: str = Form(DEFAULT_WEEKDAYS), excluded_dates: str = Form(""), access: str = Form(""), db: Session = Depends(get_db)):
    require_branch_allowed(request, db, branch_id)
    dates = service_dates(start_date, end_date, parse_weekdays(weekdays), parse_excluded_dates(excluded_dates))
    confirm_upload_dates(db, branch_id, dates, "LINE網頁", "")
    target = f"/uploads?branch_id={branch_id}&date={start_date.isoformat()}&notice=confirmed"
    if access:
        target += f"&{urlencode({'access': access})}"
    return RedirectResponse(target, 303)


@app.post("/uploads/closed")
def mark_closed_dates(request: Request, branch_id: int = Form(...), start_date: date = Form(...), end_date: date = Form(...), weekdays: str = Form("0,1,2,3,4,5,6"), excluded_dates: str = Form(""), reason: str = Form(""), access: str = Form(""), db: Session = Depends(get_db)):
    require_branch_allowed(request, db, branch_id)
    dates = service_dates(start_date, end_date, parse_weekdays(weekdays), parse_excluded_dates(excluded_dates))
    set_closed_dates(db, branch_id, dates, reason)
    target = f"/uploads?branch_id={branch_id}&date={start_date.isoformat()}&notice=closed"
    if access:
        target += f"&{urlencode({'access': access})}"
    return RedirectResponse(target, 303)


@app.post("/uploads/calendar")
async def update_upload_calendar(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    branch_id = int(form.get("branch_id") or 0)
    require_branch_allowed(request, db, branch_id)
    selected = [date.fromisoformat(str(value)) for value in form.getlist("dates")]
    action = str(form.get("calendar_action") or "")
    month_date = str(form.get("month_date") or date_today_iso())
    access = str(form.get("access") or "")
    if selected and action == "closed":
        set_closed_dates(db, branch_id, selected, str(form.get("reason") or "行事曆設定休假"))
        notice = "closed"
    elif selected and action == "open":
        clear_closed_dates(db, branch_id, selected)
        notice = "opened"
    elif selected and action == "confirmed":
        confirm_upload_dates(db, branch_id, selected, "LINE網頁", "")
        notice = "confirmed"
    else:
        notice = "none"
    target = f"/uploads?branch_id={branch_id}&date={month_date}&notice={notice}"
    if access:
        target += f"&{urlencode({'access': access})}"
    return RedirectResponse(target, 303)


@app.get("/admin/branches", response_class=HTMLResponse)
def admin_branches(request: Request, db: Session = Depends(get_db)):
    branches = db.scalars(select(Branch).where(Branch.active == True).order_by(Branch.name)).all()
    codes = {code.branch_id: code for code in db.scalars(select(LineBindingCode).where(LineBindingCode.active == True)).all()}
    return templates.TemplateResponse("line_admin_branches.html", {"request": request, "branches": branches, "codes": codes})


@app.post("/admin/branches")
def create_branch(name: str = Form(...), db: Session = Depends(get_db)):
    db.add(Branch(name=name, school_name=name, service_location="午餐", restaurant_name=name))
    db.commit()
    return RedirectResponse("/admin/branches", 303)


@app.post("/admin/branches/{branch_id}/code")
def create_binding_code(branch_id: int, db: Session = Depends(get_db)):
    branch = db.get(Branch, branch_id)
    if not branch:
        raise HTTPException(404)
    for old in db.scalars(select(LineBindingCode).where(LineBindingCode.branch_id == branch_id, LineBindingCode.active == True)).all():
        old.active = False
    code = secrets.token_hex(3).upper()
    while db.scalar(select(LineBindingCode).where(LineBindingCode.code == code)):
        code = secrets.token_hex(3).upper()
    db.add(LineBindingCode(branch_id=branch_id, code=code, role="operator"))
    db.commit()
    return RedirectResponse("/admin/branches", 303)


@app.post("/api/line/webhook")
async def line_webhook(request: Request):
    body = await request.body()
    config = LineConfig.from_env()
    if not verify_line_signature(body, request.headers.get("X-Line-Signature"), config.channel_secret):
        raise HTTPException(status_code=403, detail="invalid LINE signature")
    payload = await request.json()
    sent = 0
    errors = []
    db = next(get_db())
    try:
        for event in payload.get("events", []):
            text = handle_line_event(event, db, config)
            if text:
                try:
                    if reply_text(event.get("replyToken"), text, config):
                        sent += 1
                except Exception as exc:
                    errors.append(str(exc))
    finally:
        db.close()
    return JSONResponse({"ok": True, "received": len(payload.get("events", [])), "replied": sent, "errors": errors})


@app.post("/tasks/upload-reminders")
def run_upload_reminders_task(db: Session = Depends(get_db)):
    result = send_due_upload_reminders(db)
    return {
        "ok": not result.errors,
        "target_date": result.target_date.isoformat(),
        "skipped": result.skipped,
        "sent": result.sent,
        "messages": result.messages,
        "errors": result.errors,
    }

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..line_bot import LineConfig, push_text, secure_web_url
from ..models import Branch, ClosedDate, DailyMenu, LineUserBinding, UploadConfirmation


@dataclass
class ReminderResult:
    target_date: date
    skipped: bool
    sent: int
    messages: list[str]
    errors: list[str]


def tomorrow(today: date | None = None) -> date:
    return (today or date.today()) + timedelta(days=1)


def send_due_upload_reminders(db: Session, target_date: date | None = None, config: LineConfig | None = None) -> ReminderResult:
    target = target_date or tomorrow()
    if target.weekday() >= 5:
        return ReminderResult(target, True, 0, [f"{target.isoformat()} 是六日，略過提醒。"], [])

    config = config or LineConfig.from_env()
    sent = 0
    messages: list[str] = []
    errors: list[str] = []
    branches = db.scalars(select(Branch).where(Branch.active == True).order_by(Branch.name)).all()
    for branch in branches:
        closed = db.scalar(
            select(ClosedDate).where(
                ClosedDate.branch_id == branch.id,
                ClosedDate.service_date == target,
            )
        )
        if closed:
            messages.append(f"{branch.name} {target.isoformat()} 是休息日，略過提醒。")
            continue

        confirmed = db.scalar(
            select(UploadConfirmation).where(
                UploadConfirmation.branch_id == branch.id,
                UploadConfirmation.service_date == target,
            )
        )
        if confirmed:
            continue

        menu_count = len(
            db.scalars(
                select(DailyMenu).where(
                    DailyMenu.branch_id == branch.id,
                    DailyMenu.service_date == target,
                )
            ).all()
        )
        status = f"已排 {menu_count} 道菜" if menu_count else "尚未排菜"
        link = secure_web_url(config, f"/uploads?branch_id={branch.id}&date={target.isoformat()}")
        text = (
            f"提醒：{branch.name} 明天 {target.isoformat()} 尚未確認食材登錄已上傳。\n"
            f"{status}。\n"
            f"若已到官方平台上傳，請回系統按「我已上傳」：{link}"
        )
        bindings = db.scalars(
            select(LineUserBinding).where(
                LineUserBinding.branch_id == branch.id,
                LineUserBinding.active == True,
            )
        ).all()
        if not bindings:
            messages.append(f"{branch.name} 尚未確認，但沒有 LINE 綁定使用者。")
            continue
        for binding in bindings:
            try:
                if push_text(binding.line_user_id, text, config):
                    sent += 1
            except Exception as exc:
                errors.append(f"{branch.name}: {exc}")
        messages.append(f"{branch.name} 尚未確認，已通知 {len(bindings)} 位 LINE 使用者。")

    return ReminderResult(target, False, sent, messages, errors)

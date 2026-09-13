from __future__ import annotations

from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from app.database import SessionLocal
from app.services.upload_reminders import send_due_upload_reminders


def main() -> None:
    db = SessionLocal()
    try:
        result = send_due_upload_reminders(db)
        print(
            {
                "target_date": result.target_date.isoformat(),
                "skipped": result.skipped,
                "sent": result.sent,
                "messages": result.messages,
                "errors": result.errors,
            }
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()

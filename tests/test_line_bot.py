import base64
import hashlib
import hmac
from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.line_bot import LineConfig, bind_line_user, handle_line_text, verify_line_signature
from app.hygiene_owner import bootstrap_password_valid, claim_pair_code, create_pair_code
from app.models import Base, Branch, ClosedDate, HygieneOwnerBinding, LineBindingCode, LineUserBinding, UploadConfirmation


def make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    return session


def test_verify_line_signature_accepts_valid_hmac():
    body = b'{"events":[]}'
    secret = "line-secret"
    signature = base64.b64encode(
        hmac.new(secret.encode("utf-8"), body, hashlib.sha256).digest()
    ).decode("utf-8")

    assert verify_line_signature(body, signature, secret)
    assert not verify_line_signature(body, "bad-signature", secret)


def test_bind_line_user_consumes_branch_code():
    db = make_db()
    branch = Branch(
        name="A店",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineBindingCode(branch_id=branch.id, code="ABC123"))
    db.commit()

    message = bind_line_user("ABC123", "U123", db)

    binding = db.query(LineUserBinding).filter_by(line_user_id="U123", branch_id=branch.id).one()
    code = db.query(LineBindingCode).filter_by(code="ABC123").one()
    assert "已綁定" in message
    assert binding.active is True
    assert code.active is False


def test_admin_binding_can_create_operator_code():
    db = make_db()
    branch = Branch(
        name="A店",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineBindingCode(branch_id=branch.id, code="ADMIN1", role="admin"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    bind_line_user("ADMIN1", "UADMIN", db)
    message = handle_line_text("產生店長綁定碼", "UADMIN", db, config)

    assert "店長綁定碼" in message
    assert db.query(LineBindingCode).filter_by(branch_id=branch.id, role="operator", active=True).count() == 1


def test_operator_cannot_create_operator_code():
    db = make_db()
    branch = Branch(
        name="A店",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineBindingCode(branch_id=branch.id, code="OP1234", role="operator"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    bind_line_user("OP1234", "UOP", db)
    message = handle_line_text("產生店長綁定碼", "UOP", db, config)

    assert "只有管理員" in message


def test_hygiene_owner_link_requires_paired_line_id_and_is_short_lived(monkeypatch):
    monkeypatch.setenv("WEB_ACCESS_TOKEN", "test-only-secret")
    db = make_db()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    assert "尚未設為" in handle_line_text("衛生管理", "UOWNER", db, config)
    code = create_pair_code(db)
    assert "已綁定" in handle_line_text("綁定衛生主控 " + code, "UOWNER", db, config)
    assert db.get(HygieneOwnerBinding, 1).line_user_id == "UOWNER"
    assert "無效" in handle_line_text("綁定衛生主控 " + code, "UOP", db, config)

    owner_message = handle_line_text("衛生管理", "UOWNER", db, config)
    operator_message = handle_line_text("衛生管理", "UOP", db, config)

    assert "#owner=" in owner_message
    assert "15 分鐘" in owner_message
    assert "尚未設為" in operator_message
    token = owner_message.split("#owner=", 1)[1].splitlines()[0]
    payload = base64.urlsafe_b64decode(token.split(".", 1)[0] + "==").decode()
    assert payload.startswith("wazi-hygiene-owner|UOWNER|")


def test_hygiene_pair_code_rejects_wrong_and_expired_codes():
    from datetime import datetime, timedelta, timezone
    from app.models import HygienePairCode

    db = make_db()
    code = create_pair_code(db)
    assert not claim_pair_code(db, "BADCODE", "UOWNER")
    row = db.query(HygienePairCode).one()
    row.expires_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)
    db.commit()
    assert not claim_pair_code(db, code, "UOWNER")


def test_hygiene_bootstrap_password_hash():
    assert not bootstrap_password_valid("incorrect")


def test_line_text_requires_binding_before_status():
    db = make_db()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    message = handle_line_text("今日狀態", "U123", db, config)

    assert "尚未綁定分店" in message


def test_removed_captcha_command_points_to_line_reminder_scope():
    db = make_db()
    branch = Branch(
        name="A店",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineUserBinding(line_user_id="UADMIN", branch_id=branch.id, role="admin"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    message = handle_line_text("驗證碼", "UADMIN", db, config)

    assert "LINE 只負責提醒" in message


def test_upload_status_query_reports_confirmed_and_missing_days():
    db = make_db()
    branch = Branch(
        name="A店",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineUserBinding(line_user_id="UADMIN", branch_id=branch.id, role="admin"))
    db.add(UploadConfirmation(branch_id=branch.id, service_date=date(2026, 9, 14), confirmed_by="店長"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    message = handle_line_text("登錄狀況 2026-09-14 2026-09-16", "UADMIN", db, config)

    assert "已確認：09/14" in message
    assert "未確認：09/15、09/16" in message


def test_line_upload_confirmation_text_records_range():
    db = make_db()
    branch = Branch(
        name="娃子",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineUserBinding(line_user_id="UADMIN", branch_id=branch.id, role="admin"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    message = handle_line_text("已上傳 娃子 2026-09-14 2026-09-16", "UADMIN", db, config)

    confirmations = db.query(UploadConfirmation).filter_by(branch_id=branch.id).all()
    assert "共 3 天" in message
    assert {item.service_date for item in confirmations} == {
        date(2026, 9, 14),
        date(2026, 9, 15),
        date(2026, 9, 16),
    }


def test_line_closed_dates_are_skipped_in_status():
    db = make_db()
    branch = Branch(
        name="娃子",
        school_name="A校",
        service_location="午餐",
        restaurant_name="A餐廳",
    )
    db.add(branch)
    db.commit()
    db.add(LineUserBinding(line_user_id="UADMIN", branch_id=branch.id, role="admin"))
    db.commit()
    config = LineConfig(channel_secret="", channel_access_token="", app_base_url="https://example.test")

    close_message = handle_line_text("休息 娃子 2026-09-15", "UADMIN", db, config)
    status_message = handle_line_text("登錄狀況 2026-09-14 2026-09-16", "UADMIN", db, config)

    assert "不會提醒" in close_message
    assert db.query(ClosedDate).filter_by(branch_id=branch.id, service_date=date(2026, 9, 15)).count() == 1
    assert "休息略過：09/15" in status_message
    assert "未確認：09/14、09/16" in status_message

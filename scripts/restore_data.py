from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from app.database import Base, SessionLocal, engine
from app.models import (
    Branch,
    DailyMenu,
    Ingredient,
    IngredientLot,
    ItemBranchScope,
    LineBindingCode,
    LineUserBinding,
    Recipe,
    RecipeIngredient,
    RecipeSeasoning,
    Seasoning,
    SeasoningLot,
    Supplier,
    UploadConfirmation,
)


MODELS = [
    LineUserBinding,
    LineBindingCode,
    ItemBranchScope,
    UploadConfirmation,
    DailyMenu,
    RecipeSeasoning,
    RecipeIngredient,
    Recipe,
    SeasoningLot,
    Seasoning,
    IngredientLot,
    Ingredient,
    Supplier,
    Branch,
]
INSERT_MODELS = list(reversed(MODELS))
MODEL_BY_TABLE = {model.__tablename__: model for model in INSERT_MODELS}


def decode(model, key: str, value):
    if value is None:
        return None
    column = model.__table__.columns[key]
    py_type = getattr(column.type, "python_type", None)
    if py_type is date:
        return date.fromisoformat(value)
    if py_type is datetime:
        return datetime.fromisoformat(value)
    return value


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: python scripts/restore_data.py backup_data.json")
    path = Path(sys.argv[1])
    data = json.loads(path.read_text(encoding="utf-8"))
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        for model in MODELS:
            db.query(model).delete()
        db.flush()
        for table_name, rows in data.items():
            model = MODEL_BY_TABLE.get(table_name)
            if not model:
                continue
            for row in rows:
                db.add(model(**{key: decode(model, key, value) for key, value in row.items()}))
        db.commit()
    finally:
        db.close()
    print(f"restored {path}")


if __name__ == "__main__":
    main()

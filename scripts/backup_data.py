from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path
import sys

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE))

from app.database import SessionLocal
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
    Branch,
    Supplier,
    Ingredient,
    IngredientLot,
    Seasoning,
    SeasoningLot,
    Recipe,
    RecipeIngredient,
    RecipeSeasoning,
    DailyMenu,
    UploadConfirmation,
    ItemBranchScope,
    LineBindingCode,
    LineUserBinding,
]


def encode(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def row_dict(item) -> dict:
    return {column.name: encode(getattr(item, column.name)) for column in item.__table__.columns}


def main() -> None:
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "backup_data.json"
    db = SessionLocal()
    try:
        data = {
            model.__tablename__: [
                row_dict(item)
                for item in db.query(model).order_by(model.id).all()
            ]
            for model in MODELS
        }
    finally:
        db.close()
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()

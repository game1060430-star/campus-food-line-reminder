from sqlalchemy import Column, Integer, String, Boolean, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from .database import Base

class Branch(Base):
    __tablename__ = "branches"
    id = Column(Integer, primary_key=True)
    name = Column(String(120), nullable=False)
    school_name = Column(String(200), nullable=False)
    service_location = Column(String(200), nullable=False)
    restaurant_name = Column(String(200), nullable=False)
    active = Column(Boolean, default=True)

class Supplier(Base):
    __tablename__ = "suppliers"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    name = Column(String(200), nullable=False)
    owner = Column(String(120), nullable=True)
    tax_id = Column(String(20), nullable=True)
    address = Column(String(300), nullable=True)
    phone = Column(String(80), nullable=True)
    delivery_weekdays = Column(String(20), nullable=True)
    active = Column(Boolean, default=True)

class Ingredient(Base):
    __tablename__ = "ingredients"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    product_name = Column(String(200), nullable=True)
    ingredient_name = Column(String(200), nullable=False)
    origin = Column(String(120), nullable=True)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=True)
    manufacturer = Column(String(200), nullable=True)
    processed_food = Column(String(1), nullable=True)
    non_gmo_soy = Column(String(1), nullable=True)
    non_gmo_corn = Column(String(1), nullable=True)
    certification = Column(String(200), nullable=True)
    certification_no = Column(String(120), nullable=True)
    unit = Column(String(50), nullable=True)
    calories = Column(String(50), nullable=True)
    active = Column(Boolean, default=True)

class IngredientLot(Base):
    __tablename__ = "ingredient_lots"
    id = Column(Integer, primary_key=True)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    purchase_date = Column(Date, nullable=False)
    production_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    batch_no = Column(String(120), nullable=True)
    weight = Column(String(50), nullable=True)
    servings = Column(String(50), nullable=True)

class Seasoning(Base):
    __tablename__ = "seasonings"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    name = Column(String(200), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    manufacturer = Column(String(200), nullable=True)
    product_name = Column(String(200), nullable=True)
    certification = Column(String(200), nullable=True)
    certification_no = Column(String(120), nullable=True)
    unit = Column(String(50), nullable=True)
    processed = Column(String(1), nullable=True)
    non_gmo_soy = Column(String(1), nullable=True)
    non_gmo_corn = Column(String(1), nullable=True)
    active = Column(Boolean, default=True)

class SeasoningLot(Base):
    __tablename__ = "seasoning_lots"
    id = Column(Integer, primary_key=True)
    seasoning_id = Column(Integer, ForeignKey("seasonings.id"), nullable=False)
    purchase_date = Column(Date, nullable=False)
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    production_date = Column(Date, nullable=True)
    expiry_date = Column(Date, nullable=True)
    batch_no = Column(String(120), nullable=True)
    weight = Column(String(50), nullable=True)

class Recipe(Base):
    __tablename__ = "recipes"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    name = Column(String(200), nullable=False)
    category = Column(String(100), nullable=True)
    calories = Column(Integer, nullable=False, default=0)
    active = Column(Boolean, default=True)

class RecipeIngredient(Base):
    __tablename__ = "recipe_ingredients"
    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    ingredient_id = Column(Integer, ForeignKey("ingredients.id"), nullable=False)
    qty_per_serving = Column(String(50), nullable=True)
    __table_args__ = (UniqueConstraint('recipe_id','ingredient_id'),)

class RecipeSeasoning(Base):
    __tablename__ = "recipe_seasonings"
    id = Column(Integer, primary_key=True)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    seasoning_id = Column(Integer, ForeignKey("seasonings.id"), nullable=False)
    qty_per_serving = Column(String(50), nullable=True)
    __table_args__ = (UniqueConstraint('recipe_id','seasoning_id'),)

class DailyMenu(Base):
    __tablename__ = "daily_menus"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    service_date = Column(Date, nullable=False)
    recipe_id = Column(Integer, ForeignKey("recipes.id"), nullable=False)
    servings = Column(Integer, nullable=True)
    version = Column(Integer, default=1)
    upload_state = Column(String(30), default="pending")
    __table_args__ = (UniqueConstraint('branch_id','service_date','recipe_id'),)

class UploadConfirmation(Base):
    __tablename__ = "upload_confirmations"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    service_date = Column(Date, nullable=False)
    confirmed_by = Column(String(120), nullable=True)
    note = Column(String(300), nullable=True)
    confirmed_at = Column(DateTime, server_default=func.now())
    __table_args__ = (UniqueConstraint('branch_id','service_date'),)

class ClosedDate(Base):
    __tablename__ = "closed_dates"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    service_date = Column(Date, nullable=False)
    reason = Column(String(120), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    __table_args__ = (UniqueConstraint('branch_id','service_date'),)

class ItemBranchScope(Base):
    __tablename__ = "item_branch_scopes"
    id = Column(Integer, primary_key=True)
    item_type = Column(String(40), nullable=False)
    item_id = Column(Integer, nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    __table_args__ = (UniqueConstraint('item_type','item_id','branch_id'),)

class LineBindingCode(Base):
    __tablename__ = "line_binding_codes"
    id = Column(Integer, primary_key=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    code = Column(String(20), unique=True, nullable=False)
    role = Column(String(30), default="operator")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())

class LineUserBinding(Base):
    __tablename__ = "line_user_bindings"
    id = Column(Integer, primary_key=True)
    line_user_id = Column(String(120), nullable=False)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    role = Column(String(30), default="operator")
    active = Column(Boolean, default=True)
    created_at = Column(DateTime, server_default=func.now())
    __table_args__ = (UniqueConstraint('line_user_id','branch_id'),)

class HygieneOwnerBinding(Base):
    __tablename__ = "hygiene_owner_bindings"
    id = Column(Integer, primary_key=True)
    line_user_id = Column(String(120), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

class HygienePairCode(Base):
    __tablename__ = "hygiene_pair_codes"
    id = Column(Integer, primary_key=True)
    code_hash = Column(String(64), unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)

class HygieneDeviceSession(Base):
    __tablename__ = "hygiene_device_sessions"
    id = Column(Integer, primary_key=True)
    token_hash = Column(String(64), unique=True, nullable=False)
    line_user_id = Column(String(120), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    revoked_at = Column(DateTime, nullable=True)

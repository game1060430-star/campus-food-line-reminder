# 建議架構

```text
LINE OA / LIFF / Mobile Web
          |
        FastAPI
  ---------------------
  Domain Services
  - Branch
  - Catalog
  - Recipe
  - Schedule
  - Validation
  - Export
  - Upload Queue
  ---------------------
      SQLAlchemy DB
          |
   Background Worker
   - rolling schedule
   - export
   - Playwright upload
   - notification
          |
 Official Campus Platform
```

## 模組邊界
不要把 Excel、LINE、Playwright 邏輯塞進 route handler。建議：
- `app/domain/`
- `app/services/import_service.py`
- `app/services/export_service.py`
- `app/services/menu_service.py`
- `app/services/validation_service.py`
- `app/integrations/line/`
- `app/integrations/official_platform/`
- `app/workers/`

## DB migration
加入 Alembic。現有 `Base.metadata.create_all` 僅保留 development convenience 或移除。

## 測試
pytest；外部 LINE/官方網站用 fake adapter。Playwright e2e 用 mock local site 先覆蓋 CAPTCHA / success / failure 狀態，再對真站做手動 acceptance。

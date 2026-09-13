# 校園食材登錄自動化系統 — Codex Handoff Project

這個專案用來讓 Codex 直接接手開發「多分店 + LINE OA/LIFF + 校園食材登錄 Excel + 官方平台自動上傳」系統。

**先讀：`CODEX_TASK.md`。** 這是開發執行順序與完成定義。

## 目標
使用者主要只用手機與 LINE 官方帳號操作。正常情況下系統自動完成營業日菜單排程、資料檢查、官方 Excel 產生與上傳；只有遇到資料缺漏、登入失效或驗證碼時才通知使用者。

## 專案內容
- `app/`：現有 FastAPI MVP v0.1，可直接延伸，不必重寫起點。
- `data/templates/`：4 份官方 Excel 樣板，**輸出必須以樣板為基底，不可自行重建欄位格式**。
- `data/current/`：目前真正在使用的菜單、每日食材、調味料、供應商資料，可用來建立匯入器與測試。
- `specs/PRD.md`：產品與操作需求。
- `specs/DATA_MODEL.md`：建議資料模型與歷史快照規則。
- `specs/EXCEL_RULES.md`：Excel 欄位、必填/選填策略、輸出要求。
- `specs/LINE_UX.md`：LINE OA + LIFF 手機操作流程。
- `specs/AUTOMATION.md`：官方平台自動化、驗證碼人工接管、任務佇列。
- `specs/ACCEPTANCE_TESTS.md`：驗收情境。

## 啟動現有 MVP
```bash
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
python run.py
```

預設：http://localhost:8000

## LINE 官方帳號綁定
1. 複製 `.env.example` 為 `.env`，填入 `APP_BASE_URL`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`。本機開發時 `APP_BASE_URL` 需是 LINE 可連到的 HTTPS 網址，例如 ngrok URL。
2. 在 LINE Developers 後台把 Messaging API Webhook URL 設為：
   `https://你的網域/api/line/webhook`
3. 啟動服務後，到「分店」頁為指定分店產生 LINE 綁定碼。
4. 使用者在 LINE 官方帳號傳送：
   `綁定 ABC123`
5. 綁定後可在 LINE 傳送：
   `今日狀態`、`上傳狀態`、`驗證碼`、`菜單`。

Webhook 會驗證 `X-Line-Signature`。若未設定 `LINE_CHANNEL_SECRET`，開發環境會接受請求；正式環境務必填入 Channel Secret。

## 測試
```bash
pytest
```

## 安全原則
- 不可把官方平台密碼明碼寫入 DB、Git、log 或 LINE 訊息。
- 驗證碼由真人判讀；系統只負責把圖片送到手機並把真人答案帶回登入流程。
- 不嘗試破解/繞過 CAPTCHA、OTP 或其他安全機制。
- 自動上傳前後都必須保存稽核紀錄，不能只「假設」上傳成功。

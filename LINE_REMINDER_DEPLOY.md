# LINE 上傳提醒小服務

這個服務和食材整理網頁分開。食材整理、Excel 下載、手機本機資料庫照舊；LINE 只負責：

- 綁定 LINE 使用者和分店
- 記錄「已上傳」日期
- 設定休假 / 不提醒日期
- 用月曆看哪些日期已上傳、未上傳、不提醒
- 定時推播提醒尚未確認上傳的日期

## 啟動 LINE 小服務

本機測試：

```powershell
$env:APP_MODULE="app.line_reminder:app"
python run.py
```

正式雲端部署時也使用同一個入口：

```text
APP_MODULE=app.line_reminder:app
```

必要環境變數：

```text
APP_BASE_URL=https://你的-line-提醒服務網址
DATABASE_URL=雲端資料庫網址
WEB_ACCESS_TOKEN=一組長密碼
LINE_CHANNEL_SECRET=LINE Developers 的 Channel secret
LINE_CHANNEL_ACCESS_TOKEN=LINE Developers 的 long-lived channel access token
```

LINE webhook URL：

```text
https://你的-line-提醒服務網址/api/line/webhook
```

## 管理入口

管理員入口：

```text
https://你的-line-提醒服務網址/login?token=WEB_ACCESS_TOKEN&next=/admin/branches
```

管理頁可以新增店家、產生綁定碼。LINE 使用者傳：

```text
綁定 綁定碼
```

同一個 LINE 可以綁定多間店，查詢頁只會看到已綁定的店。

## LINE 指令

```text
已上傳 店名 2026-09-14 2026-09-18
休假 店名 2026-09-18 2026-09-20
登錄狀況 2026-09-14 2026-09-30
查詢已登錄狀況
設定休假不提醒
說明
```

## 定時提醒

每天固定時間呼叫：

```text
POST https://你的-line-提醒服務網址/tasks/upload-reminders
```

服務會檢查明天是否需要上傳；六日或已設定不提醒的日期會略過。

# 雲端部署筆記

這套系統搬到雲端後，你的電腦可以關機，網頁、LINE webhook、下載 Excel、登錄狀況查詢和提醒都可以由雲端處理。

## 建議部署方式

目前已整理成 Docker 專案，適合放到 Render、Railway、Fly.io 或其他支援 Docker + PostgreSQL 的雲端。

最簡單建議先用 Render：

1. 建立 PostgreSQL 資料庫。
2. 建立 Web Service，使用本專案的 `Dockerfile`。
3. 設定環境變數。
4. 部署完成後，把雲端網址填到 LINE Developers 的 Webhook URL。
5. 重新執行 `scripts/setup_line_rich_menu.py`，讓圖文選單改成雲端網址。

## 必填環境變數

- `APP_ENV=production`
- `APP_BASE_URL=https://你的雲端網址`
- `DATABASE_URL=postgresql://...`
- `WEB_ACCESS_TOKEN=一組長隨機字串`
- `LINE_CHANNEL_SECRET=LINE Developers 裡的 Channel secret`
- `LINE_CHANNEL_ACCESS_TOKEN=LINE Developers 裡的 Channel access token`

## LINE Webhook

部署完成後，到 LINE Developers 後台設定：

```text
https://你的雲端網址/api/line/webhook
```

## 每日提醒

雲端可以用排程服務每天呼叫：

```text
POST https://你的雲端網址/tasks/upload-reminders?token=WEB_ACCESS_TOKEN
```

建議時間：每天晚上 8 點左右。

## 本機資料搬到雲端

現在本機資料在 `campus_food.db`。雲端建議使用 PostgreSQL。

搬資料有兩種方式：

1. 先部署空資料庫，再用系統的「匯入舊檔」功能重建供應商、食材、調味料、菜色。
2. 用備份/還原腳本，把本機資料完整搬過去。

如果要保留目前所有分店、LINE 綁定、上傳確認紀錄，建議用第 2 種。

本機匯出：

```bash
python scripts/backup_data.py backup_data.json
```

雲端還原：

```bash
python scripts/restore_data.py backup_data.json
```

## 外店獨立使用

目前雲端化只代表你的系統搬到雲端。若要給隔壁店家使用且完全看不到你的資料，需要再做「店家帳戶隔離」。

未做隔離前，不建議把管理入口給外店當獨立系統使用。

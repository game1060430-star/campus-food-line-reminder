# 建議資料模型

## Branch
分店/營業據點。官方帳密屬敏感資料，只保存加密版本與最後驗證狀態。

## Supplier
可 branch-specific 或 shared。建議另建 branch_supplier 關聯，以後可同一供應商供應多店，避免複製主檔。

## Ingredient + IngredientLot
Ingredient 保存固定/預設資訊；IngredientLot 保存每次進貨資訊。
不得把批號、有效期限直接塞在 Ingredient 主檔後覆蓋。

## Seasoning + SeasoningLot
同上；Lot 額外保存 start_date/end_date。日期範圍用於選出供餐當日有效批次，但有重疊時必須提示使用者，不能隨意猜。

## Recipe
菜色主檔。
RecipeIngredient / RecipeSeasoning 為多對多關聯，可存 qty_per_serving（選填）。

## DailyMenu
branch + service_date + recipe；servings 選填。
每次異動增加 revision/version 或使用 MenuRevision，並把舊版本保留。

## Snapshot
官方 Excel/上傳使用的資料不能在主檔變更後被倒改。
建議在「準備上傳」時建立 MenuSnapshot / IngredientUsageSnapshot / SeasoningUsageSnapshot，保存當時輸出欄位的值。

## UploadTask / UploadAttempt
UploadTask 代表邏輯任務；UploadAttempt 每次執行一筆，保存：
- start/end time
- status
- exported_file_hash/path
- official response summary
- screenshot/error artifact path（禁止包含密碼）
- retry number

Task 要有 deterministic idempotency key，例如 branch_id + task_type + service_date + data_revision。

## CaptchaChallenge
- upload_attempt_id
- random token
- image path/object key
- created_at / expires_at
- status waiting/answered/expired/invalid
- answer 建議只短暫保存，使用後清除
- CAPTCHA 刷新後舊 token 必須失效

## BusinessSchedule / ScheduleTemplate
BusinessSchedule 表示分店星期幾營業。
ScheduleTemplate 可保存固定菜單模板，rolling job 每天把未來 N 天補齊。

## AuditLog
重要操作均寫：actor、source(web/LINE/system)、branch、entity、action、before/after 摘要、timestamp。
敏感欄位必須 redact。

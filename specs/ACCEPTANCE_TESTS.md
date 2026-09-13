# 驗收測試

## A. 多分店
- 建 A/B 兩店，各有不同學校/餐廳/帳號。
- A店資料不可出現在 B店 export 或 upload task。

## B. 極簡欄位
- 食材只填 9 個官方必要欄位即可通過 validation/export。
- 生產日、有效日、批號、重量等空白不得報錯。
- 調味料只填 8 個必要欄位即可通過。

## C. Excel
- 4 種輸出工作表名稱與欄位順序符合 template。
- 參考工作表仍存在。
- 用 current data 匯入後可再輸出，不遺失必要值。
- 歷史 `基改黃豆`/`基改玉米` 欄名可匯入，輸出仍使用官方欄位。

## D. 菜單
- 一個菜色套用 9/14~9/30、只週一~週五。
- 非營業日不建立。
- 修改 9/17，只 9/17 產生新 revision/pending task。
- 主檔後續改供應商，不改掉已 frozen 的 9/17 snapshot。

## E. CAPTCHA
- upload attempt 遇 CAPTCHA -> waiting_captcha。
- LIFF token 不可猜、會過期。
- 提交真人答案後 -> pending/running。
- CAPTCHA 被刷新後舊 token 不能再使用。

## F. 上傳稽核
- 無官方成功證據 -> 不得 success。
- 成功保存 upload attempt/audit。
- 同一 revision 重跑時不得造成不必要重複上傳。

## G. LINE 權限
- 未綁定 LINE user 不能改菜單/帳號。
- 店長只能操作授權分店。
- 自然語言 command 必須經確認才生效。

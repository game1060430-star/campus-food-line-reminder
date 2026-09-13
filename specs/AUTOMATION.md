# 官方網站自動化與排程

## Playwright 原則
正式接官方網站時，先透過實際瀏覽器觀察頁面與 network/DOM，再寫 Page Object。不要依猜測 selector。

## 登入流程
1. 取分店加密帳密並在記憶體解密。
2. 優先嘗試已保存且仍有效的 storage state/session。
3. 需要重登時填帳密。
4. 如果出現 CAPTCHA：
   - 截取 CAPTCHA 元素本身（必要時可加少量周邊文字）
   - 建 CaptchaChallenge + expires_at
   - UploadAttempt -> waiting_captcha
   - LINE 推送 LIFF link
   - worker 暫停/釋放資源，以可恢復狀態等待
5. 真人提交答案後，重新建立/恢復瀏覽器狀態，確認 challenge 仍有效；填答案並登入。
6. 若官方刷新 CAPTCHA，將舊 challenge 標 invalid 並產生新 challenge。

## 不做
- OCR CAPTCHA
- 第三方 CAPTCHA solving service
- 繞過 OTP/驗證碼

## 上傳流程
每種 Excel 用獨立 Page Object/action。
同一批次、同一分店的上傳必須共用一次登入後保存的 storage state，不可每筆菜色或每個 Excel 都重新登入。建議順序是：
1. 確認該分店 storage state 是否可用。
2. 不可用時才登入並處理 CAPTCHA。
3. 登入成功後保存 storage state。
4. 在同一個瀏覽器 context/session 內連續上傳供應商、食材、調味料、菜單。
5. 只有官方回應 session 失效或登入頁時，才標記 session expired 並重新進入登入/CAPTCHA 流程。

上傳前：
- 重新 validation
- 確認 task revision 仍為最新，舊 task 標 superseded
- 計算檔案 hash
上傳後：
- 等官方明確結果
- success 必須有成功 DOM/message/response 的 evidence
- 保存結果摘要與必要截圖
- 對可安全重試的 transient error 做有限重試

## 排程
- 每日 rolling job 補未來 N 天預排菜單，只補營業日。
- upload watchdog 檢查「應登錄但尚未成功」資料。
- 若資料沒有變更且同 revision 已 success，不再重傳。
- 菜單修改後產生新 revision，只重跑該日期相關 task。

## Session
每分店各自 storage state，不共享 cookie。
敏感 storage state 檔不能進 Git，且權限最小化。

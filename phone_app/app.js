window.addEventListener("error", event => {
  const app = document.getElementById("app");
  if (app) app.innerHTML = `<div class="notice">啟動失敗：${escapeHtml(event.message || "未知錯誤")}</div>`;
});

const DB_NAME = "campus-food-local";
const DB_VERSION = 1;
const STORES = ["branches", "suppliers", "ingredients", "seasonings", "recipes", "recipeIngredients", "recipeSeasonings", "uploadConfirmations"];
const LABELS = {
  branches: "分店",
  suppliers: "供應商",
  ingredients: "食材",
  seasonings: "調味料",
  recipes: "菜色",
  recipeIngredients: "菜色食材",
  recipeSeasonings: "菜色調味料",
  uploadConfirmations: "上傳確認"
};
const VISIBLE_BACKUP_STORES = ["branches", "suppliers", "ingredients", "seasonings", "recipes", "uploadConfirmations"];
const OFFICIAL_TEMPLATES = {
  menus: { file: "PreMenuExcelExample.xlsx", name: "菜單", cols: 8, required: [1, 2, 3, 4, 6, 7, 8] },
  ingredients: { file: "PrerestaurantingredientExcelExample.xlsx", name: "食材", cols: 22, required: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  seasonings: { file: "seasoningstockdataCollegeExcelExample.xlsx", name: "調味料", cols: 20, required: [1, 2, 3, 4, 5, 8, 9, 10] },
  suppliers: { file: "supplierExcelExample.xlsx", name: "供應商", cols: 5, required: [1, 2, 3, 4, 5] }
};
const WEEKDAYS = [
  [0, "週一"],
  [1, "週二"],
  [2, "週三"],
  [3, "週四"],
  [4, "週五"],
  [5, "週六"],
  [6, "週日"]
];

let db;
let state = { view: "home", branchId: "", masterBatchMode: "", recipeBatchMode: "" };
let backupDownloadUrl = "";
const generatedDownloads = new Map();

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("這個瀏覽器不支援本機資料庫 IndexedDB，請用 Safari 或 Chrome 開啟。"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of STORES) {
        if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function tx(store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}

function all(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function put(store, value) {
  return new Promise((resolve, reject) => {
    const nextValue = { ...value, updatedAt: new Date().toISOString() };
    if (nextValue.id === undefined || nextValue.id === null || nextValue.id === "") delete nextValue.id;
    const request = tx(store, "readwrite").put(nextValue);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function del(store, id) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").delete(Number(id));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteWhere(store, predicate) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    const request = objectStore.getAll();
    request.onsuccess = () => {
      for (const item of request.result || []) {
        if (predicate(item)) objectStore.delete(item.id);
      }
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function clearStore(store) {
  return new Promise((resolve, reject) => {
    const request = tx(store, "readwrite").clear();
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function html(strings, ...values) {
  return strings.map((part, index) => `${part}${values[index] ?? ""}`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));
}

function activeBranchName(branches) {
  const branch = branches.find(item => String(item.id) === String(state.branchId));
  return branch ? branch.name : "分店管理／資源共享";
}

function availableForScope(items) {
  if (!state.branchId) return items.filter(item => !scopeIds(item).length);
  return items.filter(item => availableForBranchId(item, state.branchId));
}

function availableForBranch(items, branchId) {
  return items.filter(item => availableForBranchId(item, branchId));
}

function availableForBranchId(item, branchId) {
  const ids = scopeIds(item);
  if (ids.length) return ids.map(String).includes(String(branchId));
  return !item.branchId || String(item.branchId) === String(branchId);
}

function scopeIds(item) {
  if (Array.isArray(item.branchIds) && item.branchIds.length) return item.branchIds.map(Number).filter(Boolean);
  if (item.branchId) return [Number(item.branchId)];
  return [];
}

async function dataBundle() {
  const entries = await Promise.all(STORES.map(async store => [store, await all(store)]));
  return Object.fromEntries(entries);
}

async function render() {
  const data = await dataBundle();
  document.querySelectorAll("nav button").forEach(btn => btn.classList.toggle("active", btn.dataset.view === state.view));
  document.getElementById("scopeLabel").textContent = activeBranchName(data.branches);
  const app = document.getElementById("app");
  if (state.view === "home") app.innerHTML = renderHome(data);
  if (state.view === "masters") app.innerHTML = renderMasters(data);
  if (state.view === "recipes") app.innerHTML = renderRecipes(data);
  if (state.view === "exports") app.innerHTML = renderExports(data);
  if (state.view === "backup") app.innerHTML = renderBackup(data);
}

function branchSelect(branches) {
  return html`
    <label>目前工作區
      <select id="branchScope">
        <option value="" ${!state.branchId ? "selected" : ""}>分店管理／資源共享</option>
        ${branches.map(b => `<option value="${b.id}" ${String(state.branchId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
      </select>
    </label>`;
}

function renderHome(data) {
  return html`
    <h1>選擇工作區</h1>
    <div class="notice"><b>資料存在這支手機。</b><br>先選分店再操作。要新增共用資料或共享給分店，選「分店管理／資源共享」。</div>
    <section class="card">
      ${branchSelect(data.branches)}
      <div class="actions">
        <button data-view-go="masters">供應商／食材</button>
        <button data-view-go="recipes" class="secondary">菜色</button>
        <button data-view-go="exports" class="secondary">下載官方 Excel</button>
        <button data-view-go="backup" class="secondary">備份／還原</button>
      </div>
    </section>
    <h2>快速新增分店</h2>
    <form class="card" data-action="addBranch">
      <label>分店名稱<input name="name" required placeholder="例如：娃子複合式餐飲"></label>
      <label>學校名稱<input name="schoolName" required></label>
      <label>供餐地點<input name="serviceLocation" required placeholder="例如：午餐"></label>
      <label>餐廳名稱<input name="restaurantName" required></label>
      <button>新增分店</button>
    </form>
    <h2>現有分店</h2>
    <div class="card">
      ${data.branches.length ? data.branches.map(b => `<div class="row"><span><b>${escapeHtml(b.name)}</b><br><small>${escapeHtml(b.schoolName)}／${escapeHtml(b.restaurantName)}</small></span><button class="secondary" data-set-branch="${b.id}">進入</button></div>`).join("") : `<div class="empty">尚未建立分店</div>`}
    </div>`;
}

function renderMasters(data) {
  const suppliers = availableForScope(data.suppliers);
  const ingredients = availableForScope(data.ingredients);
  const seasonings = availableForScope(data.seasonings);
  return html`
    <h1>資料管理</h1>
    <div class="card">${branchSelect(data.branches)}</div>
    ${renderRepairPanel(data, state.branchId || data.branches[0]?.id || "", collectRepairIssues(data, state.branchId || data.branches[0]?.id || ""))}
    <h2>初期大量建檔</h2>
    <form class="card" data-action="bulkNames">
      <label>供應商／調味料
        <textarea name="supplySeasoning" placeholder="供應商：喬富&#10;供應商：青葉&#10;調味料：鹽巴,喬富&#10;調味料：醬油,青葉"></textarea>
      </label>
      <label>食材／菜色
        <textarea name="ingredientRecipe" placeholder="食材：油麵,喬富,臺灣&#10;食材：蘑菇醬,喬富,臺灣&#10;菜色：蘑菇麵,500&#10;菜色：咖哩飯"></textarea>
      </label>
      <button>批量建立名稱</button>
      <p class="muted">先大量建立名稱就好。供應商負責人、統編、電話、地址可以之後再補；食材原產地空白會先用「臺灣」。</p>
    </form>
    ${bulkMasterModeButtons()}
    ${bulkMastersEditor(suppliers, ingredients, seasonings, data.branches, data.recipes, data.recipeIngredients, state.masterBatchMode)}
    <h2>供應商</h2>
    <form class="card" data-action="addSupplier">
      <label>供應商名稱<input name="name" required></label>
      <label>負責人<input name="owner" required></label>
      <label>統編<input name="taxId" required></label>
      <label>電話<input name="phone" required></label>
      <label>地址<input name="address" required></label>
      ${deliveryControls({})}
      <button>新增供應商</button>
    </form>
    <div class="card">${suppliers.length ? suppliers.map(item => supplierRow(item, data)).join("") : `<div class="empty">尚未建立資料</div>`}</div>
    <h2>食材</h2>
    <form class="card" data-action="addIngredient">
      <label>食材名稱<input name="ingredientName" required></label>
      <label>產品名稱<input name="productName" placeholder="不填就同食材名稱"></label>
      <label>原產地<input name="origin" placeholder="不填會自動填臺灣"></label>
      <label>供應商<select name="supplierId"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <button>新增食材</button>
    </form>
    <div class="card">${ingredients.length ? ingredients.map(item => ingredientRow(item, data, suppliers)).join("") : `<div class="empty">尚未建立資料</div>`}</div>
    <h2>調味料</h2>
    <form class="card" data-action="addSeasoning">
      <label>調味料名稱<input name="name" required></label>
      <label>供應商<select name="supplierId" required>${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <button>新增調味料</button>
    </form>
    <div class="card">${seasonings.length ? seasonings.map(item => seasoningRow(item, data, suppliers)).join("") : `<div class="empty">尚未建立資料</div>`}</div>`;
}

function renderRecipes(data) {
  const recipes = availableForScope(data.recipes);
  const ingredients = availableForScope(data.ingredients);
  const seasonings = availableForScope(data.seasonings);
  return html`
    <h1>菜色</h1>
    <div class="card">${branchSelect(data.branches)}</div>
    <form class="card" data-action="addRecipe">
      <label>菜色名稱<input name="name" required></label>
      <label>熱量<input name="calories" type="number" min="0" value="0"></label>
      <h2>食材組成</h2>
      ${ingredients.map(i => `<label class="check"><input type="checkbox" name="ingredientIds" value="${i.id}"><span>${escapeHtml(i.ingredientName)}</span></label>`).join("") || `<p class="muted">尚未建立食材</p>`}
      <h2>調味料組成</h2>
      ${seasonings.map(s => `<label class="check"><input type="checkbox" name="seasoningIds" value="${s.id}"><span>${escapeHtml(s.name)}</span></label>`).join("") || `<p class="muted">尚未建立調味料</p>`}
      <button>新增菜色</button>
    </form>
    ${bulkRecipeModeButtons()}
    ${bulkRecipesEditor(recipes, data.branches, state.recipeBatchMode)}
    ${state.recipeBatchMode === "composition" ? bulkRecipeCompositionEditor(recipes, ingredients, seasonings, data) : ""}
    <div class="card">${recipes.length ? recipes.map(recipe => recipeRow(recipe, data)).join("") : `<div class="empty">尚未建立菜色</div>`}</div>`;
}

function renderExports(data) {
  const activeBranch = data.branches.find(branch => String(branch.id) === String(state.branchId));
  const branchId = activeBranch?.id || data.branches[0]?.id || "";
  const recipes = branchId ? availableForBranch(data.recipes, branchId) : [];
  const ingredients = branchId ? availableForBranch(data.ingredients, branchId) : [];
  const [startDate, endDate] = defaultExportDates();
  const repairIssues = collectRepairIssues(data, branchId);
  return html`
    <h1>下載官方 Excel</h1>
    <div class="notice"><b>這裡只產生 Excel，不連官方網站。</b><br>下載後你再用手機或電腦手動上傳。檔案會各自下載，不會包成 ZIP。</div>
    ${renderRepairPanel(data, branchId, repairIssues)}
    <form class="card" data-action="downloadOfficial">
      <label>分店
        <select name="branchId" required>
          ${data.branches.map(b => `<option value="${b.id}" ${String(branchId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
        </select>
      </label>
      <label>開始日期<input name="startDate" type="date" required value="${startDate}"></label>
      <label>結束日期<input name="endDate" type="date" required value="${endDate}"></label>
      <h2>要產生哪些檔案</h2>
      <label class="check"><input type="checkbox" name="fileTypes" value="menus" checked><span>菜單 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="ingredients" checked><span>食材 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="seasonings"><span>調味料 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="suppliers"><span>供應商 Excel</span></label>
      <h2>菜色</h2>
      ${recipes.map(recipe => `<label class="check"><input type="checkbox" name="recipeIds" value="${recipe.id}" checked><span>${escapeHtml(recipe.name)}</span></label>`).join("") || `<p class="muted">這個分店還沒有菜色</p>`}
      <h2>食材 Excel 來源</h2>
      <label class="check"><input type="radio" name="ingredientSource" value="recipes" checked><span>依菜色組成自動帶入</span></label>
      <label class="check"><input type="radio" name="ingredientSource" value="manual"><span>手動勾選進貨食材</span></label>
      <details class="manual-ingredients">
        <summary>選擇這次有進貨的食材</summary>
        <p class="muted">選「手動勾選進貨食材」時，食材 Excel 會用這裡勾選的食材，不需要菜色已經設定食材組成。</p>
        <div class="split-actions">
          <button type="button" class="secondary" data-check-all="manualIngredientIds">全選食材</button>
          <button type="button" class="secondary" data-uncheck-all="manualIngredientIds">清除勾選</button>
        </div>
        <div class="choice-grid">
          ${ingredients.map(item => `<label class="check chip"><input type="checkbox" name="manualIngredientIds" value="${item.id}"><span>${escapeHtml(item.ingredientName)}／${supplierName(data.suppliers, item.supplierId)}</span></label>`).join("") || `<p class="muted">這個分店還沒有食材</p>`}
        </div>
      </details>
      <button>產生並下載</button>
      <div id="downloadResult"></div>
    </form>
    <form class="card" data-action="lineCommand">
      <h2>LINE 提醒文字</h2>
      <label>分店
        <select name="branchId" required>
          ${data.branches.map(b => `<option value="${b.id}" ${String(branchId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
        </select>
      </label>
      <label>用途
        <select name="commandType">
          <option value="closed">設定休息日，不提醒</option>
          <option value="status">查詢登錄狀況</option>
          <option value="uploaded">補記已上傳</option>
        </select>
      </label>
      <label>開始日期<input name="startDate" type="date" required value="${startDate}"></label>
      <label>結束日期<input name="endDate" type="date" required value="${endDate}"></label>
      <button>產生 LINE 文字</button>
      <div id="lineCommandResult"></div>
    </form>`;
}

function renderRepairPanel(data, branchId, issues) {
  const total = issues.branches.length + issues.suppliers.length + issues.ingredients.length + issues.seasonings.length;
  if (!total) return `<div class="notice ok"><b>待補資料：</b>目前沒有看到會擋下載的明顯缺漏。</div>`;
  return html`
    <details class="card repair-panel" open>
      <summary>待補資料 ${total} 筆</summary>
      <p class="muted">這裡列出轉檔或匯入後缺少的必填資料。補完後按一次儲存，再重新下載 Excel。</p>
      ${issues.branches.length ? `<div class="notice"><b>分店資料要先補：</b><ul class="warning-list">${issues.branches.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><small>請到「分店管理」修改分店資料。</small></div>` : ""}
      <form data-action="repairMissingData">
        ${renderRepairFields(data, branchId, issues)}
        <button>儲存待補資料</button>
      </form>
    </details>`;
}

function renderRepairFields(data, branchId, issues) {
  const suppliers = branchId ? availableForBranch(data.suppliers, branchId) : availableForScope(data.suppliers);
  const supplierOptions = suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name || "未命名供應商")}</option>`).join("");
  return html`
    ${issues.suppliers.length ? html`
      <h2>供應商待補</h2>
      ${issues.suppliers.map(item => html`
        <div class="bulk-item">
          <input type="hidden" name="repairSupplierIds" value="${item.supplier.id}">
          <b>${escapeHtml(item.supplier.name || "未命名供應商")}</b>
          <small class="danger-text">缺：${item.missing.map(escapeHtml).join("、")}</small>
          <label>供應商名稱<input name="repairSupplierNames" value="${escapeHtml(item.supplier.name || "")}"></label>
          <label>負責人<input name="repairSupplierOwners" value="${escapeHtml(item.supplier.owner || "")}"></label>
          <label>統編<input name="repairSupplierTaxIds" value="${escapeHtml(item.supplier.taxId || "")}"></label>
          <label>電話<input name="repairSupplierPhones" value="${escapeHtml(item.supplier.phone || "")}"></label>
          <label>地址<input name="repairSupplierAddresses" value="${escapeHtml(item.supplier.address || "")}"></label>
        </div>`).join("")}` : ""}
    ${issues.ingredients.length ? html`
      <h2>食材待補</h2>
      <p class="muted">缺供應商的食材可以直接在這裡選供應商；如果是轉檔多出來或不需要的食材，也可以直接刪除。</p>
      ${issues.ingredients.map(item => html`
        <div class="bulk-item">
          <input type="hidden" name="repairIngredientIds" value="${item.ingredient.id}">
          <b>${escapeHtml(item.ingredient.ingredientName || "未命名食材")}</b>
          <small class="danger-text">缺：${item.missing.map(escapeHtml).join("、")}</small>
          <label>食材名稱<input name="repairIngredientNames" value="${escapeHtml(item.ingredient.ingredientName || "")}"></label>
          <label>產品名稱<input name="repairIngredientProductNames" value="${escapeHtml(item.ingredient.productName || item.ingredient.ingredientName || "")}"></label>
          <label>原產地<input name="repairIngredientOrigins" value="${escapeHtml(item.ingredient.origin || "臺灣")}"></label>
          <label>這筆食材的供應商（必填）
            <select name="repairIngredientSupplierIds">
              <option value="">待補</option>
              ${suppliers.map(s => `<option value="${s.id}" ${Number(item.ingredient.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name || "未命名供應商")}</option>`).join("")}
            </select>
          </label>
          <button type="button" class="danger" data-delete="ingredients:${item.ingredient.id}">刪除這個食材</button>
        </div>`).join("")}` : ""}
    ${issues.seasonings.length ? html`
      <h2>調味料待補</h2>
      ${issues.seasonings.map(item => html`
        <div class="bulk-item">
          <input type="hidden" name="repairSeasoningIds" value="${item.seasoning.id}">
          <b>${escapeHtml(item.seasoning.name || "未命名調味料")}</b>
          <small class="danger-text">缺：${item.missing.map(escapeHtml).join("、")}</small>
          <label>供應商
            <select name="repairSeasoningSupplierIds">
              <option value="">待補</option>
              ${suppliers.map(s => `<option value="${s.id}" ${Number(item.seasoning.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name || "未命名供應商")}</option>`).join("")}
            </select>
          </label>
        </div>`).join("")}` : ""}
    ${!supplierOptions ? `<div class="notice"><b>目前沒有可選的供應商。</b><br>請先到「資料」新增供應商，或先刪除這些不需要的食材。</div>` : ""}`;
}

function renderBackup(data) {
  return html`
    <h1>備份／還原</h1>
    <div class="notice"><b>建議定期備份。</b><br>這個 Excel 就是手機本機資料的完整備份。存在 iCloud、Google Drive 或 LINE Keep 都可以。</div>
    <div class="card actions">
      <button data-action-click="exportBackup">匯出完整備份 Excel</button>
      <label>匯入備份 Excel<input type="file" id="importBackup" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"></label>
      <div id="backupResult"></div>
    </div>
    <h2>匯入官方舊檔建檔</h2>
    <div class="notice">從校園食材登錄網站下載的供應商、食材、菜單、調味料 Excel 可以直接匯入。請先選工作區；選分店就是建到那間店，選「分店管理／資源共享」就是建成共用資料。</div>
    <div class="card">
      ${branchSelect(data.branches)}
      <label>供應商 Excel<input type="file" data-official-import="suppliers" accept=".xlsx,.xls"></label>
      <label>食材 Excel<input type="file" data-official-import="ingredients" accept=".xlsx,.xls"></label>
      <label>菜單／菜色 Excel<input type="file" data-official-import="recipes" accept=".xlsx,.xls"></label>
      <label>調味料 Excel<input type="file" data-official-import="seasonings" accept=".xlsx,.xls"></label>
      <div id="officialImportResult"></div>
    </div>
    <div class="grid">
      ${VISIBLE_BACKUP_STORES.map(store => `<div class="card"><b>${LABELS[store]}</b><br><small>${data[store].length} 筆</small></div>`).join("")}
    </div>`;
}

function bulkMasterModeButtons() {
  const modes = [
    ["suppliers", "補供應商資料"],
    ["ingredientSuppliers", "設定食材供應商"],
    ["ingredientRecipes", "設定食材使用菜色"],
    ["seasoningSuppliers", "設定調味料供應商"],
    ["scopes", "設定可用分店"],
    ["delete", "批量刪除"]
  ];
  return html`
    <h2>批量修改</h2>
    <div class="card mode-grid">
      ${modes.map(([mode, label]) => `<button type="button" class="${state.masterBatchMode === mode ? "" : "secondary"}" data-master-batch-mode="${mode}">${label}</button>`).join("")}
      ${state.masterBatchMode ? `<button type="button" class="secondary" data-master-batch-mode="">收起批量修改</button>` : ""}
    </div>`;
}

function bulkMastersEditor(suppliers, ingredients, seasonings, branches, recipes, recipeIngredients, mode) {
  if (!suppliers.length && !ingredients.length && !seasonings.length) return "";
  if (!mode) return "";
  const title = {
    suppliers: "補供應商資料",
    ingredientSuppliers: "設定食材供應商",
    ingredientRecipes: "設定食材使用菜色",
    seasoningSuppliers: "設定調味料供應商",
    scopes: "設定可用分店",
    delete: "批量刪除"
  }[mode] || "批量修改資料";
  if (mode === "delete") return bulkDeleteEditor([
    ["suppliers", "供應商", suppliers, item => `${item.name || "未命名供應商"}／${supplierUsage({ ingredients }, item.id)} 樣食材`],
    ["ingredients", "食材", ingredients, item => `${item.ingredientName || "未命名食材"}／${supplierName(suppliers, item.supplierId)}`],
    ["seasonings", "調味料", seasonings, item => `${item.name || "未命名調味料"}／${supplierName(suppliers, item.supplierId)}`]
  ]);
  return html`
    <details class="card" open>
      <summary>${title}，一次儲存</summary>
      <form data-action="bulkSaveMasters">
        <p class="muted">只會顯示你剛剛選的修改項目。全部改完後按最下面的「全部儲存」。</p>
        ${mode === "suppliers" ? html`<h2>供應商資料</h2>
          ${suppliers.map(item => html`
          <div class="bulk-item">
            <input type="hidden" name="supplierIds" value="${item.id}">
            <input type="hidden" name="supplierBranchIds" value="${item.branchId || ""}">
            <label>名稱<input name="supplierNames" value="${escapeHtml(item.name)}"></label>
            <label>負責人<input name="supplierOwners" value="${escapeHtml(item.owner || "")}"></label>
            <label>統編<input name="supplierTaxIds" value="${escapeHtml(item.taxId || "")}"></label>
            <label>電話<input name="supplierPhones" value="${escapeHtml(item.phone || "")}"></label>
            <label>地址<input name="supplierAddresses" value="${escapeHtml(item.address || "")}"></label>
            ${bulkHiddenScopeInputs("supplier", item)}
          </div>`).join("") || `<p class="muted">沒有供應商</p>`}
        ` : ""}
        ${mode === "ingredientSuppliers" ? html`<h2>食材供應商</h2>
          ${ingredients.map(item => html`
          <div class="bulk-item">
            <input type="hidden" name="ingredientIds" value="${item.id}">
            <input type="hidden" name="ingredientBranchIds" value="${item.branchId || ""}">
            <input type="hidden" name="ingredientNames" value="${escapeHtml(item.ingredientName)}">
            <input type="hidden" name="ingredientProductNames" value="${escapeHtml(item.productName || item.ingredientName)}">
            <input type="hidden" name="ingredientOrigins" value="${escapeHtml(item.origin || "臺灣")}">
            ${bulkHiddenScopeInputs("ingredient", item)}
            <b>${escapeHtml(item.ingredientName || "未命名食材")}</b>
            <label>供應商<select name="ingredientSupplierIds"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}" ${Number(item.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></label>
          </div>`).join("") || `<p class="muted">沒有食材</p>`}
        ` : ""}
        ${mode === "seasoningSuppliers" ? html`<h2>調味料供應商</h2>
          ${seasonings.map(item => html`
          <div class="bulk-item">
            <input type="hidden" name="seasoningIds" value="${item.id}">
            <input type="hidden" name="seasoningBranchIds" value="${item.branchId || ""}">
            <input type="hidden" name="seasoningNames" value="${escapeHtml(item.name)}">
            ${bulkHiddenScopeInputs("seasoning", item)}
            <b>${escapeHtml(item.name || "未命名調味料")}</b>
            <label>供應商<select name="seasoningSupplierIds"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}" ${Number(item.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></label>
          </div>`).join("") || `<p class="muted">沒有調味料</p>`}
        ` : ""}
        ${mode === "ingredientRecipes" ? html`<h2>食材使用菜色</h2>
          <p class="muted">用食材反向設定哪些菜色會用到它。例如點「漢堡肉」，下面勾所有漢堡類菜色。</p>
          ${ingredients.map(item => {
            const usedRecipeIds = new Set(recipeIngredients.filter(link => Number(link.ingredientId) === Number(item.id)).map(link => Number(link.recipeId)));
            return html`
              <details class="composition-item">
                <summary>${escapeHtml(item.ingredientName || "未命名食材")} <small>${usedRecipeIds.size} 道菜使用</small></summary>
                <input type="hidden" name="ingredientRecipeIngredientIds" value="${item.id}">
                <div class="split-actions">
                  <button type="button" class="secondary" data-check-all="ingredient_${item.id}_recipeIds">全選菜色</button>
                  <button type="button" class="secondary" data-uncheck-all="ingredient_${item.id}_recipeIds">清除勾選</button>
                </div>
                <div class="choice-grid">
                  ${recipes.map(recipe => `<label class="check chip"><input type="checkbox" name="ingredient_${item.id}_recipeIds" value="${recipe.id}" ${usedRecipeIds.has(Number(recipe.id)) ? "checked" : ""}><span>${escapeHtml(recipe.name)}</span></label>`).join("") || `<p class="muted">尚未建立菜色</p>`}
                </div>
              </details>`;
          }).join("") || `<p class="muted">沒有食材</p>`}
        ` : ""}
        ${mode === "scopes" ? html`<h2>供應商可用分店</h2>
          ${suppliers.map(item => html`
            <div class="bulk-item">
              <input type="hidden" name="supplierIds" value="${item.id}">
              <input type="hidden" name="supplierBranchIds" value="${item.branchId || ""}">
              <input type="hidden" name="supplierNames" value="${escapeHtml(item.name)}">
              <input type="hidden" name="supplierOwners" value="${escapeHtml(item.owner || "")}">
              <input type="hidden" name="supplierTaxIds" value="${escapeHtml(item.taxId || "")}">
              <input type="hidden" name="supplierPhones" value="${escapeHtml(item.phone || "")}">
              <input type="hidden" name="supplierAddresses" value="${escapeHtml(item.address || "")}">
              <b>${escapeHtml(item.name || "未命名供應商")}</b>
              ${bulkScopeControls("supplier", item, branches)}
            </div>`).join("") || `<p class="muted">沒有供應商</p>`}
          <h2>食材可用分店</h2>
          ${ingredients.map(item => html`
            <div class="bulk-item">
              <input type="hidden" name="ingredientIds" value="${item.id}">
              <input type="hidden" name="ingredientBranchIds" value="${item.branchId || ""}">
              <input type="hidden" name="ingredientNames" value="${escapeHtml(item.ingredientName)}">
              <input type="hidden" name="ingredientProductNames" value="${escapeHtml(item.productName || item.ingredientName)}">
              <input type="hidden" name="ingredientOrigins" value="${escapeHtml(item.origin || "臺灣")}">
              <input type="hidden" name="ingredientSupplierIds" value="${item.supplierId || ""}">
              <b>${escapeHtml(item.ingredientName || "未命名食材")}</b>
              ${bulkScopeControls("ingredient", item, branches)}
            </div>`).join("") || `<p class="muted">沒有食材</p>`}
          <h2>調味料可用分店</h2>
          ${seasonings.map(item => html`
            <div class="bulk-item">
              <input type="hidden" name="seasoningIds" value="${item.id}">
              <input type="hidden" name="seasoningBranchIds" value="${item.branchId || ""}">
              <input type="hidden" name="seasoningNames" value="${escapeHtml(item.name)}">
              <input type="hidden" name="seasoningSupplierIds" value="${item.supplierId || ""}">
              <b>${escapeHtml(item.name || "未命名調味料")}</b>
              ${bulkScopeControls("seasoning", item, branches)}
            </div>`).join("") || `<p class="muted">沒有調味料</p>`}
        ` : ""}
        <button>全部儲存</button>
      </form>
    </details>`;
}

function bulkRecipeModeButtons() {
  const modes = [
    ["details", "修改菜色資料"],
    ["scopes", "設定菜色分店"],
    ["composition", "編輯菜色組成"],
    ["delete", "批量刪除"]
  ];
  return html`
    <h2>批量修改</h2>
    <div class="card mode-grid">
      ${modes.map(([mode, label]) => `<button type="button" class="${state.recipeBatchMode === mode ? "" : "secondary"}" data-recipe-batch-mode="${mode}">${label}</button>`).join("")}
      ${state.recipeBatchMode ? `<button type="button" class="secondary" data-recipe-batch-mode="">收起批量修改</button>` : ""}
    </div>`;
}

function bulkRecipesEditor(recipes, branches, mode) {
  if (!recipes.length) return "";
  if (mode === "delete") return bulkDeleteEditor([
    ["recipes", "菜色", recipes, item => `${item.name || "未命名菜色"}／${Number(item.calories || 0)} kcal`]
  ]);
  if (!["details", "scopes"].includes(mode)) return "";
  const title = mode === "details" ? "修改菜色資料" : "設定菜色分店";
  return html`
    <details class="card" open>
      <summary>${title}，一次儲存</summary>
      <form data-action="bulkSaveRecipes">
        <p class="muted">只會顯示你剛剛選的修改項目。全部改完後按最下面的「全部儲存」。</p>
        ${recipes.map(item => html`
          <div class="bulk-item">
            <input type="hidden" name="recipeIds" value="${item.id}">
            <input type="hidden" name="recipeBranchIds" value="${item.branchId || ""}">
            ${mode === "details" ? html`
              ${bulkHiddenScopeInputs("recipe", item)}
              <label>菜色名稱<input name="recipeNames" value="${escapeHtml(item.name)}"></label>
              <label>熱量<input name="recipeCalories" type="number" min="0" value="${Number(item.calories || 0)}"></label>
            ` : html`
              <input type="hidden" name="recipeNames" value="${escapeHtml(item.name)}">
              <input type="hidden" name="recipeCalories" value="${Number(item.calories || 0)}">
              <b>${escapeHtml(item.name || "未命名菜色")}</b>
              ${bulkScopeControls("recipe", item, branches)}
            `}
          </div>`).join("")}
        <button>全部儲存</button>
      </form>
    </details>`;
}

function bulkDeleteEditor(groups) {
  const hasItems = groups.some(([, , items]) => items.length);
  if (!hasItems) return `<div class="card empty">沒有可刪除的資料</div>`;
  return html`
    <details class="card" open>
      <summary>批量刪除</summary>
      <form data-action="bulkDeleteRecords">
        <div class="notice"><b>請小心使用。</b><br>刪除後會同步清理相關連結，例如刪食材會從菜色組成移除。</div>
        ${groups.map(([store, label, items, describe]) => html`
          <h2>${label}</h2>
          <div class="split-actions">
            <button type="button" class="secondary" data-check-all="delete_${store}">全選${label}</button>
            <button type="button" class="secondary" data-uncheck-all="delete_${store}">清除${label}</button>
          </div>
          <div class="choice-grid">
            ${items.map(item => `<label class="check chip"><input type="checkbox" name="deleteRecords" data-delete-group="delete_${store}" value="${store}:${item.id}"><span>${escapeHtml(describe(item))}</span></label>`).join("") || `<p class="muted">沒有${label}</p>`}
          </div>
        `).join("")}
        <button class="danger">刪除勾選資料</button>
      </form>
    </details>`;
}

function bulkHiddenScopeInputs(prefix, item) {
  const ids = scopeIds(item);
  return ids.map(id => `<input type="hidden" name="${prefix}_${item.id}_scopeBranchIds" value="${id}">`).join("");
}

function bulkScopeControls(prefix, item, branches) {
  const selected = new Set(scopeIds(item).map(String));
  return html`
    <div class="bulk-scope">
      <b>可用分店</b>
      <small>不勾任何分店代表全部分店共用。</small>
      <div class="choice-grid">
        ${branches.map(branch => `<label class="check chip"><input type="checkbox" name="${prefix}_${item.id}_scopeBranchIds" value="${branch.id}" ${selected.has(String(branch.id)) ? "checked" : ""}><span>${escapeHtml(branch.name)}</span></label>`).join("") || `<p class="muted">尚未建立分店</p>`}
      </div>
    </div>`;
}

function bulkRecipeCompositionEditor(recipes, ingredients, seasonings, data) {
  if (!recipes.length) return "";
  if (!ingredients.length && !seasonings.length) return "";
  return html`
    <details class="card" open>
      <summary>批量編輯菜色組成</summary>
      <p class="muted">每道菜可以一次勾好食材和調味料，全部改完後按一次儲存。</p>
      <form data-action="bulkSaveRecipeComposition">
        ${recipes.map(recipe => {
          const ingredientIds = new Set(data.recipeIngredients.filter(link => Number(link.recipeId) === Number(recipe.id)).map(link => Number(link.ingredientId)));
          const seasoningIds = new Set(data.recipeSeasonings.filter(link => Number(link.recipeId) === Number(recipe.id)).map(link => Number(link.seasoningId)));
          return html`
          <details class="composition-item">
            <summary>${escapeHtml(recipe.name)} <small>${ingredientIds.size} 食材／${seasoningIds.size} 調味料</small></summary>
            <input type="hidden" name="recipeIds" value="${recipe.id}">
            <h2>食材</h2>
            <div class="choice-grid">
              ${ingredients.map(item => `<label class="check chip"><input type="checkbox" name="recipe_${recipe.id}_ingredientIds" value="${item.id}" ${ingredientIds.has(Number(item.id)) ? "checked" : ""}><span>${escapeHtml(item.ingredientName)}</span></label>`).join("") || `<p class="muted">尚未建立食材</p>`}
            </div>
            <h2>調味料</h2>
            <div class="choice-grid">
              ${seasonings.map(item => `<label class="check chip"><input type="checkbox" name="recipe_${recipe.id}_seasoningIds" value="${item.id}" ${seasoningIds.has(Number(item.id)) ? "checked" : ""}><span>${escapeHtml(item.name)}</span></label>`).join("") || `<p class="muted">尚未建立調味料</p>`}
            </div>
          </details>`;
        }).join("")}
        <button>全部儲存菜色組成</button>
      </form>
    </details>`;
}

function supplierRow(item, data) {
  const candidates = availableForScope(data.ingredients).filter(ingredient => Number(ingredient.supplierId) !== Number(item.id));
  return html`
    <div class="row"><span><b>${escapeHtml(item.name)}</b><br><small>${scopeText(item, data.branches)}／${escapeHtml(item.owner || "待補負責人")}／${escapeHtml(item.taxId || "待補統編")}／${escapeHtml(item.phone || "待補電話")}／${supplierUsage(data, item.id)} 樣食材</small><br><small>進貨：${deliveryText(item)}</small></span><button class="danger" data-delete="suppliers:${item.id}">刪除錯誤供應商</button></div>
    <details>
      <summary>修改供應商</summary>
      <form data-action="updateSupplier" data-id="${item.id}">
        <label>供應商名稱<input name="name" required value="${escapeHtml(item.name)}"></label>
        <label>負責人<input name="owner" required value="${escapeHtml(item.owner || "")}"></label>
        <label>統編<input name="taxId" required value="${escapeHtml(item.taxId || "")}"></label>
        <label>電話<input name="phone" required value="${escapeHtml(item.phone || "")}"></label>
        <label>地址<input name="address" required value="${escapeHtml(item.address || "")}"></label>
        ${deliveryControls(item)}
        ${scopeControls(item, data.branches)}
        <button class="secondary">儲存修改</button>
      </form>
    </details>
    ${candidates.length ? html`
    <details>
      <summary>把既有食材改到這個供應商</summary>
      <form data-action="assignIngredientsToSupplier" data-id="${item.id}">
        <p class="muted">適合新增供應商後，把原本已建立的食材直接轉過來。</p>
        ${candidates.map(ingredient => `<label class="check"><input type="checkbox" name="ingredientIds" value="${ingredient.id}"><span>${escapeHtml(ingredient.ingredientName)}／${supplierName(data.suppliers, ingredient.supplierId)}</span></label>`).join("")}
        <button class="secondary">更新食材供應商</button>
      </form>
    </details>` : ""}`;
}

function ingredientRow(item, data, suppliers) {
  const usedBy = data.recipeIngredients.filter(link => Number(link.ingredientId) === Number(item.id)).length;
  return html`
    <div class="row"><span><b>${escapeHtml(item.ingredientName)}</b><br><small>${scopeText(item, data.branches)}／${escapeHtml(item.origin || "臺灣")}／${supplierName(data.suppliers, item.supplierId)}${usedBy ? `／${usedBy} 道菜使用` : ""}</small></span><button class="danger" data-delete="ingredients:${item.id}">刪除錯誤食材</button></div>
    <details>
      <summary>修改食材</summary>
      <form data-action="updateIngredient" data-id="${item.id}">
        <label>食材名稱<input name="ingredientName" required value="${escapeHtml(item.ingredientName)}"></label>
        <label>產品名稱<input name="productName" value="${escapeHtml(item.productName || item.ingredientName)}"></label>
        <label>原產地<input name="origin" placeholder="不填會自動填臺灣" value="${escapeHtml(item.origin || "臺灣")}"></label>
        <label>供應商<select name="supplierId"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}" ${Number(item.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></label>
        ${scopeControls(item, data.branches)}
        <button class="secondary">儲存修改</button>
      </form>
    </details>`;
}

function seasoningRow(item, data, suppliers) {
  const usedBy = data.recipeSeasonings.filter(link => Number(link.seasoningId) === Number(item.id)).length;
  return html`
    <div class="row"><span><b>${escapeHtml(item.name)}</b><br><small>${scopeText(item, data.branches)}／${supplierName(data.suppliers, item.supplierId)}${usedBy ? `／${usedBy} 道菜使用` : ""}</small></span><button class="danger" data-delete="seasonings:${item.id}">刪除錯誤調味料</button></div>
    <details>
      <summary>修改調味料</summary>
      <form data-action="updateSeasoning" data-id="${item.id}">
        <label>調味料名稱<input name="name" required value="${escapeHtml(item.name)}"></label>
        <label>供應商<select name="supplierId"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}" ${Number(item.supplierId) === Number(s.id) ? "selected" : ""}>${escapeHtml(s.name)}</option>`).join("")}</select></label>
        ${scopeControls(item, data.branches)}
        <button class="secondary">儲存修改</button>
      </form>
    </details>`;
}

function recipeRow(recipe, data) {
  const links = data.recipeIngredients.filter(link => Number(link.recipeId) === Number(recipe.id));
  const names = links.map(link => data.ingredients.find(i => Number(i.id) === Number(link.ingredientId))?.ingredientName).filter(Boolean);
  const seasoningLinks = data.recipeSeasonings.filter(link => Number(link.recipeId) === Number(recipe.id));
  const seasoningNames = seasoningLinks.map(link => data.seasonings.find(s => Number(s.id) === Number(link.seasoningId))?.name).filter(Boolean);
  const ingredients = availableForScope(data.ingredients);
  const seasonings = availableForScope(data.seasonings);
  return html`
    <div class="row"><span><b>${escapeHtml(recipe.name)}</b><br><small>${scopeText(recipe, data.branches)}／${recipe.calories || 0} kcal／${names.join("、") || "尚未綁食材"}</small></span><button class="danger" data-delete="recipes:${recipe.id}">刪除錯誤菜色</button></div>
    <details>
      <summary>修改菜色與組成</summary>
      <form data-action="updateRecipe" data-id="${recipe.id}">
        <label>菜色名稱<input name="name" required value="${escapeHtml(recipe.name)}"></label>
        <label>熱量<input name="calories" type="number" min="0" value="${Number(recipe.calories || 0)}"></label>
        ${scopeControls(recipe, data.branches)}
        <h2>食材組成</h2>
        ${ingredients.map(i => `<label class="check"><input type="checkbox" name="ingredientIds" value="${i.id}" ${links.some(link => Number(link.ingredientId) === Number(i.id)) ? "checked" : ""}><span>${escapeHtml(i.ingredientName)}</span></label>`).join("") || `<p class="muted">尚未建立食材</p>`}
        <h2>調味料組成</h2>
        ${seasonings.map(s => `<label class="check"><input type="checkbox" name="seasoningIds" value="${s.id}" ${seasoningLinks.some(link => Number(link.seasoningId) === Number(s.id)) ? "checked" : ""}><span>${escapeHtml(s.name)}</span></label>`).join("") || `<p class="muted">尚未建立調味料</p>`}
        <button class="secondary">儲存修改</button>
      </form>
    </details>
    ${seasoningNames.length ? `<p class="muted">調味料：${seasoningNames.map(escapeHtml).join("、")}</p>` : ""}`;
}

function supplierName(suppliers, id) {
  return suppliers.find(s => Number(s.id) === Number(id))?.name || "待補供應商";
}

function supplierUsage(data, id) {
  return data.ingredients.filter(item => Number(item.supplierId) === Number(id)).length;
}

function scopeText(item, branches) {
  const ids = scopeIds(item);
  if (!ids.length) return "全部分店共用";
  const names = ids.map(id => branches.find(branch => Number(branch.id) === Number(id))?.name).filter(Boolean);
  return names.length ? `可用：${names.join("、")}` : "可用分店待確認";
}

function scopeControls(item, branches) {
  const selected = new Set(scopeIds(item).map(String));
  return html`
    <details>
      <summary>可用分店</summary>
      <p class="muted">不勾任何分店代表全部分店共用；只勾幾間，就只有那幾間店可用。</p>
      ${branches.map(branch => `<label class="check"><input type="checkbox" name="scopeBranchIds" value="${branch.id}" ${selected.has(String(branch.id)) ? "checked" : ""}><span>${escapeHtml(branch.name)}</span></label>`).join("") || `<p class="muted">尚未建立分店</p>`}
    </details>`;
}

function deliveryControls(item) {
  const selected = new Set(String(item.deliveryWeekdays || "").split(",").filter(Boolean));
  return html`
    <details>
      <summary>固定進貨星期</summary>
      <p class="muted">有固定送貨日才勾。沒勾時，食材進貨日會用供餐日前一個工作日。</p>
      ${WEEKDAYS.map(([value, label]) => `<label class="check"><input type="checkbox" name="deliveryWeekdays" value="${value}" ${selected.has(String(value)) ? "checked" : ""}><span>${label}</span></label>`).join("")}
    </details>`;
}

function deliveryText(item) {
  const selected = new Set(String(item.deliveryWeekdays || "").split(",").filter(Boolean));
  if (!selected.size) return "前一個工作日";
  return WEEKDAYS.filter(([value]) => selected.has(String(value))).map(([, label]) => label).join("、");
}

function scopedPayload(form, fallbackBranchId) {
  const branchIds = new FormData(form).getAll("scopeBranchIds").map(Number).filter(Boolean);
  if (branchIds.length) return { branchId: branchIds[0], branchIds };
  if (fallbackBranchId) return { branchId: Number(fallbackBranchId), branchIds: [Number(fallbackBranchId)] };
  return { branchId: null, branchIds: [] };
}

function deliveryPayload(form) {
  return new FormData(form).getAll("deliveryWeekdays").map(Number).filter(value => Number.isInteger(value)).sort((a, b) => a - b).join(",");
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handleSubmit(event) {
  const form = event.target.closest("form[data-action]");
  if (!form) return;
  event.preventDefault();
  const action = form.dataset.action;
  const values = formValues(form);
  const branchId = state.branchId ? Number(state.branchId) : null;
  if (action === "addBranch") {
    await put("branches", { name: values.name, schoolName: values.schoolName, serviceLocation: values.serviceLocation, restaurantName: values.restaurantName });
  }
  if (action === "addSupplier") {
    await put("suppliers", { ...scopedPayload(form, branchId), name: values.name, owner: values.owner, taxId: values.taxId, phone: values.phone, address: values.address, deliveryWeekdays: deliveryPayload(form) });
  }
  if (action === "addIngredient") {
    await put("ingredients", { ...scopedPayload(form, branchId), ingredientName: values.ingredientName, productName: values.productName || values.ingredientName, origin: values.origin || "臺灣", supplierId: values.supplierId ? Number(values.supplierId) : null });
  }
  if (action === "addSeasoning") {
    if (!values.supplierId) return alert("請先選供應商");
    await put("seasonings", { ...scopedPayload(form, branchId), name: values.name, supplierId: Number(values.supplierId) });
  }
  if (action === "addRecipe") {
    const recipeId = await put("recipes", { ...scopedPayload(form, branchId), name: values.name, calories: Number(values.calories || 0) });
    for (const input of form.querySelectorAll("input[name='ingredientIds']:checked")) await put("recipeIngredients", { recipeId, ingredientId: Number(input.value) });
    for (const input of form.querySelectorAll("input[name='seasoningIds']:checked")) await put("recipeSeasonings", { recipeId, seasoningId: Number(input.value) });
  }
  if (action === "bulkNames") {
    const counts = await bulkCreate(values, branchId);
    alert(`已建立：供應商 ${counts.suppliers}、調味料 ${counts.seasonings}、食材 ${counts.ingredients}、菜色 ${counts.recipes}`);
  }
  if (action === "downloadOfficial") {
    await downloadOfficial(form);
    return;
  }
  if (action === "lineCommand") {
    generateLineCommand(form);
    return;
  }
  if (action === "updateSupplier") {
    await put("suppliers", { id: Number(form.dataset.id), ...scopedPayload(form), name: values.name, owner: values.owner, taxId: values.taxId, phone: values.phone, address: values.address, deliveryWeekdays: deliveryPayload(form) });
  }
  if (action === "updateIngredient") {
    await put("ingredients", { id: Number(form.dataset.id), ...scopedPayload(form), ingredientName: values.ingredientName, productName: values.productName || values.ingredientName, origin: values.origin || "臺灣", supplierId: values.supplierId ? Number(values.supplierId) : null });
  }
  if (action === "updateSeasoning") {
    await put("seasonings", { id: Number(form.dataset.id), ...scopedPayload(form), name: values.name, supplierId: values.supplierId ? Number(values.supplierId) : null });
  }
  if (action === "updateRecipe") {
    const recipeId = Number(form.dataset.id);
    await put("recipes", { id: recipeId, ...scopedPayload(form), name: values.name, calories: Number(values.calories || 0) });
    await deleteWhere("recipeIngredients", link => Number(link.recipeId) === recipeId);
    await deleteWhere("recipeSeasonings", link => Number(link.recipeId) === recipeId);
    for (const input of form.querySelectorAll("input[name='ingredientIds']:checked")) await put("recipeIngredients", { recipeId, ingredientId: Number(input.value) });
    for (const input of form.querySelectorAll("input[name='seasoningIds']:checked")) await put("recipeSeasonings", { recipeId, seasoningId: Number(input.value) });
  }
  if (action === "assignIngredientsToSupplier") {
    const supplierId = Number(form.dataset.id);
    const data = await dataBundle();
    const selectedIds = new Set(new FormData(form).getAll("ingredientIds").map(Number));
    for (const ingredient of data.ingredients.filter(item => selectedIds.has(Number(item.id)))) {
      await put("ingredients", { ...ingredient, supplierId });
    }
    alert(`已更新 ${selectedIds.size} 個食材的供應商`);
  }
  if (action === "bulkSaveMasters") {
    await bulkSaveMasters(form);
    alert("資料已全部儲存");
  }
  if (action === "bulkDeleteRecords") {
    await bulkDeleteRecords(form);
    form.reset();
    await render();
    return;
  }
  if (action === "repairMissingData") {
    await repairMissingData(form);
    alert("待補資料已儲存");
  }
  if (action === "bulkSaveRecipes") {
    await bulkSaveRecipes(form);
    alert("菜色已全部儲存");
  }
  if (action === "bulkSaveRecipeComposition") {
    await bulkSaveRecipeComposition(form);
    alert("菜色組成已全部儲存");
  }
  form.reset();
  await render();
}

async function bulkSaveMasters(form) {
  const data = await dataBundle();
  const formData = new FormData(form);
  const suppliersById = new Map(data.suppliers.map(item => [Number(item.id), item]));
  const suppliers = arraysFromForm(formData, ["supplierIds", "supplierBranchIds", "supplierNames", "supplierOwners", "supplierTaxIds", "supplierPhones", "supplierAddresses"]);
  for (const row of suppliers) {
    if (!row.supplierIds || !row.supplierNames) continue;
    const old = suppliersById.get(Number(row.supplierIds)) || {};
    await put("suppliers", {
      ...old,
      id: Number(row.supplierIds),
      ...bulkScopePayload(formData, "supplier", row.supplierIds, row.supplierBranchIds),
      name: row.supplierNames,
      owner: row.supplierOwners || "",
      taxId: row.supplierTaxIds || "",
      phone: row.supplierPhones || "",
      address: row.supplierAddresses || ""
    });
  }
  const ingredientsById = new Map(data.ingredients.map(item => [Number(item.id), item]));
  const ingredients = arraysFromForm(formData, ["ingredientIds", "ingredientBranchIds", "ingredientNames", "ingredientProductNames", "ingredientOrigins", "ingredientSupplierIds"]);
  for (const row of ingredients) {
    if (!row.ingredientIds || !row.ingredientNames) continue;
    const old = ingredientsById.get(Number(row.ingredientIds)) || {};
    await put("ingredients", {
      ...old,
      id: Number(row.ingredientIds),
      ...bulkScopePayload(formData, "ingredient", row.ingredientIds, row.ingredientBranchIds),
      ingredientName: row.ingredientNames,
      productName: row.ingredientProductNames || row.ingredientNames,
      origin: row.ingredientOrigins || "臺灣",
      supplierId: row.ingredientSupplierIds ? Number(row.ingredientSupplierIds) : null
    });
  }
  const seasoningsById = new Map(data.seasonings.map(item => [Number(item.id), item]));
  const seasonings = arraysFromForm(formData, ["seasoningIds", "seasoningBranchIds", "seasoningNames", "seasoningSupplierIds"]);
  for (const row of seasonings) {
    if (!row.seasoningIds || !row.seasoningNames) continue;
    const old = seasoningsById.get(Number(row.seasoningIds)) || {};
    await put("seasonings", {
      ...old,
      id: Number(row.seasoningIds),
      ...bulkScopePayload(formData, "seasoning", row.seasoningIds, row.seasoningBranchIds),
      name: row.seasoningNames,
      supplierId: row.seasoningSupplierIds ? Number(row.seasoningSupplierIds) : null
    });
  }
  await bulkSaveIngredientRecipeUsage(formData);
}

async function bulkSaveIngredientRecipeUsage(formData) {
  const ingredientIds = formData.getAll("ingredientRecipeIngredientIds").map(Number).filter(Boolean);
  if (!ingredientIds.length) return;
  const selectedIngredientIds = new Set(ingredientIds);
  await deleteWhere("recipeIngredients", link => selectedIngredientIds.has(Number(link.ingredientId)));
  for (const ingredientId of ingredientIds) {
    const recipeIds = formData.getAll(`ingredient_${ingredientId}_recipeIds`).map(Number).filter(Boolean);
    for (const recipeId of recipeIds) await put("recipeIngredients", { recipeId, ingredientId });
  }
}

async function bulkDeleteRecords(form) {
  const records = new FormData(form).getAll("deleteRecords");
  if (!records.length) return alert("請先勾選要刪除的資料。");
  if (!confirm(`確定刪除勾選的 ${records.length} 筆資料？這個動作不能復原。`)) return;
  for (const target of records) {
    const [store, id] = String(target).split(":");
    if (!store || !id) continue;
    await deleteRecord(store, id);
  }
  alert(`已刪除 ${records.length} 筆資料`);
}

async function repairMissingData(form) {
  const data = await dataBundle();
  const formData = formDataFromElement(form);
  const suppliersById = new Map(data.suppliers.map(item => [Number(item.id), item]));
  const supplierRows = arraysFromForm(formData, ["repairSupplierIds", "repairSupplierNames", "repairSupplierOwners", "repairSupplierTaxIds", "repairSupplierPhones", "repairSupplierAddresses"]);
  for (const row of supplierRows) {
    if (!row.repairSupplierIds) continue;
    const old = suppliersById.get(Number(row.repairSupplierIds));
    if (!old) continue;
    await put("suppliers", {
      ...old,
      name: row.repairSupplierNames || old.name || "",
      owner: row.repairSupplierOwners || "",
      taxId: row.repairSupplierTaxIds || "",
      phone: row.repairSupplierPhones || "",
      address: row.repairSupplierAddresses || ""
    });
  }

  const ingredientsById = new Map(data.ingredients.map(item => [Number(item.id), item]));
  const ingredientRows = arraysFromForm(formData, ["repairIngredientIds", "repairIngredientNames", "repairIngredientProductNames", "repairIngredientOrigins", "repairIngredientSupplierIds"]);
  for (const row of ingredientRows) {
    if (!row.repairIngredientIds) continue;
    const old = ingredientsById.get(Number(row.repairIngredientIds));
    if (!old) continue;
    await put("ingredients", {
      ...old,
      ingredientName: row.repairIngredientNames || old.ingredientName || "",
      productName: row.repairIngredientProductNames || row.repairIngredientNames || old.productName || old.ingredientName || "",
      origin: row.repairIngredientOrigins || "臺灣",
      supplierId: row.repairIngredientSupplierIds ? Number(row.repairIngredientSupplierIds) : null
    });
  }

  const seasoningsById = new Map(data.seasonings.map(item => [Number(item.id), item]));
  const seasoningRows = arraysFromForm(formData, ["repairSeasoningIds", "repairSeasoningSupplierIds"]);
  for (const row of seasoningRows) {
    if (!row.repairSeasoningIds) continue;
    const old = seasoningsById.get(Number(row.repairSeasoningIds));
    if (!old) continue;
    await put("seasonings", {
      ...old,
      supplierId: row.repairSeasoningSupplierIds ? Number(row.repairSeasoningSupplierIds) : null
    });
  }
}

function formDataFromElement(element) {
  if (element instanceof HTMLFormElement) return new FormData(element);
  const formData = new FormData();
  for (const field of element.querySelectorAll("input, select, textarea")) {
    if (!field.name || field.disabled) continue;
    if ((field.type === "checkbox" || field.type === "radio") && !field.checked) continue;
    formData.append(field.name, field.value);
  }
  return formData;
}

async function bulkSaveRecipes(form) {
  const formData = new FormData(form);
  const rows = arraysFromForm(formData, ["recipeIds", "recipeBranchIds", "recipeNames", "recipeCalories"]);
  for (const row of rows) {
    if (!row.recipeIds || !row.recipeNames) continue;
    await put("recipes", {
      id: Number(row.recipeIds),
      ...bulkScopePayload(formData, "recipe", row.recipeIds, row.recipeBranchIds),
      name: row.recipeNames,
      calories: Number(row.recipeCalories || 0)
    });
  }
}

function bulkScopePayload(formData, prefix, id, fallbackBranchId) {
  const branchIds = formData.getAll(`${prefix}_${id}_scopeBranchIds`).map(Number).filter(Boolean);
  if (branchIds.length) return { branchId: branchIds[0], branchIds };
  return { branchId: null, branchIds: [] };
}

async function bulkSaveRecipeComposition(form) {
  const formData = new FormData(form);
  const recipeIds = formData.getAll("recipeIds").map(Number).filter(Boolean);
  const selectedRecipeIds = new Set(recipeIds);
  await deleteWhere("recipeIngredients", link => selectedRecipeIds.has(Number(link.recipeId)));
  await deleteWhere("recipeSeasonings", link => selectedRecipeIds.has(Number(link.recipeId)));
  for (const recipeId of recipeIds) {
    for (const ingredientId of formData.getAll(`recipe_${recipeId}_ingredientIds`).map(Number).filter(Boolean)) {
      await put("recipeIngredients", { recipeId, ingredientId });
    }
    for (const seasoningId of formData.getAll(`recipe_${recipeId}_seasoningIds`).map(Number).filter(Boolean)) {
      await put("recipeSeasonings", { recipeId, seasoningId });
    }
  }
}

function arraysFromForm(formData, keys) {
  const lists = Object.fromEntries(keys.map(key => [key, formData.getAll(key)]));
  const length = Math.max(...keys.map(key => lists[key].length));
  return Array.from({ length }, (_, index) => Object.fromEntries(keys.map(key => [key, lists[key][index] ?? ""])));
}

function optionalNumber(value) {
  return value === "" || value === undefined || value === null ? null : Number(value);
}

async function bulkCreate(values, branchId) {
  const data = await dataBundle();
  const counts = { suppliers: 0, seasonings: 0, ingredients: 0, recipes: 0 };
  const supplierByName = new Map(data.suppliers.filter(item => sameScope(item.branchId, branchId)).map(item => [normalizeName(item.name), item]));
  const ingredientNames = new Set(data.ingredients.filter(item => sameScope(item.branchId, branchId)).map(item => normalizeName(item.ingredientName)));
  const seasoningNames = new Set(data.seasonings.filter(item => sameScope(item.branchId, branchId)).map(item => normalizeName(item.name)));
  const recipeNames = new Set(data.recipes.filter(item => sameScope(item.branchId, branchId)).map(item => normalizeName(item.name)));

  for (const item of parseBulkLines(values.supplySeasoning, "供應商")) {
    if (item.type === "供應商") {
      const name = item.parts[0];
      if (!name || supplierByName.has(normalizeName(name))) continue;
      const supplier = { branchId, name, owner: item.parts[1] || "", taxId: item.parts[2] || "", phone: item.parts[3] || "", address: item.parts[4] || "" };
      supplier.id = await put("suppliers", supplier);
      supplierByName.set(normalizeName(name), supplier);
      counts.suppliers += 1;
    }
    if (item.type === "調味料") {
      const name = item.parts[0];
      if (!name || seasoningNames.has(normalizeName(name))) continue;
      const supplier = await ensureSupplier(item.parts[1], branchId, supplierByName);
      await put("seasonings", { branchId, name, supplierId: supplier?.id ? Number(supplier.id) : null });
      seasoningNames.add(normalizeName(name));
      counts.seasonings += 1;
    }
  }

  for (const item of parseBulkLines(values.ingredientRecipe, "食材")) {
    if (item.type === "食材") {
      const name = item.parts[0];
      if (!name || ingredientNames.has(normalizeName(name))) continue;
      const supplier = await ensureSupplier(item.parts[1], branchId, supplierByName);
      await put("ingredients", { branchId, ingredientName: name, productName: item.parts[3] || name, origin: item.parts[2] || "臺灣", supplierId: supplier?.id ? Number(supplier.id) : null });
      ingredientNames.add(normalizeName(name));
      counts.ingredients += 1;
    }
    if (item.type === "菜色") {
      const name = item.parts[0];
      if (!name || recipeNames.has(normalizeName(name))) continue;
      await put("recipes", { branchId, name, calories: Number(item.parts[1] || 0) });
      recipeNames.add(normalizeName(name));
      counts.recipes += 1;
    }
  }
  return counts;
}

function parseBulkLines(text, defaultType) {
  return String(text || "").split(/\r?\n/).map(raw => raw.trim()).filter(Boolean).map(raw => {
    const prefix = raw.match(/^([^:：]+)[:：](.*)$/);
    const type = normalizeBulkType(prefix ? prefix[1] : defaultType);
    const body = prefix ? prefix[2] : raw;
    const parts = body.split(/[,\t，]/).map(part => part.trim()).filter(Boolean);
    return { type, parts };
  });
}

function normalizeBulkType(type) {
  const value = normalizeName(type);
  if (["廠商", "供應商"].includes(value)) return "供應商";
  if (["調味料", "調味"].includes(value)) return "調味料";
  if (["食材", "材料"].includes(value)) return "食材";
  if (["菜色", "菜單", "餐點"].includes(value)) return "菜色";
  return type;
}

async function ensureSupplier(name, branchId, supplierByName) {
  const key = normalizeName(name);
  if (!key) return null;
  if (supplierByName.has(key)) return supplierByName.get(key);
  const supplier = { branchId, name, owner: "", taxId: "", phone: "", address: "" };
  supplier.id = await put("suppliers", supplier);
  supplierByName.set(key, supplier);
  return supplier;
}

function sameScope(itemBranchId, branchId) {
  return String(itemBranchId || "") === String(branchId || "");
}

function normalizeName(value) {
  return String(value || "").trim().toLowerCase();
}

async function exportBackup() {
  const data = await dataBundle();
  const workbook = XLSX.utils.book_new();
  for (const store of STORES) {
    const sheet = XLSX.utils.json_to_sheet(data[store]);
    XLSX.utils.book_append_sheet(workbook, sheet, LABELS[store]);
  }
  const filename = `食材登錄備份_${new Date().toISOString().slice(0, 10)}.xlsx`;
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  showBackupDownload(blob, filename);
  await shareFileIfAvailable(blob, filename);
}

function showBackupDownload(blob, filename) {
  if (backupDownloadUrl) URL.revokeObjectURL(backupDownloadUrl);
  backupDownloadUrl = URL.createObjectURL(blob);
  const result = document.getElementById("backupResult");
  if (!result) return;
  result.innerHTML = html`
    <div class="notice">
      備份檔已產生。請點下面連結，或長按後選「下載連結檔案／儲存到檔案」。
      <br><a class="btn" href="${backupDownloadUrl}" download="${escapeHtml(filename)}">${escapeHtml(filename)}</a>
    </div>`;
}

async function shareFileIfAvailable(blob, filename) {
  if (!("File" in window) || !navigator.canShare || !navigator.share) return;
  const file = new File([blob], filename, { type: blob.type });
  if (!navigator.canShare({ files: [file] })) return;
  await navigator.share({ files: [file], title: "食材登錄備份" }).catch(() => {});
}

async function importBackup(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const byLabel = Object.fromEntries(Object.entries(LABELS).map(([store, label]) => [label, store]));
  for (const store of STORES) await clearStore(store);
  for (const sheetName of workbook.SheetNames) {
    const store = byLabel[sheetName];
    if (!store) continue;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    for (const row of rows) {
      const normalized = { ...row };
      for (const key of ["id", "branchId", "supplierId", "recipeId", "ingredientId", "seasoningId", "calories"]) {
        if (normalized[key] !== "" && normalized[key] !== undefined && normalized[key] !== null) normalized[key] = Number(normalized[key]);
      }
      await put(store, normalized);
    }
  }
  alert("備份已匯入");
  await render();
}

async function importOfficialWorkbook(file, type) {
  if (!window.XLSX) throw new Error("Excel 讀取元件尚未載入，請重新整理一次。");
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const branchId = state.branchId ? Number(state.branchId) : null;
  const data = await dataBundle();
  const rows = officialRows(workbook, type);
  const errors = [];
  let result = { created: 0, updated: 0 };
  if (type === "suppliers") result = await importOfficialSuppliers(rows, branchId, data, errors);
  if (type === "ingredients") result = await importOfficialIngredients(rows, branchId, data, errors);
  if (type === "recipes") result = await importOfficialRecipes(rows, branchId, data, errors);
  if (type === "seasonings") result = await importOfficialSeasonings(rows, branchId, data, errors);
  return { ...result, errors };
}

function officialRows(workbook, type) {
  const preferred = type === "suppliers" ? "Data" : type === "seasonings" ? "Sheet1" : workbook.SheetNames[0];
  const sheet = workbook.Sheets[workbook.SheetNames.includes(preferred) ? preferred : workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false }).slice(1);
}

async function importOfficialSuppliers(rows, branchId, data, errors) {
  let created = 0;
  let updated = 0;
  const existing = new Map(data.suppliers.filter(item => sameScopeForImport(item, branchId)).map(item => [normalizeName(item.name), item]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const name = cleanCell(row[0]);
    if (!name) continue;
    const owner = cleanCell(row[1]);
    const taxId = cleanCell(row[2]);
    const address = cleanCell(row[3]);
    const phone = cleanCell(row[4]);
    if (!owner || !taxId || !address || !phone) {
      errors.push(`第 ${index + 2} 列供應商「${name}」缺少負責人、統編、地址或電話，已略過。`);
      continue;
    }
    const old = existing.get(normalizeName(name));
    await put("suppliers", { ...(old || {}), ...importScope(branchId), id: old?.id, name, owner, taxId, address, phone, deliveryWeekdays: old?.deliveryWeekdays || "" });
    if (old) updated += 1;
    else {
      existing.set(normalizeName(name), { name });
      created += 1;
    }
  }
  return { created, updated };
}

async function importOfficialIngredients(rows, branchId, data, errors) {
  let created = 0;
  let updated = 0;
  const suppliers = await all("suppliers");
  const supplierByName = new Map(suppliers.map(item => [normalizeName(item.name), item]));
  const existing = new Map(data.ingredients.filter(item => sameScopeForImport(item, branchId)).map(item => [normalizeName(item.ingredientName), item]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const productName = cleanCell(row[5]);
    const ingredientName = cleanCell(row[6]) || productName;
    const origin = cleanCell(row[7]) || "臺灣";
    const supplierName = cleanCell(row[8]);
    if (!ingredientName) continue;
    const supplier = supplierByName.get(normalizeName(supplierName));
    if (supplierName && !supplier) errors.push(`第 ${index + 2} 列食材「${ingredientName}」找不到供應商「${supplierName}」，已先建成待補供應商。`);
    const old = existing.get(normalizeName(ingredientName));
    await put("ingredients", { ...(old || {}), ...importScope(branchId), id: old?.id, ingredientName, productName: productName || ingredientName, origin, supplierId: supplier?.id ? Number(supplier.id) : null });
    if (old) updated += 1;
    else {
      existing.set(normalizeName(ingredientName), { ingredientName });
      created += 1;
    }
  }
  return { created, updated };
}

async function importOfficialRecipes(rows, branchId, data, errors) {
  let created = 0;
  let updated = 0;
  const existing = new Map(data.recipes.filter(item => sameScopeForImport(item, branchId)).map(item => [normalizeName(item.name), item]));
  const ingredients = data.ingredients.filter(item => (branchId ? availableForBranchId(item, branchId) : !scopeIds(item).length));
  const ingredientByName = new Map();
  for (const ingredient of ingredients) {
    ingredientByName.set(normalizeName(ingredient.ingredientName), ingredient);
    if (ingredient.productName) ingredientByName.set(normalizeName(ingredient.productName), ingredient);
  }
  const linkedRecipes = new Set();
  for (const row of rows) {
    const name = cleanCell(row[5]);
    if (!name) continue;
    const old = existing.get(normalizeName(name));
    const recipeId = await put("recipes", { ...(old || {}), ...importScope(branchId), id: old?.id, name, calories: Number(cleanCell(row[7]) || 0) || 0 });
    if (old) updated += 1;
    else {
      existing.set(normalizeName(name), { id: recipeId, name });
      created += 1;
    }
    const ingredientNames = splitIngredientNames(row[6]);
    if (ingredientNames.length && !linkedRecipes.has(Number(recipeId))) {
      linkedRecipes.add(Number(recipeId));
      await deleteWhere("recipeIngredients", link => Number(link.recipeId) === Number(recipeId));
      const linkedIngredientIds = new Set();
      for (const ingredientName of ingredientNames) {
        const ingredient = ingredientByName.get(normalizeName(ingredientName));
        if (!ingredient) {
          errors.push(`菜色「${name}」找不到食材「${ingredientName}」，未建立這個組成。`);
          continue;
        }
        if (linkedIngredientIds.has(Number(ingredient.id))) continue;
        linkedIngredientIds.add(Number(ingredient.id));
        await put("recipeIngredients", { recipeId: Number(recipeId), ingredientId: Number(ingredient.id) });
      }
    }
  }
  return { created, updated };
}

async function importOfficialSeasonings(rows, branchId, data, errors) {
  let created = 0;
  let updated = 0;
  const suppliers = await all("suppliers");
  const supplierByName = new Map(suppliers.map(item => [normalizeName(item.name), item]));
  const existing = new Map(data.seasonings.filter(item => sameScopeForImport(item, branchId)).map(item => [normalizeName(item.name), item]));
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const name = cleanCell(row[3]);
    const supplierName = cleanCell(row[9]);
    if (!name) continue;
    const supplier = supplierByName.get(normalizeName(supplierName));
    if (!supplier) {
      errors.push(`第 ${index + 2} 列調味料「${name}」找不到供應商「${supplierName || "空白"}」，已略過。`);
      continue;
    }
    const old = existing.get(normalizeName(name));
    await put("seasonings", { ...(old || {}), ...importScope(branchId), id: old?.id, name, supplierId: Number(supplier.id) });
    if (old) updated += 1;
    else {
      existing.set(normalizeName(name), { name });
      created += 1;
    }
  }
  return { created, updated };
}

function importScope(branchId) {
  return branchId ? { branchId, branchIds: [branchId] } : { branchId: null, branchIds: [] };
}

function sameScopeForImport(item, branchId) {
  if (!branchId) return !scopeIds(item).length;
  return availableForBranchId(item, branchId);
}

function cleanCell(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function splitIngredientNames(value) {
  return cleanCell(value)
    .split(/[、,，;；\n\r]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

async function downloadOfficial(form) {
  if (!window.JSZip) {
    alert("Excel 下載元件尚未載入，請確認有網路後重新整理一次。");
    return;
  }
  const result = document.getElementById("downloadResult");
  result.innerHTML = `<div class="notice">正在整理資料...</div>`;
  const data = await dataBundle();
  const formData = new FormData(form);
  const branchId = Number(formData.get("branchId"));
  const branch = data.branches.find(item => Number(item.id) === branchId);
  const fileTypes = formData.getAll("fileTypes");
  const recipeIds = new Set(formData.getAll("recipeIds").map(Number));
  const ingredientSource = formData.get("ingredientSource") || "recipes";
  const manualIngredientIds = new Set(formData.getAll("manualIngredientIds").map(Number).filter(Boolean));
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const options = { ingredientSource, manualIngredientIds };
  const problems = validateDownload(data, branch, fileTypes, recipeIds, startDate, endDate, options);
  if (problems.length) {
    const repairIssues = collectDownloadRepairIssues(data, branch, fileTypes, recipeIds, options);
    result.innerHTML = html`
      <div class="notice"><b>先補完這些資料：</b><ul class="warning-list">${problems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>
      <div class="card repair-panel" data-download-repair>
        <h2>直接在這裡補資料</h2>
        <p class="muted">補完按儲存，系統會重新整理。再按一次「產生並下載」就可以繼續。</p>
        ${repairIssues.branches.length ? `<div class="notice"><b>分店資料要先補：</b><ul class="warning-list">${repairIssues.branches.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul><small>請到「分店管理」修改分店資料。</small></div>` : ""}
        ${renderRepairFields(data, branchId, repairIssues)}
        <button type="button" data-action-click="saveDownloadRepair">儲存待補資料</button>
      </div>`;
    return;
  }
  clearGeneratedDownloads();
  const officialRows = buildOfficialRows(data, branch, recipeIds, startDate, endDate, options);
  const generatedFiles = [];
  for (const type of fileTypes) {
    const file = await writeOfficialWorkbook(type, officialRows[type], `${branch.name}_${OFFICIAL_TEMPLATES[type].name}_${startDate}_到_${endDate}.xlsx`);
    generatedFiles.push(file);
    if (!isStandaloneApp()) saveBlob(file.blob, file.filename);
  }
  const lineText = `已上傳 ${branch.name} ${startDate} ${endDate}`;
  result.innerHTML = html`
    <div class="notice">
      已產生 ${fileTypes.length} 個 Excel。${isStandaloneApp() ? "你現在是主畫面 App 模式，iPhone 可能會擋自動下載；請用下面每個檔案的按鈕儲存。" : "若手機瀏覽器擋住多檔下載，也可以用下面的單檔按鈕。"}
      ${renderGeneratedDownloads(generatedFiles)}
      <br><br><button type="button" data-line-upload-text="${escapeHtml(lineText)}">我已上傳官方平台</button>
      <div id="lineUploadResult"></div>
    </div>`;
}

function generateLineCommand(form) {
  const data = new FormData(form);
  const branchName = form.querySelector(`select[name="branchId"] option:checked`)?.textContent?.trim() || "";
  const startDate = data.get("startDate");
  const endDate = data.get("endDate");
  const commandType = data.get("commandType");
  const prefix = commandType === "closed" ? "休息" : commandType === "status" ? "登錄狀況" : "已上傳";
  const text = prefix === "登錄狀況"
    ? `${prefix} ${startDate} ${endDate}`
    : `${prefix} ${branchName} ${startDate} ${endDate}`;
  const result = document.getElementById("lineCommandResult");
  if (result) result.innerHTML = lineCopyBox("lineCommandText", text, commandType === "closed" ? "把這段傳給 LINE 機器人，這段日期就不會提醒未上傳。" : "把這段傳給 LINE 機器人。");
}

function lineCopyBox(id, text, helpText) {
  return html`
    <div class="notice">
      ${escapeHtml(helpText)}
      <textarea id="${id}" readonly rows="2">${escapeHtml(text)}</textarea>
      <button type="button" data-copy-target="${id}" class="secondary">複製 LINE 文字</button>
    </div>`;
}

function collectRepairIssues(data, branchId) {
  const branch = data.branches.find(item => Number(item.id) === Number(branchId));
  const supplierById = new Map(data.suppliers.map(item => [Number(item.id), item]));
  const suppliers = branchId ? availableForBranch(data.suppliers, branchId) : availableForScope(data.suppliers);
  const ingredients = branchId ? availableForBranch(data.ingredients, branchId) : availableForScope(data.ingredients);
  const seasonings = branchId ? availableForBranch(data.seasonings, branchId) : availableForScope(data.seasonings);
  const issues = { branches: [], suppliers: [], ingredients: [], seasonings: [] };

  if (!branch) issues.branches.push("尚未選擇分店。");
  for (const field of ["schoolName", "serviceLocation", "restaurantName"]) {
    if (branch && !cleanCell(branch[field])) issues.branches.push(`分店「${branch.name}」缺少${fieldLabel(field)}。`);
  }

  for (const supplier of suppliers) {
    const missing = supplierMissingFields(supplier);
    if (missing.length) issues.suppliers.push({ supplier, missing });
  }

  for (const ingredient of ingredients) {
    const missing = [];
    if (!cleanCell(ingredient.ingredientName)) missing.push("食材名稱");
    if (!cleanCell(ingredient.productName)) missing.push("產品名稱");
    if (!cleanCell(ingredient.origin)) missing.push("原產地");
    if (!ingredient.supplierId) missing.push("供應商");
    else if (!supplierById.has(Number(ingredient.supplierId))) missing.push("供應商不存在，請重新選擇");
    if (missing.length) issues.ingredients.push({ ingredient, missing });
  }

  for (const seasoning of seasonings) {
    const missing = [];
    if (!cleanCell(seasoning.name)) missing.push("調味料名稱");
    if (!seasoning.supplierId) missing.push("供應商");
    else if (!supplierById.has(Number(seasoning.supplierId))) missing.push("供應商不存在，請重新選擇");
    if (missing.length) issues.seasonings.push({ seasoning, missing });
  }

  return issues;
}

function collectDownloadRepairIssues(data, branch, fileTypes, recipeIds, options = {}) {
  const branchId = branch?.id;
  const recipes = availableForBranch(data.recipes, branchId).filter(recipe => recipeIds.has(Number(recipe.id)));
  const supplierById = new Map(data.suppliers.map(item => [Number(item.id), item]));
  const issues = { branches: [], suppliers: [], ingredients: [], seasonings: [] };

  if (!branch) issues.branches.push("尚未選擇分店。");
  for (const field of ["schoolName", "serviceLocation", "restaurantName"]) {
    if (branch && !cleanCell(branch[field])) issues.branches.push(`分店「${branch.name}」缺少${fieldLabel(field)}。`);
  }

  if (fileTypes.includes("ingredients")) {
    for (const id of selectedIngredientIds(data, recipes, options)) {
      const ingredient = data.ingredients.find(item => Number(item.id) === Number(id));
      if (!ingredient) continue;
      const missing = [];
      if (!cleanCell(ingredient.ingredientName)) missing.push("食材名稱");
      if (!cleanCell(ingredient.productName)) missing.push("產品名稱");
      if (!cleanCell(ingredient.origin)) missing.push("原產地");
      if (!ingredient.supplierId) missing.push("供應商");
      else if (!supplierById.has(Number(ingredient.supplierId))) missing.push("供應商不存在，請重新選擇");
      if (missing.length) issues.ingredients.push({ ingredient, missing });
    }
  }

  if (fileTypes.includes("seasonings")) {
    for (const seasoning of usedSeasonings(data, recipes)) {
      if (!seasoning) continue;
      const missing = [];
      if (!cleanCell(seasoning.name)) missing.push("調味料名稱");
      if (!seasoning.supplierId) missing.push("供應商");
      else if (!supplierById.has(Number(seasoning.supplierId))) missing.push("供應商不存在，請重新選擇");
      if (missing.length) issues.seasonings.push({ seasoning, missing });
    }
  }

  const suppliersToCheck = fileTypes.includes("suppliers")
    ? availableForBranch(data.suppliers, branchId)
    : usedSuppliers(data, recipes, fileTypes, options);
  for (const supplier of suppliersToCheck) {
    const missing = supplierMissingFields(supplier);
    if (missing.length) issues.suppliers.push({ supplier, missing });
  }

  return issues;
}

function supplierMissingFields(supplier) {
  const fields = [
    ["name", "供應商名稱"],
    ["owner", "負責人"],
    ["taxId", "統編"],
    ["phone", "電話"],
    ["address", "地址"]
  ];
  return fields.filter(([key]) => !cleanCell(supplier[key])).map(([, label]) => label);
}

function validateDownload(data, branch, fileTypes, recipeIds, startDate, endDate, options = {}) {
  const problems = [];
  if (!branch) problems.push("請先選擇分店。");
  if (!startDate || !endDate || startDate > endDate) problems.push("日期區間不正確。");
  if (!fileTypes.length) problems.push("請至少勾選一種 Excel。");
  const recipes = availableForBranch(data.recipes, branch?.id).filter(recipe => recipeIds.has(Number(recipe.id)));
  if (fileTypes.includes("menus") && !recipes.length) problems.push("產生菜單 Excel 請至少選一個菜色。");
  if (fileTypes.includes("seasonings") && !recipes.length) problems.push("產生調味料 Excel 請至少選一個菜色。");
  if (fileTypes.includes("ingredients") && options.ingredientSource !== "manual" && !recipes.length) problems.push("依菜色組成產生食材 Excel 時，請至少選一個菜色。");
  if (fileTypes.includes("ingredients") && options.ingredientSource === "manual" && !options.manualIngredientIds?.size) problems.push("手動產生食材 Excel 時，請至少勾選一個進貨食材。");
  for (const field of ["schoolName", "serviceLocation", "restaurantName"]) {
    if (branch && !branch[field]) problems.push(`分店「${branch.name}」缺少${fieldLabel(field)}。`);
  }
  if (fileTypes.includes("ingredients")) {
    const ingredientIds = selectedIngredientIds(data, recipes, options);
    for (const id of ingredientIds) {
      const ingredient = data.ingredients.find(item => Number(item.id) === Number(id));
      const supplier = data.suppliers.find(item => Number(item.id) === Number(ingredient?.supplierId));
      if (!ingredient?.ingredientName || !ingredient?.productName || !ingredient?.origin) problems.push(`食材「${ingredient?.ingredientName || id}」缺少產品名稱、食材名稱或原產地。`);
      if (!supplier) problems.push(`食材「${ingredient?.ingredientName || id}」缺少供應商。`);
    }
  }
  if (fileTypes.includes("seasonings")) {
    for (const seasoning of usedSeasonings(data, recipes)) {
      const supplier = data.suppliers.find(item => Number(item.id) === Number(seasoning?.supplierId));
      if (!supplier) problems.push(`調味料「${seasoning?.name || "未命名"}」缺少供應商。`);
    }
  }
  const suppliersToCheck = fileTypes.includes("suppliers")
    ? availableForBranch(data.suppliers, branch?.id)
    : usedSuppliers(data, recipes, fileTypes, options);
  if (fileTypes.includes("suppliers") || fileTypes.includes("ingredients") || fileTypes.includes("seasonings")) {
    for (const supplier of suppliersToCheck) {
      if (!supplier.name || !supplier.owner || !supplier.taxId || !supplier.phone || !supplier.address) problems.push(`供應商「${supplier.name || "未命名"}」負責人、統編、電話、地址都要填。`);
    }
  }
  return [...new Set(problems)];
}

function fieldLabel(field) {
  return { schoolName: "學校名稱", serviceLocation: "供餐地點", restaurantName: "餐廳名稱" }[field] || field;
}

function buildOfficialRows(data, branch, recipeIds, startDate, endDate, options = {}) {
  const dates = serviceDates(startDate, endDate);
  const recipes = availableForBranch(data.recipes, branch.id).filter(recipe => recipeIds.has(Number(recipe.id)));
  const seasoningIds = usedSeasoningIds(data, recipes);
  const suppliers = availableForBranch(data.suppliers, branch.id);
  const rows = { menus: [], ingredients: [], seasonings: [], suppliers: [] };
  const ingredientRowKeys = new Set();
  for (const date of dates) {
    for (const recipe of recipes) {
      const recipeIngredients = data.recipeIngredients
        .filter(item => Number(item.recipeId) === Number(recipe.id))
        .map(link => data.ingredients.find(item => Number(item.id) === Number(link.ingredientId))?.ingredientName)
        .filter(Boolean);
      rows.menus.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, date, "", recipe.name, recipeIngredients.join("、"), Number(recipe.calories || 0)]);
    }
  }
  const ingredientIds = selectedIngredientIds(data, recipes, options);
  for (const date of dates) {
    for (const id of ingredientIds) {
      const ingredient = data.ingredients.find(item => Number(item.id) === Number(id));
      const supplier = data.suppliers.find(item => Number(item.id) === Number(ingredient?.supplierId));
      const purchaseDate = purchaseDateFor(date, supplier);
      const key = [purchaseDate, ingredient?.id || "", supplier?.id || ""].join("|");
      if (ingredientRowKeys.has(key)) continue;
      ingredientRowKeys.add(key);
      rows.ingredients.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, date, purchaseDate, ingredient?.productName || "", ingredient?.ingredientName || "", ingredient?.origin || "", supplier?.name || ""]);
    }
  }
  for (const id of seasoningIds) {
    const seasoning = data.seasonings.find(item => Number(item.id) === Number(id));
    const supplier = data.suppliers.find(item => Number(item.id) === Number(seasoning?.supplierId));
    rows.seasonings.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, seasoning?.name || "", purchaseDateFor(startDate, supplier), "", "", startDate, endDate, supplier?.name || ""]);
  }
  for (const supplier of suppliers) rows.suppliers.push([supplier.name, supplier.owner, supplier.taxId, supplier.address, supplier.phone]);
  return rows;
}

function usedIngredientIds(data, recipes) {
  const recipeIds = new Set(recipes.map(recipe => Number(recipe.id)));
  return [...new Set(data.recipeIngredients.filter(item => recipeIds.has(Number(item.recipeId))).map(item => Number(item.ingredientId)))];
}

function selectedIngredientIds(data, recipes, options = {}) {
  if (options.ingredientSource === "manual") return [...new Set([...(options.manualIngredientIds || [])].map(Number).filter(Boolean))];
  return usedIngredientIds(data, recipes);
}

function usedSeasoningIds(data, recipes) {
  const recipeIds = new Set(recipes.map(recipe => Number(recipe.id)));
  return [...new Set(data.recipeSeasonings.filter(item => recipeIds.has(Number(item.recipeId))).map(item => Number(item.seasoningId)))];
}

function usedSeasonings(data, recipes) {
  const ids = new Set(usedSeasoningIds(data, recipes).map(Number));
  return data.seasonings.filter(item => ids.has(Number(item.id)));
}

function usedSuppliers(data, recipes, fileTypes, options = {}) {
  const ids = new Set();
  if (fileTypes.includes("ingredients")) {
    const ingredientIds = new Set(selectedIngredientIds(data, recipes, options).map(Number));
    for (const ingredient of data.ingredients.filter(item => ingredientIds.has(Number(item.id)))) {
      if (ingredient.supplierId) ids.add(Number(ingredient.supplierId));
    }
  }
  if (fileTypes.includes("seasonings")) {
    for (const seasoning of usedSeasonings(data, recipes)) {
      if (seasoning.supplierId) ids.add(Number(seasoning.supplierId));
    }
  }
  return data.suppliers.filter(item => ids.has(Number(item.id)));
}

function serviceDates(startDate, endDate) {
  const dates = [];
  for (let date = parseLocalDate(startDate); date <= parseLocalDate(endDate); date = addDays(date, 1)) {
    const day = date.getDay();
    if (day !== 0 && day !== 6) dates.push(formatDate(date));
  }
  return dates;
}

function previousWorkday(dateText) {
  let date = addDays(parseLocalDate(dateText), -1);
  while (date.getDay() === 0 || date.getDay() === 6) date = addDays(date, -1);
  return formatDate(date);
}

function purchaseDateFor(dateText, supplier) {
  const deliveryDays = String(supplier?.deliveryWeekdays || "").split(",").map(Number).filter(value => Number.isInteger(value));
  if (!deliveryDays.length) return previousWorkday(dateText);
  let date = addDays(parseLocalDate(dateText), -1);
  for (let index = 0; index < 14; index += 1) {
    const weekday = (date.getDay() + 6) % 7;
    if (deliveryDays.includes(weekday)) return formatDate(date);
    date = addDays(date, -1);
  }
  return previousWorkday(dateText);
}

function defaultExportDates() {
  let start = addDays(new Date(), 1);
  while (start.getDay() === 0 || start.getDay() === 6) start = addDays(start, 1);
  return [formatDate(start), formatDate(addDays(start, 4))];
}

function parseLocalDate(dateText) {
  const [year, month, day] = String(dateText).split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function excelSerial(dateText) {
  const date = parseLocalDate(dateText);
  return Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

async function writeOfficialWorkbook(type, rows, filename) {
  const template = OFFICIAL_TEMPLATES[type];
  const response = await fetch(`./templates/${template.file}`);
  if (!response.ok) throw new Error(`找不到範本：${template.file}`);
  const zip = await JSZip.loadAsync(await response.arrayBuffer());
  let sheetXml = await zip.file("xl/worksheets/sheet1.xml").async("string");
  let sharedXml = await zip.file("xl/sharedStrings.xml").async("string");
  const shared = appendSharedStrings(sharedXml);
  const styleByCol = extractRowStyles(sheetXml, 2);
  const row1 = sheetXml.match(/<row\b[^>]*\br="1"[\s\S]*?<\/row>/)?.[0] || "";
  const dataRows = rows.map((row, index) => rowXml(index + 2, row, template, styleByCol, shared.add)).join("");
  const lastRow = Math.max(1, rows.length + 1);
  sheetXml = sheetXml.replace(/<dimension ref="[^"]*"/, `<dimension ref="A1:${colName(template.cols)}${lastRow}"`);
  sheetXml = sheetXml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, `<sheetData>${row1}${dataRows}</sheetData>`);
  zip.file("xl/worksheets/sheet1.xml", sheetXml);
  zip.file("xl/sharedStrings.xml", shared.finish());
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const id = newDownloadId();
  const url = URL.createObjectURL(blob);
  const file = { id, blob, filename, url };
  generatedDownloads.set(id, file);
  return file;
}

function appendSharedStrings(sharedXml) {
  let xml = sharedXml;
  const strings = [];
  return {
    add(value) {
      const index = countSharedStrings(xml) + strings.length;
      strings.push(`<si><t>${escapeXml(value)}</t></si>`);
      return index;
    },
    finish() {
      xml = xml.replace("</sst>", `${strings.join("")}</sst>`);
      const total = countSharedStrings(xml);
      xml = xml.replace(/\bcount="[^"]*"/, `count="${total}"`).replace(/\buniqueCount="[^"]*"/, `uniqueCount="${total}"`);
      return xml;
    }
  };
}

function countSharedStrings(sharedXml) {
  return (sharedXml.match(/<si>/g) || []).length;
}

function extractRowStyles(sheetXml, rowNumber) {
  const styles = {};
  const row = sheetXml.match(new RegExp(`<row\\b[^>]*\\br="${rowNumber}"[\\s\\S]*?<\\/row>`))?.[0] || "";
  for (const match of row.matchAll(/<c\b([^>]*)\/?>/g)) {
    const ref = match[1].match(/\br="([A-Z]+)\d+"/)?.[1];
    const style = match[1].match(/\bs="([^"]+)"/)?.[1];
    if (ref && style) styles[ref] = style;
  }
  return styles;
}

function rowXml(rowNumber, row, template, styleByCol, sharedAdd) {
  const cells = [];
  for (let index = 0; index < template.cols; index += 1) {
    const col = index + 1;
    if (!template.required.includes(col)) continue;
    const value = row[index];
    if (value === "" || value === undefined || value === null) continue;
    cells.push(cellXml(colName(col), rowNumber, value, styleByCol[colName(col)], sharedAdd));
  }
  return `<row r="${rowNumber}" spans="1:${template.cols}">${cells.join("")}</row>`;
}

function cellXml(col, rowNumber, value, style, sharedAdd) {
  const styleAttr = style ? ` s="${style}"` : "";
  if (isDateString(value)) return `<c r="${col}${rowNumber}"${styleAttr}><v>${excelSerial(value)}</v></c>`;
  if (typeof value === "number" && Number.isFinite(value)) return `<c r="${col}${rowNumber}"${styleAttr}><v>${value}</v></c>`;
  const sharedIndex = sharedAdd(value);
  return `<c r="${col}${rowNumber}" t="s"${styleAttr}><v>${sharedIndex}</v></c>`;
}

function isDateString(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function colName(number) {
  let name = "";
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(((n - 1) % 26) + 65) + name;
  return name;
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderGeneratedDownloads(files) {
  if (!files.length) return "";
  return html`
    <div class="download-list">
      ${files.map(file => html`
        <div class="download-item">
          <b>${escapeHtml(file.filename)}</b>
          <a class="btn secondary" href="${file.url}" download="${escapeHtml(file.filename)}">單獨下載</a>
          <button type="button" data-share-download="${file.id}">分享／存到檔案</button>
        </div>`).join("")}
    </div>`;
}

function clearGeneratedDownloads() {
  for (const file of generatedDownloads.values()) URL.revokeObjectURL(file.url);
  generatedDownloads.clear();
}

function newDownloadId() {
  return window.crypto?.randomUUID?.() || `download-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isStandaloneApp() {
  return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
}

async function shareGeneratedDownload(id) {
  const item = generatedDownloads.get(id);
  if (!item) return alert("檔案已過期，請重新按一次產生並下載。");
  const file = new File([item.blob], item.filename, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) {
    await navigator.share({ files: [file], title: item.filename }).catch(() => {});
    return;
  }
  saveBlob(item.blob, item.filename);
}

document.addEventListener("submit", handleSubmit);
document.addEventListener("change", async event => {
  if (event.target.id === "branchScope") {
    state.branchId = event.target.value;
    await render();
  }
  if (event.target.id === "importBackup" && event.target.files[0]) {
    if (confirm("匯入會覆蓋這支手機目前資料，確定？")) await importBackup(event.target.files[0]);
    event.target.value = "";
  }
  if (event.target.dataset.officialImport && event.target.files[0]) {
    const resultBox = document.getElementById("officialImportResult");
    try {
      resultBox.innerHTML = `<div class="notice">正在匯入...</div>`;
      const result = await importOfficialWorkbook(event.target.files[0], event.target.dataset.officialImport);
      alert(`匯入完成：新增 ${result.created} 筆，更新 ${result.updated} 筆。${result.errors.length ? "\n" + result.errors.join("\n") : ""}`);
      await render();
    } catch (error) {
      resultBox.innerHTML = `<div class="notice"><b>匯入失敗</b><br>${escapeHtml(error.message || error)}</div>`;
    } finally {
      event.target.value = "";
    }
  }
});
document.addEventListener("click", async event => {
  const nav = event.target.closest("nav button");
  if (nav) {
    state.view = nav.dataset.view;
    await render();
  }
  const viewGo = event.target.closest("[data-view-go]");
  if (viewGo) {
    state.view = viewGo.dataset.viewGo;
    await render();
  }
  const setBranch = event.target.closest("[data-set-branch]");
  if (setBranch) {
    state.branchId = setBranch.dataset.setBranch;
    state.view = "masters";
    await render();
  }
  const masterBatch = event.target.closest("[data-master-batch-mode]");
  if (masterBatch) {
    state.masterBatchMode = masterBatch.dataset.masterBatchMode;
    await render();
  }
  const recipeBatch = event.target.closest("[data-recipe-batch-mode]");
  if (recipeBatch) {
    state.recipeBatchMode = recipeBatch.dataset.recipeBatchMode;
    await render();
  }
  const checkAll = event.target.closest("[data-check-all]");
  if (checkAll) {
    document.querySelectorAll(`input[name="${checkAll.dataset.checkAll}"], input[data-delete-group="${checkAll.dataset.checkAll}"]`).forEach(input => {
      input.checked = true;
    });
  }
  const uncheckAll = event.target.closest("[data-uncheck-all]");
  if (uncheckAll) {
    document.querySelectorAll(`input[name="${uncheckAll.dataset.uncheckAll}"], input[data-delete-group="${uncheckAll.dataset.uncheckAll}"]`).forEach(input => {
      input.checked = false;
    });
  }
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton && confirm(deleteConfirmText(deleteButton.dataset.delete))) {
    const [store, id] = deleteButton.dataset.delete.split(":");
    await deleteRecord(store, id);
    await render();
  }
  const action = event.target.closest("[data-action-click]");
  if (action?.dataset.actionClick === "exportBackup") await exportBackup();
  if (action?.dataset.actionClick === "saveDownloadRepair") {
    const container = action.closest("[data-download-repair]");
    if (!container) return;
    await repairMissingData(container);
    alert("待補資料已儲存，請再按一次產生並下載。");
    await render();
  }
  const lineUpload = event.target.closest("[data-line-upload-text]");
  if (lineUpload) {
    const target = document.getElementById("lineUploadResult");
    if (target) target.innerHTML = lineCopyBox("lineUploadText", lineUpload.dataset.lineUploadText, "把下面這段傳給 LINE 機器人，它就會記錄這段日期已上傳。");
  }
  const shareDownload = event.target.closest("[data-share-download]");
  if (shareDownload) await shareGeneratedDownload(shareDownload.dataset.shareDownload);
  const copy = event.target.closest("[data-copy-target]");
  if (copy) {
    const target = document.getElementById(copy.dataset.copyTarget);
    if (!target) return;
    target.select?.();
    await navigator.clipboard?.writeText(target.value).catch(() => document.execCommand("copy"));
    alert("已複製，可以貼到 LINE 機器人。");
  }
});

async function init() {
  db = await openDb();
  await registerOfflineApp();
  await render();
}

async function registerOfflineApp() {
  if (!("serviceWorker" in navigator)) return;
  await navigator.serviceWorker.register("./sw.js").catch(error => {
    console.warn("Offline app registration failed", error);
  });
}

init().catch(error => {
  console.error(error);
  document.getElementById("app").innerHTML = `<div class="notice">啟動失敗：${escapeHtml(error.message)}</div>`;
});

function deleteConfirmText(target) {
  const [store] = target.split(":");
  if (store === "suppliers") return "確定刪除這個供應商？使用它的食材和調味料會改成待補供應商。";
  if (store === "ingredients") return "確定刪除這個食材？使用它的菜色會移除這項食材。";
  if (store === "seasonings") return "確定刪除這個調味料？使用它的菜色會移除這項調味料。";
  if (store === "recipes") return "確定刪除這道菜色？";
  return "確定刪除？";
}

async function deleteRecord(store, id) {
  const recordId = Number(id);
  if (store === "suppliers") {
    const data = await dataBundle();
    for (const ingredient of data.ingredients.filter(item => Number(item.supplierId) === recordId)) await put("ingredients", { ...ingredient, supplierId: null });
    for (const seasoning of data.seasonings.filter(item => Number(item.supplierId) === recordId)) await put("seasonings", { ...seasoning, supplierId: null });
  }
  if (store === "ingredients") await deleteWhere("recipeIngredients", link => Number(link.ingredientId) === recordId);
  if (store === "seasonings") await deleteWhere("recipeSeasonings", link => Number(link.seasoningId) === recordId);
  if (store === "recipes") {
    await deleteWhere("recipeIngredients", link => Number(link.recipeId) === recordId);
    await deleteWhere("recipeSeasonings", link => Number(link.recipeId) === recordId);
  }
  await del(store, recordId);
}

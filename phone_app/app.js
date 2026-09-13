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
const OFFICIAL_TEMPLATES = {
  menus: { file: "PreMenuExcelExample.xlsx", name: "菜單", cols: 8, required: [1, 2, 3, 4, 6, 8] },
  ingredients: { file: "PrerestaurantingredientExcelExample.xlsx", name: "食材", cols: 22, required: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  seasonings: { file: "seasoningstockdataCollegeExcelExample.xlsx", name: "調味料", cols: 20, required: [1, 2, 3, 4, 5, 8, 9, 10] },
  suppliers: { file: "supplierExcelExample.xlsx", name: "供應商", cols: 5, required: [1, 2, 3, 4, 5] }
};

let db;
let state = { view: "home", branchId: "" };

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
    const request = tx(store, "readwrite").put({ ...value, updatedAt: new Date().toISOString() });
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
  if (!state.branchId) return items.filter(item => !item.branchId);
  return items.filter(item => !item.branchId || String(item.branchId) === String(state.branchId));
}

function availableForBranch(items, branchId) {
  return items.filter(item => !item.branchId || String(item.branchId) === String(branchId));
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
    <h2>初期大量建檔</h2>
    <form class="card" data-action="bulkNames">
      <label>供應商／調味料
        <textarea name="supplySeasoning" placeholder="供應商：喬富&#10;供應商：青葉&#10;調味料：鹽巴,喬富&#10;調味料：醬油,青葉"></textarea>
      </label>
      <label>食材／菜色
        <textarea name="ingredientRecipe" placeholder="食材：油麵,喬富,台灣&#10;食材：蘑菇醬,喬富,台灣&#10;菜色：蘑菇麵,500&#10;菜色：咖哩飯"></textarea>
      </label>
      <button>批量建立名稱</button>
      <p class="muted">先大量建立名稱就好。供應商負責人、統編、電話、地址，食材原產地等資料可以之後再補；下載 Excel 前會提醒缺什麼。</p>
    </form>
    <h2>供應商</h2>
    <form class="card" data-action="addSupplier">
      <label>供應商名稱<input name="name" required></label>
      <label>負責人<input name="owner" required></label>
      <label>統編<input name="taxId" required></label>
      <label>電話<input name="phone" required></label>
      <label>地址<input name="address" required></label>
      <button>新增供應商</button>
    </form>
    <div class="card">${listRows(suppliers, item => `${item.name}<br><small>${item.phone || "待補電話"}／${supplierUsage(data, item.id)} 樣食材</small>`, "suppliers")}</div>
    <h2>食材</h2>
    <form class="card" data-action="addIngredient">
      <label>食材名稱<input name="ingredientName" required></label>
      <label>產品名稱<input name="productName" placeholder="不填就同食材名稱"></label>
      <label>原產地<input name="origin" placeholder="可之後補"></label>
      <label>供應商<select name="supplierId"><option value="">待補</option>${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <button>新增食材</button>
    </form>
    <div class="card">${listRows(ingredients, item => `${item.ingredientName}<br><small>${item.origin || "待補原產地"}／${supplierName(data.suppliers, item.supplierId)}</small>`, "ingredients")}</div>
    <h2>調味料</h2>
    <form class="card" data-action="addSeasoning">
      <label>調味料名稱<input name="name" required></label>
      <label>供應商<select name="supplierId" required>${suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("")}</select></label>
      <button>新增調味料</button>
    </form>
    <div class="card">${listRows(seasonings, item => `${item.name}<br><small>${supplierName(data.suppliers, item.supplierId)}</small>`, "seasonings")}</div>`;
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
    <div class="card">${recipes.length ? recipes.map(recipe => recipeRow(recipe, data)).join("") : `<div class="empty">尚未建立菜色</div>`}</div>`;
}

function renderExports(data) {
  const activeBranch = data.branches.find(branch => String(branch.id) === String(state.branchId));
  const branchId = activeBranch?.id || data.branches[0]?.id || "";
  const recipes = branchId ? availableForBranch(data.recipes, branchId) : [];
  const today = new Date().toISOString().slice(0, 10);
  const nextMonth = addDays(new Date(), 30).toISOString().slice(0, 10);
  return html`
    <h1>下載官方 Excel</h1>
    <div class="notice"><b>這裡只產生 Excel，不連官方網站。</b><br>下載後你再用手機或電腦手動上傳。檔案會各自下載，不會包成 ZIP。</div>
    <form class="card" data-action="downloadOfficial">
      <label>分店
        <select name="branchId" required>
          ${data.branches.map(b => `<option value="${b.id}" ${String(branchId) === String(b.id) ? "selected" : ""}>${escapeHtml(b.name)}</option>`).join("")}
        </select>
      </label>
      <label>開始日期<input name="startDate" type="date" required value="${today}"></label>
      <label>結束日期<input name="endDate" type="date" required value="${nextMonth}"></label>
      <h2>要產生哪些檔案</h2>
      <label class="check"><input type="checkbox" name="fileTypes" value="menus" checked><span>菜單 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="ingredients" checked><span>食材 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="seasonings"><span>調味料 Excel</span></label>
      <label class="check"><input type="checkbox" name="fileTypes" value="suppliers"><span>供應商 Excel</span></label>
      <h2>菜色</h2>
      ${recipes.map(recipe => `<label class="check"><input type="checkbox" name="recipeIds" value="${recipe.id}" checked><span>${escapeHtml(recipe.name)}</span></label>`).join("") || `<p class="muted">這個分店還沒有菜色</p>`}
      <button>產生並下載</button>
      <div id="downloadResult"></div>
    </form>`;
}

function renderBackup(data) {
  return html`
    <h1>備份／還原</h1>
    <div class="notice"><b>建議定期備份。</b><br>這個 Excel 就是手機本機資料的完整備份。存在 iCloud、Google Drive 或 LINE Keep 都可以。</div>
    <div class="card actions">
      <button data-action-click="exportBackup">匯出完整備份 Excel</button>
      <label>匯入備份 Excel<input type="file" id="importBackup" accept=".xlsx"></label>
    </div>
    <div class="grid">
      ${STORES.map(store => `<div class="card"><b>${LABELS[store]}</b><br><small>${data[store].length} 筆</small></div>`).join("")}
    </div>`;
}

function listRows(items, renderItem, store) {
  if (!items.length) return `<div class="empty">尚未建立資料</div>`;
  return items.map(item => `<div class="row"><span>${renderItem(item)}</span><button class="danger" data-delete="${store}:${item.id}">刪除</button></div>`).join("");
}

function recipeRow(recipe, data) {
  const links = data.recipeIngredients.filter(link => Number(link.recipeId) === Number(recipe.id));
  const names = links.map(link => data.ingredients.find(i => Number(i.id) === Number(link.ingredientId))?.ingredientName).filter(Boolean);
  return `<div class="row"><span><b>${escapeHtml(recipe.name)}</b><br><small>${recipe.calories || 0} kcal／${names.join("、") || "尚未綁食材"}</small></span><button class="danger" data-delete="recipes:${recipe.id}">刪除</button></div>`;
}

function supplierName(suppliers, id) {
  return suppliers.find(s => Number(s.id) === Number(id))?.name || "待補供應商";
}

function supplierUsage(data, id) {
  return data.ingredients.filter(item => Number(item.supplierId) === Number(id)).length;
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
    await put("suppliers", { branchId, name: values.name, owner: values.owner, taxId: values.taxId, phone: values.phone, address: values.address });
  }
  if (action === "addIngredient") {
    await put("ingredients", { branchId, ingredientName: values.ingredientName, productName: values.productName || values.ingredientName, origin: values.origin, supplierId: values.supplierId ? Number(values.supplierId) : null });
  }
  if (action === "addSeasoning") {
    if (!values.supplierId) return alert("請先選供應商");
    await put("seasonings", { branchId, name: values.name, supplierId: Number(values.supplierId) });
  }
  if (action === "addRecipe") {
    const recipeId = await put("recipes", { branchId, name: values.name, calories: Number(values.calories || 0) });
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
  form.reset();
  await render();
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
      await put("ingredients", { branchId, ingredientName: name, productName: item.parts[3] || name, origin: item.parts[2] || "", supplierId: supplier?.id ? Number(supplier.id) : null });
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
  XLSX.writeFile(workbook, `食材登錄備份_${new Date().toISOString().slice(0, 10)}.xlsx`);
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
  const startDate = formData.get("startDate");
  const endDate = formData.get("endDate");
  const problems = validateDownload(data, branch, fileTypes, recipeIds, startDate, endDate);
  if (problems.length) {
    result.innerHTML = `<div class="notice"><b>先補完這些資料：</b><ul class="warning-list">${problems.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></div>`;
    return;
  }
  const officialRows = buildOfficialRows(data, branch, recipeIds, startDate, endDate);
  for (const type of fileTypes) {
    await writeOfficialWorkbook(type, officialRows[type], `${branch.name}_${OFFICIAL_TEMPLATES[type].name}_${startDate}_到_${endDate}.xlsx`);
  }
  result.innerHTML = `<div class="notice">已產生 ${fileTypes.length} 個 Excel。若手機瀏覽器擋住多檔下載，請再按一次或改成一次只勾一種檔案。</div>`;
}

function validateDownload(data, branch, fileTypes, recipeIds, startDate, endDate) {
  const problems = [];
  if (!branch) problems.push("請先選擇分店。");
  if (!startDate || !endDate || startDate > endDate) problems.push("日期區間不正確。");
  if (!fileTypes.length) problems.push("請至少勾選一種 Excel。");
  const recipes = availableForBranch(data.recipes, branch?.id).filter(recipe => recipeIds.has(Number(recipe.id)));
  if ((fileTypes.includes("menus") || fileTypes.includes("ingredients")) && !recipes.length) problems.push("請至少選一個菜色。");
  for (const field of ["schoolName", "serviceLocation", "restaurantName"]) {
    if (branch && !branch[field]) problems.push(`分店「${branch.name}」缺少${fieldLabel(field)}。`);
  }
  if (fileTypes.includes("ingredients")) {
    const ingredientIds = usedIngredientIds(data, recipes);
    for (const id of ingredientIds) {
      const ingredient = data.ingredients.find(item => Number(item.id) === Number(id));
      const supplier = data.suppliers.find(item => Number(item.id) === Number(ingredient?.supplierId));
      if (!ingredient?.ingredientName || !ingredient?.productName || !ingredient?.origin) problems.push(`食材「${ingredient?.ingredientName || id}」缺少產品名稱、食材名稱或原產地。`);
      if (!supplier) problems.push(`食材「${ingredient?.ingredientName || id}」缺少供應商。`);
    }
  }
  if (fileTypes.includes("suppliers") || fileTypes.includes("ingredients") || fileTypes.includes("seasonings")) {
    for (const supplier of availableForBranch(data.suppliers, branch?.id)) {
      if (!supplier.name || !supplier.owner || !supplier.taxId || !supplier.phone || !supplier.address) problems.push(`供應商「${supplier.name || "未命名"}」負責人、統編、電話、地址都要填。`);
    }
  }
  return [...new Set(problems)];
}

function fieldLabel(field) {
  return { schoolName: "學校名稱", serviceLocation: "供餐地點", restaurantName: "餐廳名稱" }[field] || field;
}

function buildOfficialRows(data, branch, recipeIds, startDate, endDate) {
  const dates = serviceDates(startDate, endDate);
  const recipes = availableForBranch(data.recipes, branch.id).filter(recipe => recipeIds.has(Number(recipe.id)));
  const seasoningIds = usedSeasoningIds(data, recipes);
  const suppliers = availableForBranch(data.suppliers, branch.id);
  const rows = { menus: [], ingredients: [], seasonings: [], suppliers: [] };
  for (const date of dates) {
    for (const recipe of recipes) {
      rows.menus.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, date, "", recipe.name, "", Number(recipe.calories || 0)]);
      for (const link of data.recipeIngredients.filter(item => Number(item.recipeId) === Number(recipe.id))) {
        const ingredient = data.ingredients.find(item => Number(item.id) === Number(link.ingredientId));
        const supplier = data.suppliers.find(item => Number(item.id) === Number(ingredient?.supplierId));
        rows.ingredients.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, date, previousWorkday(date), ingredient?.productName || "", ingredient?.ingredientName || "", ingredient?.origin || "", supplier?.name || ""]);
      }
    }
  }
  for (const id of seasoningIds) {
    const seasoning = data.seasonings.find(item => Number(item.id) === Number(id));
    const supplier = data.suppliers.find(item => Number(item.id) === Number(seasoning?.supplierId));
    rows.seasonings.push([branch.schoolName, branch.serviceLocation, branch.restaurantName, seasoning?.name || "", previousWorkday(startDate), "", "", startDate, endDate, supplier?.name || ""]);
  }
  for (const supplier of suppliers) rows.suppliers.push([supplier.name, supplier.owner, supplier.taxId, supplier.address, supplier.phone]);
  return rows;
}

function usedIngredientIds(data, recipes) {
  const recipeIds = new Set(recipes.map(recipe => Number(recipe.id)));
  return [...new Set(data.recipeIngredients.filter(item => recipeIds.has(Number(item.recipeId))).map(item => Number(item.ingredientId)))];
}

function usedSeasoningIds(data, recipes) {
  const recipeIds = new Set(recipes.map(recipe => Number(recipe.id)));
  return [...new Set(data.recipeSeasonings.filter(item => recipeIds.has(Number(item.recipeId))).map(item => Number(item.seasoningId)))];
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
  saveBlob(blob, filename);
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
  const deleteButton = event.target.closest("[data-delete]");
  if (deleteButton && confirm("確定刪除？")) {
    const [store, id] = deleteButton.dataset.delete.split(":");
    await del(store, id);
    await render();
  }
  const action = event.target.closest("[data-action-click]");
  if (action?.dataset.actionClick === "exportBackup") await exportBackup();
});

async function init() {
  db = await openDb();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  await render();
}

init().catch(error => {
  console.error(error);
  document.getElementById("app").innerHTML = `<div class="notice">啟動失敗：${escapeHtml(error.message)}</div>`;
});

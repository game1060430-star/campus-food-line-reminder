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

let db;
let state = { view: "home", branchId: "" };

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of STORES) {
        if (!database.objectStoreNames.contains(store)) {
          database.createObjectStore(store, { keyPath: "id", autoIncrement: true });
        }
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

function uid() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function html(strings, ...values) {
  return strings.map((part, index) => `${part}${values[index] ?? ""}`).join("");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
}

function activeBranchName(branches) {
  const branch = branches.find(item => String(item.id) === String(state.branchId));
  return branch ? branch.name : "分店管理／資源共享";
}

function availableForScope(items) {
  if (!state.branchId) return items.filter(item => !item.branchId);
  return items.filter(item => !item.branchId || String(item.branchId) === String(state.branchId));
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
    <h2>供應商</h2>
    <form class="card" data-action="addSupplier">
      <label>供應商名稱<input name="name" required></label>
      <label>負責人<input name="owner"></label>
      <label>統編<input name="taxId"></label>
      <label>電話<input name="phone"></label>
      <label>地址<input name="address"></label>
      <button>新增供應商</button>
    </form>
    <div class="card">${listRows(suppliers, item => `${item.name}<br><small>${item.phone || "待補電話"}</small>`, "suppliers")}</div>
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
  form.reset();
  await render();
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

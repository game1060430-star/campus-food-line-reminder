/* The publishable key has no privileges without an authenticated owner session. */
const FOOD_CLOUD_URL = 'https://ywqpksnynaaoddungmms.supabase.co';
const FOOD_CLOUD_KEY = 'sb_publishable_AuuKLtwZf4I8FkIGTOblCA_8RY_jqMx';
const FOOD_CLOUD_EMAIL = 'game1060430@gmail.com';
const FOOD_SESSION_KEY = 'campus-food-cloud-session-v1';
const FOOD_MODE_KEY = 'campus-food-storage-mode';
let foodLoginNotice = "";
let foodSession = null;
let foodCloudData = null;
let foodCloudRevision = 0;
let foodRefresh = null;
let foodWriteQueue = Promise.resolve();

function cloudActive() { return localStorage.getItem(FOOD_MODE_KEY) === 'cloud'; }
function cloudEmpty() { return Object.fromEntries(STORES.map(store => [store, []])); }
function cloudSessionSave(value) {
  foodSession = value;
  if (value) localStorage.setItem(FOOD_SESSION_KEY, JSON.stringify(value));
  else localStorage.removeItem(FOOD_SESSION_KEY);
}
async function cloudRequest(path, options = {}, authenticated = true) {
  if (authenticated) {
    if (!foodSession) throw new Error('請先登入雲端帳號。');
    if (foodSession.expires_at < Date.now() / 1000 + 60) {
      if (!foodRefresh) foodRefresh = cloudRequest('/auth/v1/token?grant_type=refresh_token', {
        method: 'POST', body: JSON.stringify({refresh_token: foodSession.refresh_token})
      }, false).then(value => cloudSessionSave({...value, expires_at: Date.now() / 1000 + value.expires_in})).finally(() => { foodRefresh = null; });
      await foodRefresh;
    }
  }
  let response;
  try {
    response = await fetch(FOOD_CLOUD_URL + path, {...options, cache: 'no-store', headers: {
      apikey: FOOD_CLOUD_KEY, 'Content-Type': 'application/json',
      ...(authenticated ? {Authorization: 'Bearer ' + foodSession.access_token} : {}), ...options.headers
    }});
  } catch { throw new Error('目前無法連上雲端。這次修改未儲存，請檢查網路後重試。'); }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result?.code || result?.error_code;
    const message = result?.message || result?.msg || result?.error_description || '雲端連線失敗，請重新登入或稍後重試。';
    if (code === 'over_email_send_rate_limit' || /email rate limit/i.test(message)) throw new Error('登入信寄送已達每小時限制，請稍後再試。重複按寄送不會解除限制。');
    if (code === 'otp_expired' || /expired|invalid.*token/i.test(message)) throw new Error('驗證碼已失效或過期，請使用最新一封信的驗證碼。');
    throw new Error(message);
  }
  return result;
}
async function cloudInit() {
  try { foodSession = JSON.parse(localStorage.getItem(FOOD_SESSION_KEY)); } catch { cloudSessionSave(null); }
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('error')) {
    foodLoginNotice = params.get('error_code') === 'otp_expired' ? '登入沒有成功：信中的連結已失效或過期。請重新寄送登入信，並使用最新一封信的連結。' : '登入沒有成功，請重新寄送登入信。';
    history.replaceState(null, '', location.pathname + location.search);
    state.view = 'cloud';
  }
  if (params.has('access_token')) {
    const session = {access_token: params.get('access_token'), refresh_token: params.get('refresh_token'), expires_at: Date.now() / 1000 + Number(params.get('expires_in') || 3600)};
    // Clear the one-time authentication response from browser history immediately.
    history.replaceState(null, '', location.pathname + location.search);
    cloudSessionSave(session);
    const user = await cloudRequest('/auth/v1/user');
    if (user.email?.toLowerCase() !== FOOD_CLOUD_EMAIL) { cloudSessionSave(null); throw new Error('請使用食材系統指定的帳號登入。'); }
    foodSession.user = user;
    cloudSessionSave(foodSession);
    localStorage.setItem(FOOD_MODE_KEY, 'cloud');
  }
  if (cloudActive() && !foodSession) state.view = 'cloud';
}
async function cloudLoad() {
  const rows = await cloudRequest('/rest/v1/food_workspaces?select=data,revision');
  foodCloudData = {...cloudEmpty(), ...(rows[0]?.data || {})};
  foodCloudRevision = Number(rows[0]?.revision || 0);
  return foodCloudData;
}
function cloudMutate(change) {
  const job = foodWriteQueue.then(async () => {
    if (!foodCloudData) await cloudLoad();
    const next = structuredClone(foodCloudData);
    const value = change(next);
    const result = await cloudRequest('/rest/v1/rpc/food_save', {method: 'POST', body: JSON.stringify({p_data: next, p_revision: foodCloudRevision})});
    foodCloudRevision = Number(result.revision);
    foodCloudData = next;
    return value;
  });
  foodWriteQueue = job.catch(() => {});
  return job;
}
function renderCloud() {
  return `<h1>雲端資料</h1><div class="notice">手機和電腦使用同一個帳號登入，就能共用資料。雲端模式需要連線；資料修改後立即儲存。</div>
    ${foodLoginNotice ? `<div class="notice">${escapeHtml(foodLoginNotice)}</div>` : ""}
    <div class="card"><b>目前使用：${cloudActive() ? '雲端資料' : '本機資料'}</b><p>登入狀態：${foodSession ? "已登入" : "尚未登入"}</p><p>登入信箱：${escapeHtml(FOOD_CLOUD_EMAIL)}</p>
    ${foodSession ? `<div class="actions"><button data-cloud-action="use">使用雲端資料／重新載入</button><button class="secondary" data-cloud-action="logout">登出雲端</button></div>` : `<button data-cloud-action="login">寄送登入連結到信箱</button><p id="cloudLoginResult"></p><p>請點最新一封信的連結。每個連結只能使用一次；手機和電腦請分別申請登入信。</p>`}
    <button class="secondary" data-cloud-action="local">使用這台裝置的本機資料</button></div>
    ${foodSession ? `<div class="card"><h2>搬移原有資料</h2><p>請在原本已有食材資料的手機或電腦操作。只有雲端尚未有資料時才能搬移，本機資料會保留。</p><button data-cloud-action="migrate">將這台裝置的本機資料搬到雲端</button><p>搬移完成後，其他裝置登入同一個信箱即可使用。</p></div>` : ''}`;
}
document.addEventListener('click', async event => {
  const action = event.target.closest('[data-cloud-action]')?.dataset.cloudAction;
  if (!action) return;
  const button = event.target.closest('button');
  button.disabled = true;
  try {
    if (action === 'login') {
      const redirect = location.origin + location.pathname;
      await cloudRequest('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirect), {method: 'POST', body: JSON.stringify({email: FOOD_CLOUD_EMAIL, create_user: true})}, false);
      document.getElementById('cloudLoginResult').textContent = '登入連結已寄出。請在這台裝置開啟最新一封信，點信中的連結。';
    }
    if (action === 'use') {
      await cloudLoad(); localStorage.setItem(FOOD_MODE_KEY, 'cloud'); state.branchId = ''; state.view = 'home'; await render();
    }
    if (action === 'local') { localStorage.setItem(FOOD_MODE_KEY, 'local'); state.branchId = ''; state.view = 'home'; await render(); }
    if (action === 'logout') {
      await cloudRequest('/auth/v1/logout?scope=local', {method: 'POST'});
      cloudSessionSave(null); foodCloudData = null; state.view = 'cloud'; await render();
    }
    if (action === 'migrate') {
      await cloudLoad();
      if (STORES.some(store => foodCloudData[store].length)) throw new Error('雲端已有資料，已停止搬移，避免覆蓋。請直接使用雲端資料。');
      const local = Object.fromEntries(await Promise.all(STORES.map(async store => [store, await localAll(store)])));
      if (!STORES.some(store => local[store].length)) throw new Error('這台裝置沒有本機資料。請改在原本有資料的装置操作。');
      if (!confirm('將這台裝置的食材、菜色、供應商和分店資料搬到你的雲端帳號？本機資料仍會保留。')) return;
      await cloudMutate(next => { for (const store of STORES) next[store] = local[store]; });
      localStorage.setItem(FOOD_MODE_KEY, 'cloud'); state.branchId = ''; state.view = 'home'; await render(); alert('資料已搬到雲端。其他裝置登入同一個信箱即可使用。');
    }
  } catch (error) {
    const status = document.getElementById('cloudLoginResult');
    if (status) status.textContent = error.message;
    else alert(error.message);
  }
  finally { button.disabled = false; }
});

let pendingToken = '';
let me = null;

const $auth = id => document.getElementById(id);
function authMsg(text){ $auth('authMsg').textContent = text || ''; }

async function api(action, payload={}){
  const res = await fetch('/api/auth', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    credentials:'same-origin',
    body:JSON.stringify({action, ...payload})
  });
  const data = await res.json().catch(()=>({error:'Bad JSON'}));
  if(!res.ok) throw new Error(data.error || 'Ошибка запроса');
  return data;
}

async function authInit(){
  try{
    const data = await api('me');
    me = data.user;
    showProtected();
  }catch{
    showAuth();
  }
}

function showAuth(){
  $auth('authScreen').classList.remove('hidden');
  $auth('protectedShell').classList.add('hidden');
  $auth('loginBox').classList.remove('hidden');
  $auth('activationBox').classList.add('hidden');
  $auth('firstLoginBox').classList.add('hidden');
  $auth('setup2faBox').classList.add('hidden');
}

function showProtected(){
  $auth('authScreen').classList.add('hidden');
  $auth('protectedShell').classList.remove('hidden');
  $auth('authUserPill').textContent = `${me.name || me.email} · OWNER`;
  $auth('openAuthAdminBtn').classList.toggle('hidden', me.role !== 'owner' && me.role !== 'admin');
  window.currentAuthUser = me;
  window.dispatchEvent(new CustomEvent('oprosy-auth-ready', {detail: me}));
}

async function login(){
  authMsg('');
  try{
    const email = $auth('emailInput').value.trim().toLowerCase();
    const password = $auth('passwordInput').value;
    const totp = $auth('totpInput').value.trim();
    if(password && password.length < 5) throw new Error('Пароль должен быть минимум 5 символов');

    const data = await api('login', {email,password,totp});

    if(data.requireFirstLogin){
      pendingToken = data.tempToken;
      $auth('loginBox').classList.add('hidden');
      $auth('firstLoginBox').classList.remove('hidden');
      $auth('firstNameInput').value = data.name || '';
      authMsg('Смените временный пароль и подтвердите имя.');
      return;
    }

    if(data.require2faSetup){
      pendingToken = data.tempToken;
      show2faSetup(data);
      return;
    }

    me = data.user;
    showProtected();
  }catch(e){ authMsg(e.message); }
}

function showActivation(){
  authMsg('');
  $auth('loginBox').classList.add('hidden');
  $auth('activationBox').classList.remove('hidden');
  $auth('activationEmailInput').value = $auth('emailInput').value.trim();
}

function cancelActivation(){
  authMsg('');
  $auth('activationBox').classList.add('hidden');
  $auth('loginBox').classList.remove('hidden');
}

async function activateAccount(){
  authMsg('');
  try{
    const email = $auth('activationEmailInput').value.trim().toLowerCase();
    const activationCode = $auth('activationCodeInput').value.trim();
    const name = $auth('activationNameInput').value.trim();
    const p1 = $auth('activationPasswordInput').value;
    const p2 = $auth('activationPasswordRepeatInput').value;
    if(!email || !activationCode) throw new Error('Введите email и код активации');
    if(!name) throw new Error('Введите имя');
    if(!p1 || p1.length < 5) throw new Error('Пароль минимум 5 символов');
    if(p1 !== p2) throw new Error('Пароли не совпадают');

    const data = await api('activateAccount', {email, activationCode, name, newPassword:p1});
    if(data.require2faSetup){
      pendingToken = data.tempToken;
      show2faSetup(data);
      return;
    }
    authMsg('Аккаунт активирован. Войдите с новым паролем и вашей 2FA.');
    $auth('activationBox').classList.add('hidden');
    $auth('loginBox').classList.remove('hidden');
    $auth('emailInput').value = email;
  }catch(e){ authMsg(e.message); }
}

async function completeFirstLogin(){
  authMsg('');
  try{
    const name = $auth('firstNameInput').value.trim();
    const p1 = $auth('firstNewPasswordInput').value;
    const p2 = $auth('firstNewPasswordRepeatInput').value;
    if(!name) throw new Error('Введите имя');
    if(!p1 || p1.length < 5) throw new Error('Пароль минимум 5 символов');
    if(p1 !== p2) throw new Error('Пароли не совпадают');
    const data = await api('completeFirstLogin', {tempToken:pendingToken,name,newPassword:p1});
    pendingToken = data.tempToken;
    show2faSetup(data);
  }catch(e){ authMsg(e.message); }
}

function show2faSetup(data){
  $auth('loginBox').classList.add('hidden');
  $auth('activationBox').classList.add('hidden');
  $auth('firstLoginBox').classList.add('hidden');
  $auth('setup2faBox').classList.remove('hidden');
  $auth('totpSecretBox').textContent = data.secret;
  $auth('qrImg').src = data.qrDataUrl;
  authMsg('Это личный QR. Сканируйте его только своим приложением-аутентификатором.');
}

async function enable2fa(){
  authMsg('');
  try{
    const code = $auth('setupTotpCode').value.trim();
    const data = await api('enable2fa', {tempToken:pendingToken, code});
    me = data.user;
    showProtected();
  }catch(e){ authMsg(e.message); }
}

function cancel2fa(){
  pendingToken = '';
  $auth('setupTotpCode').value = '';
  showAuth();
}

async function logout(){
  try{ await api('logout'); }catch(_){}
  location.reload();
}

function toggleAdmin(){
  $auth('authAdminPanel').classList.toggle('hidden');
  $auth('authProfilePanel').classList.add('hidden');
  loadUsers();
}

function toggleProfile(){
  const panel = $auth('authProfilePanel');
  panel.classList.toggle('hidden');
  $auth('authAdminPanel').classList.add('hidden');
  $auth('profileNameInput').value = me.name || '';
  $auth('profileEmailInput').value = me.email || '';
  $auth('profilePasswordInput').value = '';
  $auth('profilePasswordRepeatInput').value = '';
  $auth('profileMsg').textContent = '';
}

async function saveProfile(){
  try{
    const name = $auth('profileNameInput').value.trim();
    const p1 = $auth('profilePasswordInput').value;
    const p2 = $auth('profilePasswordRepeatInput').value;
    if(!name) throw new Error('Введите имя');
    if(p1 || p2){
      if(p1.length < 5) throw new Error('Пароль минимум 5 символов');
      if(p1 !== p2) throw new Error('Пароли не совпадают');
    }
    const data = await api('updateProfile', {name,newPassword:p1 || ''});
    me = data.user;
    window.currentAuthUser = me;
    $auth('authUserPill').textContent = `${me.name || me.email} · OWNER`;
    $auth('profileMsg').textContent = 'Сохранено';
    window.dispatchEvent(new CustomEvent('oprosy-profile-updated', {detail: me}));
  }catch(e){ $auth('profileMsg').textContent = e.message; }
}

function showAdminNotice(title, code, email){
  const box = $auth('adminNotice');
  box.classList.remove('hidden');
  box.innerHTML = `
    <b>${escapeHtml(title)}</b><br>
    <span class="auth-note">${escapeHtml(email)}</span>
    <div class="activation-code">${escapeHtml(code)}</div>
    <div class="auth-note">Код показывается один раз. Передайте его пользователю безопасным способом — пароль пользователь задаст сам.</div>
    <button class="auth-btn auth-ghost" id="copyActivationCodeBtn">Скопировать код</button>
  `;
  document.getElementById('copyActivationCodeBtn').onclick = async () => {
    await navigator.clipboard.writeText(code);
    alert('Код скопирован');
  };
}

async function addUser(){
  try{
    const name = $auth('newUserName').value.trim();
    const email = $auth('newUserEmail').value.trim().toLowerCase();
    if(!name || !email) throw new Error('Введите имя и email');
    const data = await api('createUser', {name,email});
    showAdminNotice('Пользователь создан. Одноразовый код активации:', data.activationCode, email);
    $auth('newUserName').value = '';
    $auth('newUserEmail').value = '';
    await loadUsers();
  }catch(e){ alert(e.message); }
}

async function loadUsers(){
  try{
    const data = await api('listUsers');
    const wrap = $auth('usersList');
    wrap.innerHTML = data.users.map(u=>`
      <div class="local-user-row secure-user-row">
        <div>
          <b>${escapeHtml(u.name || u.email)}</b><br>
          <span class="auth-note">${escapeHtml(u.email)}</span><br>
          <span class="auth-note">ID: <b>${escapeHtml(u.id)}</b> · OWNER · ${u.activated?'активирован':'ждёт активации'} · ${u.twoFactorEnabled?'2FA подключена':'2FA не подключена'}</span>
        </div>
        <button class="auth-btn auth-ghost" data-user-action="reset-access" data-user-email="${escapeHtml(u.email)}">Сброс доступа</button>
        <button class="auth-btn auth-ghost" data-user-action="reset-2fa" data-user-email="${escapeHtml(u.email)}">Сброс 2FA</button>
        <button class="auth-btn auth-danger ${u.isPrimaryOwner?'hidden':''}" data-user-action="delete" data-user-email="${escapeHtml(u.email)}">Удалить</button>
      </div>
    `).join('');
  }catch(e){ alert(e.message); }
}

async function resetUserPassword(email){
  if(!confirm('Сбросить доступ для ' + email + '? Текущий пароль перестанет работать, пользователь задаст новый через одноразовый код.')) return;
  const data = await api('resetPassword', {email});
  showAdminNotice('Доступ сброшен. Новый одноразовый код:', data.activationCode, email);
  await loadUsers();
}

async function resetUser2fa(email){
  if(!confirm('Сбросить 2FA для ' + email + '? При следующем входе пользователь подключит новый QR.')) return;
  await api('reset2fa', {email});
  await loadUsers();
}


async function deleteUser(email){
  if(!confirm('Удалить пользователя ' + email + ' и его статистики?')) return;
  await api('deleteUser', {email});
  await loadUsers();
  window.dispatchEvent(new Event('oprosy-workspace-refresh'));
}

$auth('usersList').addEventListener('click', async (event) => {
  const btn = event.target.closest('[data-user-action][data-user-email]');
  if(!btn) return;
  const action = btn.dataset.userAction;
  const email = btn.dataset.userEmail;
  try{
    if(action === 'reset-access') await resetUserPassword(email);
    if(action === 'reset-2fa') await resetUser2fa(email);
    if(action === 'delete') await deleteUser(email);
  }catch(e){
    alert(e.message);
  }
});

function escapeHtml(str){
  return String(str??'').replace(/[&<>"']/g, s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s]));
}

$auth('loginBtn').onclick = login;
$auth('showActivationBtn').onclick = showActivation;
$auth('cancelActivationBtn').onclick = cancelActivation;
$auth('activateAccountBtn').onclick = activateAccount;
$auth('completeFirstLoginBtn').onclick = completeFirstLogin;
$auth('enable2faBtn').onclick = enable2fa;
$auth('cancel2faBtn').onclick = cancel2fa;
$auth('logoutBtn').onclick = logout;
$auth('openAuthAdminBtn').onclick = toggleAdmin;
$auth('openProfileBtn').onclick = toggleProfile;
$auth('closeProfileBtn').onclick = toggleProfile;
$auth('saveProfileBtn').onclick = saveProfile;
$auth('adminCreateUserBtn').onclick = addUser;

authInit();

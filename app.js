const CFG = window.POSTUREGUARD_CONFIG || {};
const { createClient } = window.supabase;
const supabase = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const CLASS_NAMES = ['leaning_backward','leaning_left','leaning_right','upright'];
const CORRECT_CLASS = 'upright';
const MIN_CONFIDENCE = 0.65;
const SMOOTHING_FRAMES = 8;
const PREDICT_INTERVAL_MS = 600;

const MODEL_NAMES = {
  cnn:'CNN',
  resnet50:'ResNet50',
  densenet121:'DenseNet121',
  efficientnetb0:'EfficientNet-B0'
};

const DISPLAY = {
  leaning_backward:'Ngả về sau',
  leaning_left:'Nghiêng trái',
  leaning_right:'Nghiêng phải',
  upright:'Tư thế đúng',
  unknown:'Chưa xác định'
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

let currentUser = null;
let profile = null;
let systemConfig = null;
let adminToken = sessionStorage.getItem('pg_admin_token') || null;

let model = null;
let activeModelCacheKey = null;
let stream = null;
let cameraRunning = false;
let predictLoopToken = 0;
let history = [];
let badStartAt = null;
let localAlertSent = false;
let sessionId = null;
let currentEpisode = null;
let ratioChart = null;
let postureChart = null;

function msg(el, kind, text) {
  if (!el) return;
  el.hidden = false;
  el.className = `message ${kind}`;
  el.textContent = text;
}

function clearAuthMessage() {
  const el = $('authMessage');
  if (!el) return;
  el.textContent = '';
  el.hidden = true;
}

async function userApi(path, options = {}) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error('Phiên đăng nhập đã hết hạn');

  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: {
      'Content-Type':'application/json',
      Authorization:`Bearer ${session.access_token}`,
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function adminApi(path, options = {}) {
  if (!adminToken) throw new Error('Chưa đăng nhập Super Admin');

  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers: {
      'Content-Type':'application/json',
      Authorization:`Bearer ${adminToken}`,
      ...(options.headers || {})
    }
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    if (res.status === 401) {
      adminToken = null;
      sessionStorage.removeItem('pg_admin_token');
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

function showOnly(screen) {
  const auth = $('authScreen');
  const user = $('userApp');
  const admin = $('adminApp');

  auth.hidden = screen !== 'auth';
  user.hidden = screen !== 'user';
  admin.hidden = screen !== 'admin';

  // ép display để không bị CSS override thuộc tính hidden
  auth.style.display = screen === 'auth' ? '' : 'none';
  user.style.display = screen === 'user' ? '' : 'none';
  admin.style.display = screen === 'admin' ? '' : 'none';

  window.scrollTo(0, 0);
}

function showAuthMode(mode) {
  $('loginForm').hidden = mode !== 'login';
  $('registerForm').hidden = mode !== 'register';
  $('showLogin').classList.toggle('active', mode === 'login');
  $('showRegister').classList.toggle('active', mode === 'register');
  clearAuthMessage();
}

function openUserTab(tab) {
  document.querySelectorAll('[data-user-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.userTab === tab);
  });

  document.querySelectorAll('#userApp .panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const target = $(`user-tab-${tab}`);
  if (target) target.classList.add('active');

  if (tab === 'dashboard') loadDashboard();
  window.scrollTo(0, 0);
}

function openAdminTab(tab) {
  document.querySelectorAll('[data-admin-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.adminTab === tab);
  });

  document.querySelectorAll('#adminApp .panel').forEach(panel => {
    panel.classList.remove('active');
  });

  const target = $(`admin-tab-${tab}`);
  if (target) target.classList.add('active');

  window.scrollTo(0, 0);
}

async function init() {
  if (adminToken) {
    try {
      await loadAdminConsole();
      showOnly('admin');
      openAdminTab('models');
      return;
    } catch {
      adminToken = null;
      sessionStorage.removeItem('pg_admin_token');
    }
  }

  const { data:{ session } } = await supabase.auth.getSession();

  if (session) {
    await enterUserApp(session);
    return;
  }

  showOnly('auth');
  showAuthMode('login');
}

/*
 * Một form login duy nhất:
 * - identity === "admin" => Netlify Super Admin
 * - còn lại => Supabase email/password
 */
async function login() {
  clearAuthMessage();

  const identity = $('loginIdentity').value.trim();
  const password = $('loginPassword').value;

  if (!identity || !password) {
    return msg($('authMessage'), 'error', 'Vui lòng nhập tài khoản và mật khẩu.');
  }

  if (identity.toLowerCase() === 'admin') {
    return loginAdmin(identity, password);
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: identity,
    password
  });

  if (error) return msg($('authMessage'), 'error', error.message);

  const { data:{ session } } = await supabase.auth.getSession();
  if (!session) return msg($('authMessage'), 'error', 'Không tạo được phiên đăng nhập.');

  await enterUserApp(session);
}

async function loginAdmin(username, password) {
  const res = await fetch('/.netlify/functions/admin-login', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({username, password})
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};

  if (!res.ok) {
    return msg($('authMessage'), 'error', data.error || 'Đăng nhập admin thất bại.');
  }

  adminToken = data.token;
  sessionStorage.setItem('pg_admin_token', adminToken);

  // tránh còn Supabase user session song song với admin
  await supabase.auth.signOut();

  await loadAdminConsole();
  showOnly('admin');
  openAdminTab('models');
}

async function register() {
  clearAuthMessage();

  const p1 = $('registerPassword').value;
  const p2 = $('registerPassword2').value;

  if (p1 !== p2) {
    return msg($('authMessage'), 'error', 'Mật khẩu xác nhận không khớp.');
  }

  const { data, error } = await supabase.auth.signUp({
    email:$('registerEmail').value.trim(),
    password:p1
  });

  if (error) return msg($('authMessage'), 'error', error.message);

  if (data.session) {
    await userApi('profile', {
      method:'POST',
      body:JSON.stringify({
        student_name:$('registerStudentName').value.trim(),
        parent_email:$('registerParentEmail').value.trim(),
        local_alert_seconds:10,
        email_enabled:true
      })
    });

    await enterUserApp(data.session);
  } else {
    msg($('authMessage'), 'ok', 'Đăng ký thành công. Hãy xác nhận email rồi đăng nhập.');
    showAuthMode('login');
  }
}

async function logoutUser() {
  if (cameraRunning) await stopCamera();
  await supabase.auth.signOut();
  currentUser = null;
  showOnly('auth');
  showAuthMode('login');
}

function logoutAdmin() {
  adminToken = null;
  sessionStorage.removeItem('pg_admin_token');
  showOnly('auth');
  showAuthMode('login');
}

async function enterUserApp(session) {
  currentUser = session.user;
  $('userBadge').textContent = currentUser.email;

  await Promise.all([
    loadProfile(),
    loadPublicConfig()
  ]);

  // Home hiển thị ngay cả khi chưa upload model.
  $('homeStudentName').textContent =
    profile?.student_name ||
    currentUser.email?.split('@')[0] ||
    'bạn';

  $('homeModelName').textContent =
    MODEL_NAMES[systemConfig?.selected_model] ||
    systemConfig?.selected_model ||
    'Chưa cấu hình';

  $('homeModelVersion').textContent =
    systemConfig?.model_version || '--';

  showOnly('user');
  openUserTab('home');

  // Load model sau khi UI đã chuyển sang Home.
  // Nếu model chưa có, user vẫn dùng được Dashboard/Cài đặt.
  try {
    await loadSelectedModel(true);
  } catch (e) {
    console.error('Model load error:', e);
  }
}

async function loadProfile(){profile=await userApi('profile',{method:'GET'});$('studentName').value=profile.student_name||'';$('parentEmail').value=profile.parent_email||'';$('localAlertSeconds').value=profile.local_alert_seconds||10;$('emailEnabled').checked=profile.email_enabled!==false}
async function saveSettings(){const next={student_name:$('studentName').value.trim(),parent_email:$('parentEmail').value.trim(),local_alert_seconds:Number($('localAlertSeconds').value||10),email_enabled:$('emailEnabled').checked};try{await userApi('profile',{method:'POST',body:JSON.stringify(next)});profile=next;msg($('settingsMessage'),'ok','Đã lưu cài đặt cá nhân.')}catch(e){msg($('settingsMessage'),'error',e.message)}}
async function loadPublicConfig(){systemConfig=await userApi('public-config',{method:'GET'})}
async function loadSelectedModel(force=false){const key=systemConfig?.selected_model||'cnn',version=systemConfig?.model_version||'v1',url=systemConfig?.model_url;if(!url){$('modelBadge').textContent='Chưa có model active';$('modelBadge').className='badge badge-bad';return}const cacheKey=`${key}:${version}:${url}`;if(!force&&model&&activeModelCacheKey===cacheKey)return;$('modelBadge').textContent=`Đang tải ${MODEL_NAMES[key]} ${version}…`;$('modelBadge').className='badge badge-warn';if(model&&model.dispose)model.dispose();model=null;try{const sep=url.includes('?')?'&':'?';model=await tf.loadGraphModel(`${url}${sep}v=${encodeURIComponent(version)}&t=${encodeURIComponent(systemConfig.updated_at||Date.now())}`);activeModelCacheKey=cacheKey;$('modelBadge').textContent=`${MODEL_NAMES[key]} ${version}`;$('modelBadge').className='badge badge-ok';$('activeModelName').textContent=`${MODEL_NAMES[key]} ${version}`}catch(e){console.error(e);$('modelBadge').textContent='Lỗi tải model';$('modelBadge').className='badge badge-bad'}}
function preprocess(source){return tf.tidy(()=>tf.browser.fromPixels(source,3).resizeBilinear([224,224]).toFloat().expandDims(0))}
async function infer(source){if(!model)throw new Error('Model chưa sẵn sàng');const input=preprocess(source);let out;try{out=await model.executeAsync(input);const tensor=Array.isArray(out)?out[0]:out,probs=Array.from(await tensor.data());if(Array.isArray(out))out.forEach(t=>t.dispose());else out.dispose();const idx=probs.indexOf(Math.max(...probs)),confidence=probs[idx]||0,raw=CLASS_NAMES[idx]||'unknown';return{label:confidence>=MIN_CONFIDENCE?raw:'unknown',confidence,probs}}finally{input.dispose()}}
function stableLabel(label){history.push(label);if(history.length>SMOOTHING_FRAMES)history.shift();const valid=history.filter(x=>x!=='unknown');if(!valid.length)return'unknown';const c={};valid.forEach(x=>c[x]=(c[x]||0)+1);return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0]}
async function startCamera(){if(!model)return alert('Model chưa sẵn sàng');stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false});$('video').srcObject=stream;cameraRunning=true;history=[];badStartAt=null;localAlertSent=false;currentEpisode=null;sessionId=crypto.randomUUID();await userApi('session',{method:'POST',body:JSON.stringify({action:'start',session_id:sessionId,model_key:systemConfig.selected_model})});$('startCamera').disabled=true;$('stopCamera').disabled=false;$('emailReportState').textContent='Chưa gửi';const token=++predictLoopToken;predictLoop(token)}
async function stopCamera(){cameraRunning=false;++predictLoopToken;if(currentEpisode)await closeEpisode(Date.now());if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('startCamera').disabled=false;$('stopCamera').disabled=true;if(sessionId){await userApi('session',{method:'POST',body:JSON.stringify({action:'stop',session_id:sessionId})});if(profile?.email_enabled){try{$('emailReportState').textContent='Đang gửi…';await userApi('send-report',{method:'POST',body:JSON.stringify({session_id:sessionId})});$('emailReportState').textContent='Đã gửi'}catch(e){console.error(e);$('emailReportState').textContent='Lỗi gửi'}}}sessionId=null;setState('idle','Đã tắt camera')}
async function predictLoop(token){while(cameraRunning&&token===predictLoopToken){if($('video').readyState>=2){try{const r=await infer($('video'));await handlePosture(stableLabel(r.label),r.confidence)}catch(e){console.error(e)}}await sleep(PREDICT_INTERVAL_MS)}}
async function handlePosture(label,confidence){const now=Date.now();$('confidence').textContent=`${(confidence*100).toFixed(1)}%`;if(!currentEpisode||currentEpisode.label!==label){if(currentEpisode)await closeEpisode(now);currentEpisode={label,startedAt:now,maxConfidence:confidence}}else currentEpisode.maxConfidence=Math.max(currentEpisode.maxConfidence,confidence);if(label===CORRECT_CLASS){badStartAt=null;localAlertSent=false;$('badDuration').textContent='0.0s';$('localAlertState').textContent='Chưa';setState('good','✅ Tư thế đúng');msg($('cameraMessage'),'ok','Bạn đang ngồi đúng tư thế.');return}if(label==='unknown'){badStartAt=null;$('badDuration').textContent='0.0s';setState('unknown','⚠️ Chưa xác định');return}if(!badStartAt){badStartAt=now;localAlertSent=false}const seconds=(now-badStartAt)/1000;$('badDuration').textContent=`${seconds.toFixed(1)}s`;setState('bad',`❌ ${DISPLAY[label]}`);msg($('cameraMessage'),'error',`Phát hiện ${DISPLAY[label].toLowerCase()} trong ${seconds.toFixed(0)} giây.`);if(!localAlertSent&&seconds>=Number(profile.local_alert_seconds||10)){localAlertSent=true;$('localAlertState').textContent='Đã cảnh báo';speak(`Bạn đang ${DISPLAY[label].toLowerCase()}. Hãy điều chỉnh lại tư thế ngồi.`);await userApi('alert-log',{method:'POST',body:JSON.stringify({session_id:sessionId,posture:label,duration_seconds:Math.round(seconds),model_key:systemConfig.selected_model,channel:'audio'})})}}
async function closeEpisode(endedAt){const ep=currentEpisode;currentEpisode=null;if(!ep||!sessionId||ep.label==='unknown')return;await userApi('event',{method:'POST',body:JSON.stringify({session_id:sessionId,posture:ep.label,confidence:ep.maxConfidence,started_at:new Date(ep.startedAt).toISOString(),duration_seconds:Math.max(1,Math.round((endedAt-ep.startedAt)/1000)),model_key:systemConfig.selected_model})})}
function speak(text){if(!('speechSynthesis'in window))return;speechSynthesis.cancel();const u=new SpeechSynthesisUtterance(text);u.lang='vi-VN';speechSynthesis.speak(u)}
function setState(kind,text){$('postureState').textContent=text;$('postureState').className=`state state-${kind}`}
async function loadDashboard(){try{const data=await userApi('dashboard?days=7',{method:'GET'}),monitored=Number(data.monitored_seconds||0),bad=Number(data.bad_seconds||0),correct=monitored>0?Math.max(0,(monitored-bad)/monitored*100):0;$('kpiMonitor').textContent=`${Math.round(monitored/60)} phút`;$('kpiBad').textContent=`${Math.round(bad/60)} phút`;$('kpiCorrect').textContent=monitored?`${correct.toFixed(1)}%`:'--';$('kpiAlerts').textContent=data.alerts?.length||0;renderCharts(monitored,bad,data.bad_by_posture||{});renderAlerts(data.alerts||[])}catch(e){console.error(e)}}
function renderCharts(monitored,bad,byPosture){if(ratioChart)ratioChart.destroy();if(postureChart)postureChart.destroy();ratioChart=new Chart($('ratioChart'),{type:'doughnut',data:{labels:['Ngồi đúng','Ngồi sai'],datasets:[{data:[Math.max(0,monitored-bad),bad],backgroundColor:['#36d399','#ff6b6b']}]},options:{plugins:{legend:{labels:{color:'#dbe5ff'}}}}});const keys=['leaning_left','leaning_right','leaning_backward'];postureChart=new Chart($('postureChart'),{type:'bar',data:{labels:keys.map(k=>DISPLAY[k]),datasets:[{label:'Phút',data:keys.map(k=>(byPosture[k]||0)/60),backgroundColor:'#6ea8fe'}]},options:{scales:{x:{ticks:{color:'#dbe5ff'}},y:{ticks:{color:'#dbe5ff'}}},plugins:{legend:{labels:{color:'#dbe5ff'}}}}})}
function renderAlerts(rows){$('alertRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${new Date(a.sent_at).toLocaleString('vi-VN')}</td><td>${DISPLAY[a.posture]||a.posture}</td><td>${a.duration_seconds}s</td><td>${MODEL_NAMES[a.model_key]||a.model_key||''}</td><td>${a.channel}</td></tr>`).join(''):'<tr><td colspan="5">Chưa có cảnh báo</td></tr>'}
async function loadAdminConsole(){await Promise.all([loadAdminConfig(),loadModelRegistry(),loadEmailStatus()])}
async function loadAdminConfig(){const c=await adminApi('system-config',{method:'GET'});$('globalModel').value=c.selected_model||'cnn';$('globalModelVersion').value=c.model_version||'v1';$('globalModelDisplay').textContent=`${MODEL_NAMES[c.selected_model]||c.selected_model} ${c.model_version||''}`;$('globalModelUrl').textContent=c.model_url||'--'}
async function saveAdminConfig(){try{await adminApi('system-config',{method:'POST',body:JSON.stringify({selected_model:$('globalModel').value,model_version:$('globalModelVersion').value.trim()||'v1'})});msg($('systemMessage'),'ok','Đã activate model/version.');await loadAdminConfig()}catch(e){msg($('systemMessage'),'error',e.message)}}
async function uploadModel(){const key=$('uploadModelKey').value,version=$('uploadModelVersion').value.trim(),jsonFile=$('modelJsonFile').files[0],bins=Array.from($('modelBinFiles').files||[]),activate=$('activateAfterUpload').checked;if(!version)return msg($('uploadModelMessage'),'error','Thiếu version');if(!jsonFile)return msg($('uploadModelMessage'),'error','Thiếu model.json');if(!bins.length)return msg($('uploadModelMessage'),'error','Thiếu file *.bin');const form=new FormData();form.append('model_key',key);form.append('model_version',version);form.append('activate',activate?'true':'false');form.append('model_json',jsonFile);bins.forEach(f=>form.append('weight_files',f));try{msg($('uploadModelMessage'),'info','Đang upload…');const r=await fetch('/.netlify/functions/upload-model',{method:'POST',headers:{Authorization:`Bearer ${adminToken}`},body:form}),t=await r.text(),d=t?JSON.parse(t):{};if(!r.ok)throw new Error(d.error||`HTTP ${r.status}`);msg($('uploadModelMessage'),'ok','Upload thành công.');await loadModelRegistry();if(activate)await loadAdminConfig()}catch(e){msg($('uploadModelMessage'),'error',e.message)}}
async function loadModelRegistry(){const d=await adminApi('model-registry',{method:'GET'}),rows=d.items||[];$('modelRegistryRows').innerHTML=rows.length?rows.map(x=>`<tr><td>${MODEL_NAMES[x.model_key]||x.model_key}</td><td>${x.model_version}</td><td>${new Date(x.uploaded_at).toLocaleString('vi-VN')}</td><td class="mono-cell">${x.model_url}</td></tr>`).join(''):'<tr><td colspan="4">Chưa có model</td></tr>'}
async function loadEmailStatus(){const s=await adminApi('admin-email-status',{method:'GET'});$('systemEmailSender').textContent=s.sender||'Chưa cấu hình';$('systemEmailStatus').textContent=s.configured?'Đã cấu hình':'Chưa cấu hình'}
async function adminTestEmail(){try{msg($('adminEmailMessage'),'info','Đang gửi…');await adminApi('admin-email-status',{method:'POST',body:JSON.stringify({to:$('adminTestRecipient').value.trim()})});msg($('adminEmailMessage'),'ok','Đã gửi email test.')}catch(e){msg($('adminEmailMessage'),'error',e.message)}}


/* ---------- EVENT BINDINGS ---------- */

document.querySelectorAll('[data-user-tab]').forEach(btn => {
  btn.addEventListener('click', () => openUserTab(btn.dataset.userTab));
});

document.querySelectorAll('[data-admin-tab]').forEach(btn => {
  btn.addEventListener('click', () => openAdminTab(btn.dataset.adminTab));
});

document.querySelectorAll('.home-nav').forEach(btn => {
  btn.addEventListener('click', () => openUserTab(btn.dataset.target));
});

$('showLogin').addEventListener('click', () => showAuthMode('login'));
$('showRegister').addEventListener('click', () => showAuthMode('register'));

$('loginBtn').addEventListener('click', login);
$('registerBtn').addEventListener('click', register);

$('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') login();
});

$('logoutBtn').addEventListener('click', logoutUser);
$('adminLogoutBtn').addEventListener('click', logoutAdmin);

$('homeStartCamera').addEventListener('click', () => openUserTab('camera'));
$('homeOpenDashboard').addEventListener('click', () => openUserTab('dashboard'));

$('startCamera').addEventListener('click', startCamera);
$('stopCamera').addEventListener('click', stopCamera);
$('saveSettings').addEventListener('click', saveSettings);
$('refreshDashboard').addEventListener('click', loadDashboard);

$('saveSystemConfig').addEventListener('click', saveAdminConfig);
$('uploadModelBtn').addEventListener('click', uploadModel);
$('adminTestEmailBtn').addEventListener('click', adminTestEmail);

init().catch(err => {
  console.error(err);
  showOnly('auth');
  msg($('authMessage'), 'error', `Khởi tạo ứng dụng lỗi: ${err.message}`);
});

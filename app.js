const CFG = window.POSTUREGUARD_CONFIG || {};
const { createClient } = window.supabase;
const supabase = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const CLASS_NAMES = ['leaning_backward', 'leaning_left', 'leaning_right', 'upright'];
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
  leaning_backward:'Ngả về sau', leaning_left:'Nghiêng trái',
  leaning_right:'Nghiêng phải', upright:'Tư thế đúng', unknown:'Chưa xác định'
};

const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r=>setTimeout(r,ms));

let currentUser=null, accessToken=null, profile=null, systemConfig=null;
let model=null, activeModelKey=null;
let stream=null, cameraRunning=false, predictLoopToken=0;
let history=[], badStartAt=null, localAlertSent=false;
let sessionId=null, currentEpisode=null;
let ratioChart=null, postureChart=null;

function msg(el,kind,text){ el.className=`message ${kind}`; el.textContent=text; }

async function api(path, options={}){
  const session=(await supabase.auth.getSession()).data.session;
  if(!session) throw new Error('Phiên đăng nhập đã hết hạn');
  accessToken=session.access_token;
  const res=await fetch(`/.netlify/functions/${path}`,{
    ...options,
    headers:{'Content-Type':'application/json',Authorization:`Bearer ${accessToken}`,...(options.headers||{})}
  });
  const text=await res.text();
  const data=text?JSON.parse(text):{};
  if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);
  return data;
}

async function initAuth(){
  const {data:{session}}=await supabase.auth.getSession();
  if(session) await enterApp(session); else showAuth();
  supabase.auth.onAuthStateChange(async(_event,s)=>{
    if(s && (!currentUser||currentUser.id!==s.user.id)) await enterApp(s);
    if(!s) showAuth();
  });
}

function showAuth(){ currentUser=null; accessToken=null; $('authScreen').hidden=false; $('appShell').hidden=true; }

async function enterApp(session){
  currentUser=session.user; accessToken=session.access_token;
  $('authScreen').hidden=true; $('appShell').hidden=false;
  $('userBadge').textContent=currentUser.email;
  await Promise.all([loadProfile(),loadSystemConfig()]);
  await loadSelectedModel(true);
}

async function register(){
  const email=$('registerEmail').value.trim(), password=$('registerPassword').value;
  const studentName=$('registerStudentName').value.trim(), parentEmail=$('registerParentEmail').value.trim();
  const {data,error}=await supabase.auth.signUp({email,password});
  if(error) return msg($('authMessage'),'error',error.message);
  if(data.session){
    await api('profile',{method:'POST',body:JSON.stringify({
      student_name:studentName,parent_email:parentEmail,
      local_alert_seconds:10,email_enabled:true,report_schedule:'session_end'
    })});
    msg($('authMessage'),'ok','Đăng ký thành công.');
  }else msg($('authMessage'),'ok','Đăng ký thành công. Hãy kiểm tra email xác nhận rồi đăng nhập.');
}

async function login(){
  const {error}=await supabase.auth.signInWithPassword({
    email:$('loginEmail').value.trim(),password:$('loginPassword').value
  });
  if(error) msg($('authMessage'),'error',error.message);
}

async function logout(){
  if(cameraRunning) await stopCamera();
  await supabase.auth.signOut();
}

async function loadProfile(){
  try{ profile=await api('profile',{method:'GET'}); }
  catch{ profile={student_name:'',parent_email:'',local_alert_seconds:10,email_enabled:true,report_schedule:'session_end'}; }
  $('studentName').value=profile.student_name||'';
  $('parentEmail').value=profile.parent_email||'';
  $('localAlertSeconds').value=profile.local_alert_seconds||10;
  $('emailEnabled').checked=profile.email_enabled!==false;
  $('reportSchedule').value=profile.report_schedule||'session_end';
}

async function saveSettings(){
  const next={
    student_name:$('studentName').value.trim(),
    parent_email:$('parentEmail').value.trim(),
    local_alert_seconds:Number($('localAlertSeconds').value||10),
    email_enabled:$('emailEnabled').checked,
    report_schedule:$('reportSchedule').value
  };
  try{
    await api('profile',{method:'POST',body:JSON.stringify(next)});
    profile=next;
    msg($('settingsMessage'),'ok','Đã lưu cấu hình cá nhân.');
  }catch(e){ msg($('settingsMessage'),'error',e.message); }
}

async function loadSystemConfig(){
  try{ systemConfig=await api('system-config',{method:'GET'}); }
  catch{ systemConfig={selected_model:'cnn',model_version:'v1',model_url:''}; }

  $('globalModel').value=systemConfig.selected_model||'cnn';
  $('globalModelVersion').value=systemConfig.model_version||'v1';
  $('globalModelDisplay').textContent=`${MODEL_NAMES[systemConfig.selected_model]||systemConfig.selected_model} ${systemConfig.model_version||''}`;
  $('globalModelUrl').textContent=systemConfig.model_url||'--';
}

async function saveSystemConfig(){
  try{
    const selected_model=$('globalModel').value;
    const model_version=$('globalModelVersion').value.trim()||'v1';
    const data=await api('system-config',{method:'POST',body:JSON.stringify({selected_model,model_version})});
    systemConfig=data.config;
    $('globalModelDisplay').textContent=`${MODEL_NAMES[selected_model]} ${model_version}`;
    $('globalModelUrl').textContent=systemConfig.model_url||'--';
    msg($('systemMessage'),'ok','Đã activate model/version mới.');
    await loadSelectedModel(true);
  }catch(e){ msg($('systemMessage'),'error',e.message); }
}

async function loadSelectedModel(force=false){
  const key=systemConfig?.selected_model||'cnn';
  const version=systemConfig?.model_version||'v1';
  const url=systemConfig?.model_url;

  if(!url){
    $('modelBadge').textContent='Chưa cấu hình model URL';
    $('modelBadge').className='badge badge-bad';
    return;
  }

  const cacheKey=`${key}:${version}:${url}`;
  if(!force && model && activeModelKey===cacheKey) return;

  $('modelBadge').textContent=`Đang tải ${MODEL_NAMES[key]} ${version}…`;
  $('modelBadge').className='badge badge-warn';

  if(model&&model.dispose) model.dispose();
  model=null;

  try{
    // cache-bust theo version + timestamp cập nhật
    const sep=url.includes('?')?'&':'?';
    const dynamicUrl=`${url}${sep}v=${encodeURIComponent(version)}&t=${encodeURIComponent(systemConfig.updated_at||Date.now())}`;

    model=await tf.loadGraphModel(dynamicUrl);
    activeModelKey=cacheKey;

    $('modelBadge').textContent=`${MODEL_NAMES[key]} ${version} sẵn sàng`;
    $('modelBadge').className='badge badge-ok';
    $('activeModelName').textContent=`${MODEL_NAMES[key]} ${version}`;
  }catch(e){
    console.error(e);
    $('modelBadge').textContent=`Lỗi load ${MODEL_NAMES[key]} ${version}`;
    $('modelBadge').className='badge badge-bad';
    $('activeModelName').textContent=`${MODEL_NAMES[key]} ${version}`;
  }
}

async function uploadModelFiles(){
  const key=$('uploadModelKey').value;
  const version=$('uploadModelVersion').value.trim();
  const jsonFile=$('modelJsonFile').files[0];
  const binFiles=Array.from($('modelBinFiles').files||[]);
  const activate=$('activateAfterUpload').checked;

  if(!version) return msg($('uploadModelMessage'),'error','Hãy nhập version.');
  if(!jsonFile) return msg($('uploadModelMessage'),'error','Thiếu model.json.');
  if(!binFiles.length) return msg($('uploadModelMessage'),'error','Thiếu file weights *.bin.');

  try{
    msg($('uploadModelMessage'),'info','Đang chuẩn bị upload…');

    const form=new FormData();
    form.append('model_key',key);
    form.append('model_version',version);
    form.append('activate',activate?'true':'false');
    form.append('model_json',jsonFile);
    binFiles.forEach(f=>form.append('weight_files',f));

    const session=(await supabase.auth.getSession()).data.session;
    if(!session) throw new Error('Phiên đăng nhập đã hết hạn');

    const res=await fetch('/.netlify/functions/upload-model',{
      method:'POST',
      headers:{Authorization:`Bearer ${session.access_token}`},
      body:form
    });

    const text=await res.text();
    const data=text?JSON.parse(text):{};
    if(!res.ok) throw new Error(data.error||`HTTP ${res.status}`);

    msg($('uploadModelMessage'),'ok',`Upload thành công: ${MODEL_NAMES[key]} ${version}`);

    if(activate){
      systemConfig=data.config;
      $('globalModel').value=systemConfig.selected_model;
      $('globalModelVersion').value=systemConfig.model_version;
      $('globalModelDisplay').textContent=`${MODEL_NAMES[systemConfig.selected_model]} ${systemConfig.model_version}`;
      $('globalModelUrl').textContent=systemConfig.model_url;
      await loadSelectedModel(true);
    }
  }catch(e){
    console.error(e);
    msg($('uploadModelMessage'),'error',e.message);
  }
}

function preprocessFromSource(source){
  return tf.tidy(()=>tf.browser.fromPixels(source,3).resizeBilinear([224,224]).toFloat().expandDims(0));
}

async function infer(source){
  if(!model) throw new Error('Model chưa sẵn sàng');
  const input=preprocessFromSource(source);
  let out;
  try{
    out=await model.executeAsync(input);
    const tensor=Array.isArray(out)?out[0]:out;
    const probs=Array.from(await tensor.data());
    if(Array.isArray(out)) out.forEach(t=>t.dispose()); else out.dispose();
    const idx=probs.indexOf(Math.max(...probs));
    const confidence=probs[idx]||0;
    const rawLabel=CLASS_NAMES[idx]||'unknown';
    return {label:confidence>=MIN_CONFIDENCE?rawLabel:'unknown',confidence,probs};
  } finally { input.dispose(); }
}

function stableLabel(newLabel){
  history.push(newLabel); if(history.length>SMOOTHING_FRAMES) history.shift();
  const valid=history.filter(x=>x!=='unknown'); if(!valid.length) return 'unknown';
  const c={}; valid.forEach(x=>c[x]=(c[x]||0)+1);
  return Object.entries(c).sort((a,b)=>b[1]-a[1])[0][0];
}

async function startCamera(){
  if(!model) return alert('Model chưa sẵn sàng');
  stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false});
  $('video').srcObject=stream;
  cameraRunning=true; history=[]; badStartAt=null; localAlertSent=false; currentEpisode=null;
  sessionId=crypto.randomUUID();
  await api('session',{method:'POST',body:JSON.stringify({action:'start',session_id:sessionId,model_key:systemConfig?.selected_model||'cnn'})});
  $('startCamera').disabled=true; $('stopCamera').disabled=false;
  const token=++predictLoopToken; predictLoop(token);
}

async function stopCamera(){
  cameraRunning=false; ++predictLoopToken;
  if(currentEpisode) await closeEpisode(Date.now());
  if(stream) stream.getTracks().forEach(t=>t.stop());
  stream=null; $('video').srcObject=null;
  $('startCamera').disabled=false; $('stopCamera').disabled=true;
  if(sessionId){
    try{ await api('session',{method:'POST',body:JSON.stringify({action:'stop',session_id:sessionId})}); }catch{}
    if(profile?.email_enabled && profile?.report_schedule==='session_end'){
      try{
        await api('send-report',{method:'POST',body:JSON.stringify({session_id:sessionId})});
        $('emailAlertState').textContent='Đã gửi báo cáo';
      }catch(e){
        $('emailAlertState').textContent='Lỗi báo cáo';
        console.error(e);
      }
    }
  }
  sessionId=null; setState('idle','Đã tắt camera');
}

async function predictLoop(token){
  while(cameraRunning&&token===predictLoopToken){
    if($('video').readyState>=2){
      try{
        const r=await infer($('video'));
        await handlePosture(stableLabel(r.label),r.confidence);
      }catch(e){console.error(e);}
    }
    await sleep(PREDICT_INTERVAL_MS);
  }
}

async function handlePosture(label,confidence){
  const now=Date.now();
  $('confidence').textContent=`${(confidence*100).toFixed(1)}%`;

  if(!currentEpisode||currentEpisode.label!==label){
    if(currentEpisode) await closeEpisode(now);
    currentEpisode={label,startedAt:now,maxConfidence:confidence};
  }else currentEpisode.maxConfidence=Math.max(currentEpisode.maxConfidence,confidence);

  if(label===CORRECT_CLASS){
    badStartAt=null; localAlertSent=false;
    $('badDuration').textContent='0.0s'; $('localAlertState').textContent='Chưa';
    setState('good','✅ Tư thế đúng');
    msg($('cameraMessage'),'ok','Bạn đang ngồi đúng tư thế.');
    return;
  }
  if(label==='unknown'){
    badStartAt=null; $('badDuration').textContent='0.0s';
    setState('unknown','⚠️ Chưa xác định');
    return;
  }

  if(!badStartAt){ badStartAt=now; localAlertSent=false; }
  const seconds=(now-badStartAt)/1000;
  $('badDuration').textContent=`${seconds.toFixed(1)}s`;
  setState('bad',`❌ ${DISPLAY[label]}`);
  msg($('cameraMessage'),'error',`Phát hiện ${DISPLAY[label].toLowerCase()} trong ${seconds.toFixed(0)} giây.`);

  if(!localAlertSent && seconds>=Number(profile.local_alert_seconds||10)){
    localAlertSent=true;
    $('localAlertState').textContent='Đã cảnh báo';
    speak(`Bạn đang ${DISPLAY[label].toLowerCase()}. Hãy điều chỉnh lại tư thế ngồi.`);
    await api('alert-log',{method:'POST',body:JSON.stringify({
      session_id:sessionId,posture:label,duration_seconds:Math.round(seconds),model_key:systemConfig?.selected_model||'cnn',channel:'audio'
    })});
  }
}

async function closeEpisode(endedAt){
  const ep=currentEpisode; currentEpisode=null;
  if(!ep||!sessionId||ep.label==='unknown') return;
  await api('event',{method:'POST',body:JSON.stringify({
    session_id:sessionId,posture:ep.label,confidence:ep.maxConfidence,
    started_at:new Date(ep.startedAt).toISOString(),
    duration_seconds:Math.max(1,Math.round((endedAt-ep.startedAt)/1000)),
    model_key:systemConfig?.selected_model||'cnn'
  })});
}

function speak(text){
  if(!('speechSynthesis'in window)) return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(text); u.lang='vi-VN'; speechSynthesis.speak(u);
}

function setState(kind,text){ $('postureState').textContent=text; $('postureState').className=`state state-${kind}`; }

async function handleUpload(file){
  const img=$('imagePreview'); img.src=URL.createObjectURL(file); img.style.display='block'; await img.decode();
  const r=await infer(img), label=r.label, box=$('uploadResult');
  box.textContent=`${label==='unknown'?DISPLAY.unknown:DISPLAY[label]} · ${(r.confidence*100).toFixed(1)}%`;
  box.className=`state ${label===CORRECT_CLASS?'state-good':label==='unknown'?'state-unknown':'state-bad'}`;
  $('probabilities').innerHTML=r.probs.map((p,i)=>`<div class="prob-row"><span>${DISPLAY[CLASS_NAMES[i]]}</span><div class="bar"><i style="width:${(p*100).toFixed(1)}%"></i></div><strong>${(p*100).toFixed(1)}%</strong></div>`).join('');
}

async function testEmail(){
  try{
    msg($('settingsMessage'),'info','Đang gửi email báo cáo mẫu…');
    await saveSettings();
    await api('send-report',{method:'POST',body:JSON.stringify({is_test:true})});
    msg($('settingsMessage'),'ok','Đã gửi email báo cáo mẫu tới phụ huynh.');
  }catch(e){ msg($('settingsMessage'),'error',e.message); }
}

async function loadDashboard(){
  try{
    const data=await api('dashboard?days=7',{method:'GET'});
    const monitored=Number(data.monitored_seconds||0),bad=Number(data.bad_seconds||0);
    const correct=monitored>0?Math.max(0,(monitored-bad)/monitored*100):0;
    $('kpiMonitor').textContent=`${Math.round(monitored/60)} phút`;
    $('kpiBad').textContent=`${Math.round(bad/60)} phút`;
    $('kpiCorrect').textContent=monitored?`${correct.toFixed(1)}%`:'--';
    $('kpiAlerts').textContent=data.alerts?.length||0;
    renderCharts(monitored,bad,data.bad_by_posture||{});
    renderAlerts(data.alerts||[]);
  }catch(e){console.error(e);}
}

function renderCharts(monitored,bad,byPosture){
  if(ratioChart) ratioChart.destroy(); if(postureChart) postureChart.destroy();
  ratioChart=new Chart($('ratioChart'),{type:'doughnut',data:{labels:['Ngồi đúng','Ngồi sai'],datasets:[{data:[Math.max(0,monitored-bad),bad],backgroundColor:['#36d399','#ff6b6b']}]},options:{plugins:{legend:{labels:{color:'#dbe5ff'}}}}});
  const keys=['leaning_left','leaning_right','leaning_backward'];
  postureChart=new Chart($('postureChart'),{type:'bar',data:{labels:keys.map(k=>DISPLAY[k]),datasets:[{label:'Phút',data:keys.map(k=>(byPosture[k]||0)/60),backgroundColor:'#6ea8fe'}]},options:{scales:{x:{ticks:{color:'#dbe5ff'}},y:{ticks:{color:'#dbe5ff'}}},plugins:{legend:{labels:{color:'#dbe5ff'}}}}});
}

function renderAlerts(rows){
  $('alertRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${new Date(a.sent_at).toLocaleString('vi-VN')}</td><td>${DISPLAY[a.posture]||a.posture}</td><td>${a.duration_seconds}s</td><td>${MODEL_NAMES[a.model_key]||a.model_key||''}</td><td>${a.channel}</td></tr>`).join(''):'<tr><td colspan="5">Chưa có cảnh báo</td></tr>';
}

function setupTabs(){
  document.querySelectorAll('nav .tab').forEach(btn=>btn.addEventListener('click',()=>{
    document.querySelectorAll('nav .tab').forEach(x=>x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
    btn.classList.add('active'); $(`tab-${btn.dataset.tab}`).classList.add('active');
    if(btn.dataset.tab==='dashboard') loadDashboard();
  }));
}

$('showLogin').onclick=()=>{ $('loginForm').hidden=false;$('registerForm').hidden=true;$('showLogin').classList.add('active');$('showRegister').classList.remove('active'); };
$('showRegister').onclick=()=>{ $('loginForm').hidden=true;$('registerForm').hidden=false;$('showRegister').classList.add('active');$('showLogin').classList.remove('active'); };
$('loginBtn').onclick=login; $('registerBtn').onclick=register; $('logoutBtn').onclick=logout;
$('startCamera').onclick=startCamera; $('stopCamera').onclick=stopCamera;
$('imageInput').onchange=e=>e.target.files[0]&&handleUpload(e.target.files[0]);
$('saveSettings').onclick=saveSettings; $('testEmail').onclick=testEmail; $('refreshDashboard').onclick=loadDashboard;
$('saveSystemConfig').onclick=saveSystemConfig;
$('reloadModelNow').onclick=()=>loadSelectedModel(true);
$('uploadModelBtn').onclick=uploadModelFiles;

setupTabs(); initAuth();

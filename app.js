const CFG = window.POSTUREGUARD_CONFIG || {};
const { createClient } = window.supabase;
const supabase = createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

const CLASS_NAMES = ['leaning_backward','leaning_left','leaning_right','upright'];
const APP_VERSION='6.13.0';
const ALERT_SPEECH={leaning_left:'Please sit straight. You are leaning left.',leaning_right:'Please sit straight. You are leaning right.',leaning_backward:'Please sit straight. You are leaning backward.'};
console.log('[PostureGuard] app version', APP_VERSION);
const CORRECT_CLASS = 'upright';
const DEFAULT_MIN_CONFIDENCE = 0.50;
function getConfidenceThreshold(){
  const v = Number(systemConfig?.confidence_threshold);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_MIN_CONFIDENCE;
}
const PROBABILITY_AVG_FRAMES = 10;
const PREDICT_INTERVAL_MS = 250;
const POSE_INTERVAL_MS = 500;
const POSE_MIN_SCORE = 0.30;
const POSE_CORE_MIN_SCORE = 0.35;
const POSE_PADDING = 0.18;
const POSE_BOX_TTL_MS = 2000;
const HYSTERESIS_FRAMES = 3;
const POSE_ASSIST_BOOST = 0.05;
const POSE_LEAN_THRESHOLD = 0.10; // normalized shoulder-vs-hip horizontal offset


const MODEL_NAMES = {
  mobilenetv2:'MobileNetV2',
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
let probabilityHistory = [];
let poseDetector = null;
let personBox = null;
let lastPoseAt = 0;
let lastPoseSuccessAt = 0;
let poseQualityOk = false;
let poseLeanHint = null;
let stablePostureLabel = 'unknown';
let postureCandidateLabel = null;
let postureCandidateCount = 0;
let badStartAt = null;
let lastAlertAt = 0;
let sessionId = null;
let currentEpisode = null;
let ratioChart = null;
let postureChart = null;
let adminTestModel = null;
let adminTestModelCacheKey = null;
let adminTestPreviewUrl = null;

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
async function loadSelectedModel(force=false){const key=systemConfig?.selected_model||'mobilenetv2',version=systemConfig?.model_version||'v1',url=systemConfig?.model_url;if(!url){$('modelBadge').textContent='Chưa có model active';$('modelBadge').className='badge badge-bad';return}const cacheKey=`${key}:${version}:${url}`;if(!force&&model&&activeModelCacheKey===cacheKey)return;$('modelBadge').textContent=`Đang tải ${MODEL_NAMES[key]} ${version}…`;$('modelBadge').className='badge badge-warn';if(model&&model.dispose)model.dispose();model=null;try{const sep=url.includes('?')?'&':'?';model=await tf.loadGraphModel(`${url}${sep}v=${encodeURIComponent(version)}&t=${encodeURIComponent(systemConfig.updated_at||Date.now())}`);activeModelCacheKey=cacheKey;$('modelBadge').textContent=`${MODEL_NAMES[key]} ${version}`;$('modelBadge').className='badge badge-ok';$('activeModelName').textContent=`${MODEL_NAMES[key]} ${version}`}catch(e){console.error(e);$('modelBadge').textContent='Lỗi tải model';$('modelBadge').className='badge badge-bad'}}
function preprocess(source){return tf.tidy(()=>tf.browser.fromPixels(source,3).resizeBilinear([224,224]).toFloat().expandDims(0))}

// Realtime camera pipeline:
// webcam -> MoveNet pose -> person bounding box -> crop -> 224x224 -> posture model
async function ensurePoseDetector(){
  if(poseDetector) return poseDetector;
  if(!window.poseDetection) throw new Error('Không tải được thư viện pose detection.');
  await tf.ready();
  poseDetector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );
  console.log(`[PostureGuard ${APP_VERSION}] MoveNet SinglePose Lightning ready`);
  return poseDetector;
}

function getKeypointMap(keypoints){
  const map={};
  for(const p of keypoints||[]) if(p?.name) map[p.name]=p;
  return map;
}

function evaluatePoseQuality(keypoints){
  const kp=getKeypointMap(keypoints);
  const required=['left_shoulder','right_shoulder','left_hip','right_hip'];
  const core=required.map(name=>kp[name]).filter(Boolean);
  const coreVisible=core.filter(p=>Number(p.score||0)>=POSE_CORE_MIN_SCORE);
  if(coreVisible.length<3) return {ok:false,reason:'core-keypoints-low'};

  // Shoulder span is a useful proxy that the upper body is large enough in frame.
  const ls=kp.left_shoulder, rs=kp.right_shoulder;
  const lh=kp.left_hip, rh=kp.right_hip;
  if(!ls||!rs||!lh||!rh) return {ok:false,reason:'missing-shoulder-hip'};
  const shoulderSpan=Math.hypot(rs.x-ls.x,rs.y-ls.y);
  const torsoLeft=Math.hypot(lh.x-ls.x,lh.y-ls.y);
  const torsoRight=Math.hypot(rh.x-rs.x,rh.y-rs.y);
  const torsoHeight=(torsoLeft+torsoRight)/2;
  if(shoulderSpan<20 || torsoHeight<25) return {ok:false,reason:'person-too-small'};

  return {ok:true,reason:'ok',kp,shoulderSpan,torsoHeight};
}

function estimatePoseLeanHint(quality){
  if(!quality?.ok) return null;
  const {kp,shoulderSpan}=quality;
  const shoulderCx=(kp.left_shoulder.x+kp.right_shoulder.x)/2;
  const hipCx=(kp.left_hip.x+kp.right_hip.x)/2;
  const normalized=(shoulderCx-hipCx)/Math.max(shoulderSpan,1);
  if(normalized<=-POSE_LEAN_THRESHOLD) return 'leaning_left';
  if(normalized>= POSE_LEAN_THRESHOLD) return 'leaning_right';
  return null;
}

function makeSquarePersonBox(points, videoWidth, videoHeight){
  if(!points.length) return null;
  const xs=points.map(p=>p.x);
  const ys=points.map(p=>p.y);
  let x1=Math.min(...xs), x2=Math.max(...xs);
  let y1=Math.min(...ys), y2=Math.max(...ys);
  let width=Math.max(1,x2-x1), height=Math.max(1,y2-y1);
  const padX=width*POSE_PADDING, padY=height*POSE_PADDING;
  x1-=padX; x2+=padX; y1-=padY; y2+=padY;

  // Keep the head + torso centered and use a square crop to avoid body stretching.
  const cx=(x1+x2)/2, cy=(y1+y2)/2;
  const side=Math.min(Math.max(x2-x1,y2-y1), Math.max(videoWidth,videoHeight));
  x1=cx-side/2; y1=cy-side/2; x2=cx+side/2; y2=cy+side/2;

  if(x1<0){x2-=x1;x1=0;}
  if(y1<0){y2-=y1;y1=0;}
  if(x2>videoWidth){x1-=x2-videoWidth;x2=videoWidth;}
  if(y2>videoHeight){y1-=y2-videoHeight;y2=videoHeight;}
  x1=Math.max(0,x1); y1=Math.max(0,y1);
  x2=Math.min(videoWidth,x2); y2=Math.min(videoHeight,y2);
  return {x:x1,y:y1,width:Math.max(1,x2-x1),height:Math.max(1,y2-y1)};
}

async function detectPersonBox(source){
  const detector=await ensurePoseDetector();
  const poses=await detector.estimatePoses(source,{maxPoses:1,flipHorizontal:false});
  const pose=poses?.[0];
  if(!pose?.keypoints?.length) return {box:null,qualityOk:false,leanHint:null};

  const quality=evaluatePoseQuality(pose.keypoints);
  const upperBodyNames=new Set([
    'nose','left_eye','right_eye','left_ear','right_ear',
    'left_shoulder','right_shoulder','left_elbow','right_elbow',
    'left_wrist','right_wrist','left_hip','right_hip'
  ]);
  const points=pose.keypoints.filter(p=>
    upperBodyNames.has(p.name) && Number(p.score||0)>=POSE_MIN_SCORE
  );
  const box=points.length>=4 ? makeSquarePersonBox(points,source.videoWidth,source.videoHeight) : null;
  return {
    box,
    qualityOk:Boolean(quality.ok && box),
    leanHint:estimatePoseLeanHint(quality),
    qualityReason:quality.reason
  };
}

function drawPoseBox(box,status='detected',detail=''){
  const canvas=$('poseOverlay');
  const video=$('video');
  const badge=$('poseStatus');
  if(!canvas||!video||!video.videoWidth||!video.videoHeight) return;
  if(canvas.width!==video.videoWidth) canvas.width=video.videoWidth;
  if(canvas.height!==video.videoHeight) canvas.height=video.videoHeight;
  const ctx=canvas.getContext('2d');
  ctx.clearRect(0,0,canvas.width,canvas.height);

  if(badge){
    const labels={
      detected:'Person detected',
      cached:'Pose temporarily weak · using last box',
      missing:'Person not detected'
    };
    badge.textContent=detail ? `${labels[status]||status} · ${detail}` : (labels[status]||status);
    badge.className=`pose-status ${status}`;
  }

  if(!box) return;
  const isCached=status==='cached';
  ctx.lineWidth=Math.max(5,canvas.width/190);
  ctx.strokeStyle=isCached ? '#f6c453' : '#00ff88';
  ctx.fillStyle=isCached ? 'rgba(246,196,83,.08)' : 'rgba(0,255,136,.08)';
  ctx.strokeRect(box.x,box.y,box.width,box.height);
  ctx.fillRect(box.x,box.y,box.width,box.height);
}

function preprocessCameraFrame(source,box){
  return tf.tidy(()=>{
    const pixels=tf.browser.fromPixels(source,3);
    if(!box) return pixels.resizeBilinear([224,224]).toFloat().expandDims(0);
    const [h,w]=pixels.shape;
    const x=Math.max(0,Math.min(w-1,Math.floor(box.x)));
    const y=Math.max(0,Math.min(h-1,Math.floor(box.y)));
    const bw=Math.max(1,Math.min(w-x,Math.floor(box.width)));
    const bh=Math.max(1,Math.min(h-y,Math.floor(box.height)));
    return pixels.slice([y,x,0],[bh,bw,3]).resizeBilinear([224,224]).toFloat().expandDims(0);
  });
}

async function inferCamera(source,box){
  if(!model)throw new Error('Model chưa sẵn sàng');
  const input=preprocessCameraFrame(source,box);
  let out;
  try{
    out=await model.executeAsync(input);
    const tensor=Array.isArray(out)?out[0]:out;
    const probs=Array.from(await tensor.data());
    if(Array.isArray(out))out.forEach(t=>t.dispose());else out.dispose();
    return probs;
  }finally{
    input.dispose();
  }
}

function weightedAverageProbabilities(probs, leanHint=null){
  probabilityHistory.push(probs.map(Number));
  if(probabilityHistory.length>PROBABILITY_AVG_FRAMES) probabilityHistory.shift();

  // Newer frames receive larger weights (1..N) so the result is stable but responsive.
  const avg=new Array(CLASS_NAMES.length).fill(0);
  let totalWeight=0;
  probabilityHistory.forEach((frame,idx)=>{
    const weight=idx+1;
    totalWeight+=weight;
    for(let i=0;i<avg.length;i++) avg[i]+=Number(frame[i]||0)*weight;
  });
  for(let i=0;i<avg.length;i++) avg[i]/=Math.max(totalWeight,1);

  // Pose is only a weak supporting signal, never the primary classifier.
  if(leanHint==='leaning_left' || leanHint==='leaning_right'){
    const idx=CLASS_NAMES.indexOf(leanHint);
    if(idx>=0){
      avg[idx]+=POSE_ASSIST_BOOST;
      const sum=avg.reduce((a,b)=>a+b,0);
      for(let i=0;i<avg.length;i++) avg[i]/=Math.max(sum,1e-8);
    }
  }

  const confidence=Math.max(...avg);
  const idx=avg.indexOf(confidence);
  const raw=CLASS_NAMES[idx]||'unknown';
  return {
    rawLabel: confidence>=getConfidenceThreshold()?raw:'unknown',
    confidence,
    probs:avg,
    frames:probabilityHistory.length
  };
}

function applyPostureHysteresis(candidate){
  if(candidate===stablePostureLabel){
    postureCandidateLabel=null;
    postureCandidateCount=0;
    return stablePostureLabel;
  }
  if(candidate===postureCandidateLabel) postureCandidateCount+=1;
  else{
    postureCandidateLabel=candidate;
    postureCandidateCount=1;
  }
  if(postureCandidateCount>=HYSTERESIS_FRAMES){
    stablePostureLabel=candidate;
    postureCandidateLabel=null;
    postureCandidateCount=0;
  }
  return stablePostureLabel;
}

async function startCamera(){if(!model)return alert('Model chưa sẵn sàng');try{msg($('cameraMessage'),'info','Đang khởi tạo MoveNet pose detection…');await ensurePoseDetector();stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:960},height:{ideal:720}},audio:false});$('video').srcObject=stream;cameraRunning=true;probabilityHistory=[];personBox=null;lastPoseAt=0;lastPoseSuccessAt=0;poseQualityOk=false;poseLeanHint=null;stablePostureLabel='unknown';postureCandidateLabel=null;postureCandidateCount=0;badStartAt=null;lastAlertAt=0;currentEpisode=null;sessionId=crypto.randomUUID();await userApi('session',{method:'POST',body:JSON.stringify({action:'start',session_id:sessionId,model_key:systemConfig.selected_model})});$('startCamera').disabled=true;$('stopCamera').disabled=false;$('emailReportState').textContent='Chưa gửi';msg($('cameraMessage'),'info','Camera đã bật. MoveNet đang tự định vị người.');const token=++predictLoopToken;predictLoop(token)}catch(e){console.error(e);msg($('cameraMessage'),'error',`Không thể bật camera/pose detection: ${e.message}`)}}
async function stopCamera(){cameraRunning=false;++predictLoopToken;probabilityHistory=[];personBox=null;lastPoseAt=0;lastPoseSuccessAt=0;poseQualityOk=false;poseLeanHint=null;stablePostureLabel='unknown';postureCandidateLabel=null;postureCandidateCount=0;drawPoseBox(null);if(currentEpisode)await closeEpisode(Date.now());if(stream)stream.getTracks().forEach(t=>t.stop());stream=null;$('video').srcObject=null;$('startCamera').disabled=false;$('stopCamera').disabled=true;if(sessionId){await userApi('session',{method:'POST',body:JSON.stringify({action:'stop',session_id:sessionId})});if(profile?.email_enabled){try{$('emailReportState').textContent='Đang gửi…';await userApi('send-report',{method:'POST',body:JSON.stringify({session_id:sessionId})});$('emailReportState').textContent='Đã gửi'}catch(e){console.error(e);$('emailReportState').textContent='Lỗi gửi'}}}sessionId=null;setState('idle','Đã tắt camera')}
async function predictLoop(token){while(cameraRunning&&token===predictLoopToken){const video=$('video');if(video.readyState>=2){try{const now=Date.now();if(now-lastPoseAt>=POSE_INTERVAL_MS){lastPoseAt=now;const detected=await detectPersonBox(video);if(detected.box){personBox=detected.box;lastPoseSuccessAt=now;poseQualityOk=detected.qualityOk;poseLeanHint=detected.leanHint;drawPoseBox(personBox,'detected',detected.qualityOk?'good pose':'low pose quality')}else if(personBox && now-lastPoseSuccessAt<=POSE_BOX_TTL_MS){poseQualityOk=false;poseLeanHint=null;drawPoseBox(personBox,'cached')}else{personBox=null;poseQualityOk=false;poseLeanHint=null;drawPoseBox(null,'missing')}}const rawProbs=await inferCamera(video,personBox);const r=weightedAverageProbabilities(rawProbs,poseLeanHint);const qualityAllowsPrediction=poseQualityOk || (personBox && now-lastPoseSuccessAt<=POSE_BOX_TTL_MS);const candidate=qualityAllowsPrediction?r.rawLabel:'unknown';const finalLabel=applyPostureHysteresis(candidate);await handlePosture(finalLabel,r.confidence)}catch(e){console.error('[realtime pipeline]',e)}}await sleep(PREDICT_INTERVAL_MS)}}
async function handlePosture(label,confidence){const now=Date.now();$('confidence').textContent=`${(confidence*100).toFixed(1)}%`;if(!currentEpisode||currentEpisode.label!==label){if(currentEpisode)await closeEpisode(now);currentEpisode={label,startedAt:now,maxConfidence:confidence}}else currentEpisode.maxConfidence=Math.max(currentEpisode.maxConfidence,confidence);if(label===CORRECT_CLASS){badStartAt=null;lastAlertAt=0;$('badDuration').textContent='0.0s';$('localAlertState').textContent='Chưa';setState('good','✅ Tư thế đúng');msg($('cameraMessage'),'ok','Bạn đang ngồi đúng tư thế.');return}if(label==='unknown'){setState('unknown','⚠️ Chưa xác định');return}if(!badStartAt){badStartAt=now;lastAlertAt=0}const seconds=(now-badStartAt)/1000;$('badDuration').textContent=`${seconds.toFixed(1)}s`;setState('bad',`❌ ${DISPLAY[label]}`);msg($('cameraMessage'),'error',`Phát hiện ${DISPLAY[label].toLowerCase()} trong ${seconds.toFixed(0)} giây.`);const alertSeconds=Math.max(1,Number(profile.local_alert_seconds||10));const alertMs=alertSeconds*1000;if(seconds>=alertSeconds&&(lastAlertAt===0||now-lastAlertAt>=alertMs)){lastAlertAt=now;$('localAlertState').textContent=`Đã cảnh báo • lặp mỗi ${alertSeconds}s`;try{await speak(ALERT_SPEECH[label] || 'Please sit straight and correct your posture.')}catch(e){console.error('Không phát được cảnh báo âm thanh:',e)}try{await userApi('alert-log',{method:'POST',body:JSON.stringify({session_id:sessionId,posture:label,duration_seconds:Math.round(seconds),model_key:systemConfig.selected_model,channel:'audio'})})}catch(e){console.error('Không ghi được alert-log:',e)}}}
async function closeEpisode(endedAt){const ep=currentEpisode;currentEpisode=null;if(!ep||!sessionId||ep.label==='unknown')return;await userApi('event',{method:'POST',body:JSON.stringify({session_id:sessionId,posture:ep.label,confidence:ep.maxConfidence,started_at:new Date(ep.startedAt).toISOString(),duration_seconds:Math.max(1,Math.round((endedAt-ep.startedAt)/1000)),model_key:systemConfig.selected_model})})}
function getEnglishVoice(){
  const voices=window.speechSynthesis?.getVoices?.() || [];
  return voices.find(v=>/^en-US$/i.test(v.lang))
      || voices.find(v=>/^en-GB$/i.test(v.lang))
      || voices.find(v=>/^en/i.test(v.lang))
      || null;
}

function speak(text){
  return new Promise((resolve,reject)=>{
    if(!('speechSynthesis' in window)){
      reject(new Error('Speech synthesis is not supported by this browser.'));
      return;
    }
    try{
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang='en-US';
      const englishVoice=getEnglishVoice();
      if(englishVoice) u.voice=englishVoice;
      u.volume=1;
      u.rate=1;
      u.pitch=1;
      u.onstart=()=>console.log(`[PostureGuard ${APP_VERSION}] Speech started:`,text,'voice=',u.voice?.name,u.voice?.lang);
      u.onend=()=>resolve();
      u.onerror=(e)=>reject(new Error(`Speech error: ${e.error || 'unknown'}`));
      speechSynthesis.speak(u);
    }catch(e){reject(e)}
  });
}

async function testSound(){
  const btn=$('testSoundBtn');
  if(btn)btn.disabled=true;
  try{
    msg($('settingsMessage'),'info','Đang phát âm thanh thử…');
    await speak('PostureGuard AI is ready to alert your posture.');
    msg($('settingsMessage'),'ok','Âm thanh hoạt động bình thường.');
  }catch(e){
    console.error('TEST SOUND ERROR:',e);
    msg($('settingsMessage'),'error',`Không phát được âm thanh: ${e.message}`);
  }finally{
    if(btn)btn.disabled=false;
  }
}
function setState(kind,text){$('postureState').textContent=text;$('postureState').className=`state state-${kind}`}
async function loadDashboard(){try{const data=await userApi('dashboard?days=7',{method:'GET'}),monitored=Number(data.monitored_seconds||0),bad=Number(data.bad_seconds||0),correct=monitored>0?Math.max(0,(monitored-bad)/monitored*100):0;$('kpiMonitor').textContent=`${Math.round(monitored/60)} phút`;$('kpiBad').textContent=`${Math.round(bad/60)} phút`;$('kpiCorrect').textContent=monitored?`${correct.toFixed(1)}%`:'--';$('kpiAlerts').textContent=data.alerts?.length||0;renderCharts(monitored,bad,data.bad_by_posture||{});renderAlerts(data.alerts||[])}catch(e){console.error(e)}}
function renderCharts(monitored,bad,byPosture){if(ratioChart)ratioChart.destroy();if(postureChart)postureChart.destroy();ratioChart=new Chart($('ratioChart'),{type:'doughnut',data:{labels:['Ngồi đúng','Ngồi sai'],datasets:[{data:[Math.max(0,monitored-bad),bad],backgroundColor:['#36d399','#ff6b6b']}]},options:{plugins:{legend:{labels:{color:'#dbe5ff'}}}}});const keys=['leaning_left','leaning_right','leaning_backward'];postureChart=new Chart($('postureChart'),{type:'bar',data:{labels:keys.map(k=>DISPLAY[k]),datasets:[{label:'Phút',data:keys.map(k=>(byPosture[k]||0)/60),backgroundColor:'#6ea8fe'}]},options:{scales:{x:{ticks:{color:'#dbe5ff'}},y:{ticks:{color:'#dbe5ff'}}},plugins:{legend:{labels:{color:'#dbe5ff'}}}}})}
function renderAlerts(rows){$('alertRows').innerHTML=rows.length?rows.map(a=>`<tr><td>${new Date(a.sent_at).toLocaleString('vi-VN')}</td><td>${DISPLAY[a.posture]||a.posture}</td><td>${a.duration_seconds}s</td><td>${MODEL_NAMES[a.model_key]||a.model_key||''}</td><td>${a.channel}</td></tr>`).join(''):'<tr><td colspan="5">Chưa có cảnh báo</td></tr>'}
async function loadAdminConsole(){
  await Promise.all([loadAdminConfig(),loadModelRegistry(),loadEmailStatus()]);
  updateAdminTfjsInfo();
}

function updateAdminTfjsInfo(){
  const version=window.tf?.version?.tfjs||'--';
  let backend='--';
  try{backend=window.tf?.getBackend?.()||'--'}catch{}
  if($('adminTfjsInfo'))$('adminTfjsInfo').textContent=`${version} / ${backend}`;
}

function disposeTensorOutput(out){
  if(!out)return;
  if(Array.isArray(out)){out.forEach(t=>t?.dispose?.());return;}
  if(typeof out.dispose==='function'){out.dispose();return;}
  if(typeof out==='object')Object.values(out).forEach(t=>t?.dispose?.());
}

function firstTensorFromOutput(out){
  if(!out)return null;
  if(Array.isArray(out))return out[0]||null;
  if(typeof out.data==='function')return out;
  if(typeof out==='object')return Object.values(out).find(v=>v&&typeof v.data==='function')||null;
  return null;
}

async function loadAdminTestModel(force=false){
  const c=await adminApi('system-config',{method:'GET'});
  const key=c.selected_model||'mobilenetv2';
  const version=c.model_version||'v1';
  const url=c.model_url;
  if(!url)throw new Error('Chưa có model active. Hãy upload và activate model trước.');
  const cacheKey=`${key}:${version}:${url}`;
  if(!force&&adminTestModel&&adminTestModelCacheKey===cacheKey){
    $('adminTestModelName').textContent=`${MODEL_NAMES[key]||key} ${version}`;
    return adminTestModel;
  }
  msg($('adminImageTestMessage'),'info',`Đang tải ${MODEL_NAMES[key]||key} ${version}…`);
  if(adminTestModel?.dispose)adminTestModel.dispose();
  adminTestModel=null;
  const sep=url.includes('?')?'&':'?';
  adminTestModel=await tf.loadGraphModel(`${url}${sep}v=${encodeURIComponent(version)}&t=${Date.now()}`);
  adminTestModelCacheKey=cacheKey;
  $('adminTestModelName').textContent=`${MODEL_NAMES[key]||key} ${version}`;
  updateAdminTfjsInfo();
  msg($('adminImageTestMessage'),'ok',`Đã tải model ${MODEL_NAMES[key]||key} ${version}.`);
  return adminTestModel;
}

function previewAdminTestImage(){
  const file=$('adminTestImageFile').files?.[0];
  if(adminTestPreviewUrl){URL.revokeObjectURL(adminTestPreviewUrl);adminTestPreviewUrl=null;}
  $('adminTestPrediction').textContent='--';
  $('adminTestConfidence').textContent='--';
  $('adminTestProbabilities').innerHTML='<div class="hint">Chưa có kết quả.</div>';
  if(!file){
    $('adminTestPreview').hidden=true;
    $('adminTestPreview').removeAttribute('src');
    $('adminTestPreviewEmpty').hidden=false;
    return;
  }
  if(!file.type.startsWith('image/')){
    msg($('adminImageTestMessage'),'error','Vui lòng chọn file hình ảnh.');
    return;
  }
  adminTestPreviewUrl=URL.createObjectURL(file);
  $('adminTestPreview').src=adminTestPreviewUrl;
  $('adminTestPreview').hidden=false;
  $('adminTestPreviewEmpty').hidden=true;
  msg($('adminImageTestMessage'),'info',`Đã chọn ${file.name}. Bấm “Detect tư thế” để chạy model.`);
}

async function ensureImageLoaded(img){
  if(img.complete&&img.naturalWidth>0)return;
  await new Promise((resolve,reject)=>{
    img.addEventListener('load',resolve,{once:true});
    img.addEventListener('error',()=>reject(new Error('Không đọc được ảnh đã chọn.')),{once:true});
  });
}

async function runAdminImageTest(){
  const file=$('adminTestImageFile').files?.[0];
  if(!file)return msg($('adminImageTestMessage'),'error','Hãy chọn một ảnh trước.');
  const btn=$('adminRunImageTestBtn');
  btn.disabled=true;
  try{
    msg($('adminImageTestMessage'),'info','Đang tải model và phân tích ảnh…');
    const testModel=await loadAdminTestModel(false);
    const img=$('adminTestPreview');
    await ensureImageLoaded(img);
    const input=preprocess(img);
    let out=null;
    try{
      out=await testModel.executeAsync(input);
      const tensor=firstTensorFromOutput(out);
      if(!tensor)throw new Error('Model không trả về tensor kết quả.');
      const probs=Array.from(await tensor.data());
      if(probs.length<CLASS_NAMES.length)throw new Error(`Output model chỉ có ${probs.length} giá trị, kỳ vọng ${CLASS_NAMES.length}.`);
      const max=Math.max(...probs);
      const idx=probs.indexOf(max);
      const raw=CLASS_NAMES[idx]||'unknown';
      const threshold=getConfidenceThreshold();
      const shown=max>=threshold?raw:'unknown';
      $('adminTestPrediction').textContent=DISPLAY[shown]||shown;
      $('adminTestConfidence').textContent=`${(max*100).toFixed(2)}%`;
      $('adminTestProbabilities').innerHTML=CLASS_NAMES.map((name,i)=>{
        const p=Number(probs[i]||0)*100;
        return `<div class="prob-row"><div class="prob-label"><span>${DISPLAY[name]||name}</span><strong>${p.toFixed(2)}%</strong></div><div class="prob-track"><div class="prob-fill" style="width:${Math.max(0,Math.min(100,p))}%"></div></div></div>`;
      }).join('');
      msg($('adminImageTestMessage'),shown==='unknown'?'info':'ok',shown==='unknown'?`Độ tin cậy cao nhất ${max.toFixed(3)} thấp hơn ngưỡng ${threshold.toFixed(2)}.`:`Detect thành công: ${DISPLAY[raw]||raw} (${(max*100).toFixed(2)}%).`);
    }finally{
      input.dispose();
      disposeTensorOutput(out);
    }
  }catch(e){
    console.error('ADMIN IMAGE TEST ERROR:',e);
    msg($('adminImageTestMessage'),'error',`Test model thất bại: ${e?.message||String(e)}`);
  }finally{
    btn.disabled=false;
  }
}

async function loadAdminConfig(){const c=await adminApi('system-config',{method:'GET'});$('globalModel').value=c.selected_model||'mobilenetv2';$('globalModelVersion').value=c.model_version||'v1';if($('globalConfidenceThreshold'))$('globalConfidenceThreshold').value=Number(c.confidence_threshold??DEFAULT_MIN_CONFIDENCE).toFixed(2);$('globalModelDisplay').textContent=`${MODEL_NAMES[c.selected_model]||c.selected_model} ${c.model_version||''}`;$('globalModelUrl').textContent=c.model_url||'--'}
async function saveAdminConfig(){try{const threshold=Number($('globalConfidenceThreshold')?.value??DEFAULT_MIN_CONFIDENCE);if(!Number.isFinite(threshold)||threshold<=0||threshold>1)throw new Error('Ngưỡng confidence phải lớn hơn 0 và không vượt quá 1.');await adminApi('system-config',{method:'POST',body:JSON.stringify({selected_model:$('globalModel').value,model_version:$('globalModelVersion').value.trim()||'v1',confidence_threshold:threshold})});msg($('systemMessage'),'ok',`Đã lưu cấu hình. Confidence threshold = ${threshold.toFixed(2)}.`);await loadAdminConfig()}catch(e){msg($('systemMessage'),'error',e.message)}}
async function readApiResponse(response) {
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  return { raw, data };
}

function apiErrorText(prefix, response, raw, data) {
  const parts = [`${prefix} - HTTP ${response.status}`];
  if (data?.stage) parts.push(`Stage: ${data.stage}`);
  if (data?.request_id) parts.push(`Request ID: ${data.request_id}`);
  if (data?.error) parts.push(String(data.error));
  if (data?.detail && data.detail !== data.error) parts.push(String(data.detail));
  if (!data && raw) parts.push(raw.slice(0, 1500));
  if (!data && !raw) {
    parts.push('Netlify trả response rỗng. Request có thể bị chặn trước khi Function chạy (thường do giới hạn request body/proxy).');
  }
  return parts.join('\n');
}

async function uploadModel(){
  const key=$('uploadModelKey').value;
  const version=$('uploadModelVersion').value.trim();
  const jsonFile=$('modelJsonFile').files[0];
  const bins=Array.from($('modelBinFiles').files||[]);
  const activate=$('activateAfterUpload').checked;

  if(!version)return msg($('uploadModelMessage'),'error','Thiếu version');
  if(!jsonFile)return msg($('uploadModelMessage'),'error','Thiếu model.json');
  if(jsonFile.name!=='model.json')return msg($('uploadModelMessage'),'error','File JSON phải có tên model.json');
  if(!bins.length)return msg($('uploadModelMessage'),'error','Thiếu file *.bin');
  if(bins.some(f=>!f.name.endsWith('.bin')))return msg($('uploadModelMessage'),'error','Weights chỉ được chọn file *.bin');

  const allFiles=[jsonFile,...bins];
  const totalMb=allFiles.reduce((n,f)=>n+f.size,0)/1024/1024;

  try{
    msg($('uploadModelMessage'),'info',`Chuẩn bị upload ${allFiles.length} file (${totalMb.toFixed(2)} MB)…`);

    // Bước 1: chỉ gửi metadata nhỏ qua Netlify Function để lấy signed upload token.
    const prepareResponse=await fetch('/.netlify/functions/prepare-model-upload',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${adminToken}`
      },
      body:JSON.stringify({
        model_key:key,
        model_version:version,
        files:allFiles.map(f=>({name:f.name,size:f.size,type:f.type||''}))
      })
    });
    const prepared=await readApiResponse(prepareResponse);
    console.log('prepare-model-upload:', prepareResponse.status, prepared.raw);
    if(!prepareResponse.ok){
      throw new Error(apiErrorText('Không chuẩn bị được upload',prepareResponse,prepared.raw,prepared.data));
    }

    const bucket=prepared.data?.bucket;
    const uploadItems=prepared.data?.uploads||[];
    if(!bucket||uploadItems.length!==allFiles.length){
      throw new Error('Prepare upload trả dữ liệu không đầy đủ.');
    }

    // Bước 2: upload từng file trực tiếp Browser -> Supabase Storage.
    // Model ~9MB không còn đi xuyên qua Netlify Function nên tránh giới hạn request body.
    const uploaded=[];
    for(let i=0;i<allFiles.length;i++){
      const file=allFiles[i];
      const item=uploadItems.find(x=>x.name===file.name);
      if(!item?.token||!item?.path){
        throw new Error(`Không nhận được signed token cho ${file.name}`);
      }
      msg($('uploadModelMessage'),'info',`Đang upload ${i+1}/${allFiles.length}: ${file.name} (${(file.size/1024/1024).toFixed(2)} MB)…`);
      const { error }=await supabase.storage
        .from(bucket)
        .uploadToSignedUrl(item.path,item.token,file,{
          contentType:item.content_type||file.type||'application/octet-stream',
          cacheControl:'3600'
        });
      if(error){
        console.error('Supabase upload error:', file.name, error);
        throw new Error(`Supabase Storage lỗi khi upload ${file.name}: ${error.message||String(error)}`);
      }
      uploaded.push(file.name);
    }

    // Bước 3: Netlify Function chỉ ghi model_registry/system_config.
    msg($('uploadModelMessage'),'info','Upload file xong. Đang đăng ký model…');
    const finalizeResponse=await fetch('/.netlify/functions/finalize-model-upload',{
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        Authorization:`Bearer ${adminToken}`
      },
      body:JSON.stringify({
        model_key:key,
        model_version:version,
        activate,
        uploaded_files:uploaded
      })
    });
    const finalized=await readApiResponse(finalizeResponse);
    console.log('finalize-model-upload:', finalizeResponse.status, finalized.raw);
    if(!finalizeResponse.ok){
      throw new Error(apiErrorText('Đăng ký model thất bại',finalizeResponse,finalized.raw,finalized.data));
    }

    msg($('uploadModelMessage'),'ok',`Upload thành công ${allFiles.length} file (${totalMb.toFixed(2)} MB).${finalized.data?.request_id?`\nRequest ID: ${finalized.data.request_id}`:''}`);
    await loadModelRegistry();
    if(activate)await loadAdminConfig();
  }catch(e){
    console.error('UPLOAD MODEL ERROR:',e);
    msg($('uploadModelMessage'),'error',e?.message||String(e));
  }
}
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
$('testSoundBtn').addEventListener('click', testSound);
$('refreshDashboard').addEventListener('click', loadDashboard);

$('saveSystemConfig').addEventListener('click', saveAdminConfig);
$('uploadModelBtn').addEventListener('click', uploadModel);
$('adminTestEmailBtn').addEventListener('click', adminTestEmail);
$('adminTestImageFile').addEventListener('change', previewAdminTestImage);
$('adminRunImageTestBtn').addEventListener('click', runAdminImageTest);
$('adminReloadTestModelBtn').addEventListener('click', async()=>{try{await loadAdminTestModel(true)}catch(e){msg($('adminImageTestMessage'),'error',`Tải model thất bại: ${e.message}`)}});

init().catch(err => {
  console.error(err);
  showOnly('auth');
  msg($('authMessage'), 'error', `Khởi tạo ứng dụng lỗi: ${err.message}`);
});

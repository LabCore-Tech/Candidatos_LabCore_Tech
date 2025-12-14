// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const PER_QUESTION_SEC = 90;
const INVALIDATE_ON_TAB_LEAVE = true;

// ================= STORAGE =================
const LS_PREFIX = "labcore_eval";
const LS_LOCK_KEY   = (ced) => `${LS_PREFIX}:lock:${ced}`;
const LS_CAND_KEY   = (ced) => `${LS_PREFIX}:candidate:${ced}`;
const LS_ACTIVE_KEY = (ced) => `${LS_PREFIX}:active:${ced}`;
const LS_DRAFT_KEY  = (ced) => `${LS_PREFIX}:draft:${ced}`;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function showDebug(msg){ const b=$("debugBox"); if(!b) return; b.textContent=msg; b.classList.remove("hidden"); }
function clearDebug(){ const b=$("debugBox"); if(!b) return; b.textContent=""; b.classList.add("hidden"); }

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec/60);
  const ss = sec%60;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

async function safe(fn){
  try{ await fn(); }catch(e){ showDebug(String(e?.message||e)); console.error(e); }
}

function safeJsonParse(t, fb){ try{return JSON.parse(t);}catch{return fb;} }

// ================= STATE =================
let candidate = null;
let exam = null;            // { area, questions[], answersMap{} }
let idx = 0;

let startedAt = null;
let deadlineAt = null;
let timerInt = null;
let securityWired = false;
let invalidated = false;

// solo para ti
const incidents = {
  total:0,
  visibilityChanges:0,
  tabLeaves:0,
  beforeUnload:0,
  blurCount:0,
  events:[]
};
function addIncident(type, detail){
  incidents.total++;
  incidents.events.push({type, detail, at:new Date().toISOString()});
  if(incidents.events.length>80) incidents.events.shift();
}

// ================= API =================
async function apiGet(mode, area){
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("token", APP_TOKEN);
  url.searchParams.set("area", area);

  const r = await fetch(url.toString(), { cache:"no-store" });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.ok) throw new Error(d.error || "Error consultando servidor");
  return d;
}

// ================= VALIDATION =================
function validateForm(){
  if(!$("firstName")||!$("lastName")||!$("cedula")||!$("area")) return "Faltan campos en el HTML.";
  if($("firstName").value.trim().length<2) return "Nombre inválido.";
  if($("lastName").value.trim().length<2) return "Apellido inválido.";
  if($("cedula").value.trim().length<5) return "Cédula inválida.";
  if(!$("area").value) return "Selecciona el área a concursar.";
  return null;
}
function getCandidate(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = $("cedula").value.trim();
  const area      = $("area").value.trim();
  return { firstName, lastName, cedula, area, fullName:`${firstName} ${lastName}`.trim() };
}

function isLocked(ced){ return localStorage.getItem(LS_LOCK_KEY(ced)) === "1"; }
function lockCedula(ced, snapshot){
  localStorage.setItem(LS_LOCK_KEY(ced), "1");
  localStorage.setItem(LS_CAND_KEY(ced), JSON.stringify(snapshot));
}

function openModal(html, onCancel, onConfirm){
  const modal=$("infoModal"), body=$("modalBody");
  if(!modal||!body) throw new Error("No existe el modal en el HTML.");
  body.innerHTML = html;
  modal.classList.remove("hidden");

  $("cancelStartBtn").onclick = ()=>{ modal.classList.add("hidden"); onCancel && onCancel(); };
  $("confirmStartBtn").onclick = ()=>{ modal.classList.add("hidden"); onConfirm && onConfirm(); };
}

function infoHtml(totalStr){
  return `
    <div>
      Esta prueba tiene una duración máxima de <b>${totalStr}</b>.
      Se recomienda destinar este tiempo completo para resolver la evaluación.
      <ul>
        <li>La evaluación se realiza en una sola sesión continua.</li>
        <li>Si la página se recarga, se cierra la ventana o se interrumpe la sesión, la evaluación no estará disponible nuevamente.</li>
      </ul>
    </div>
  `;
}

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now())/1000);
    if($("timer")) $("timer").textContent = mmss(rem);
    if(rem<=0){
      stopTimer();
      autoSubmit("Tiempo agotado");
    }
  },250);
}
function stopTimer(){ if(timerInt) clearInterval(timerInt); timerInt=null; }

// ================= INVALIDATE =================
function invalidate(reason){
  if(invalidated) return;
  invalidated = true;
  addIncident("invalidated", reason);

  if(candidate?.cedula){
    lockCedula(candidate.cedula, { ...candidate, invalidatedAtISO:new Date().toISOString(), reason });
    localStorage.removeItem(LS_DRAFT_KEY(candidate.cedula));
    localStorage.removeItem(LS_ACTIVE_KEY(candidate.cedula));
  }

  stopTimer();
  if($("okBtn")) $("okBtn").disabled = true;

  if($("submitMsg")){
    $("submitMsg").innerHTML = `<span class="bad">La sesión fue interrumpida. La evaluación no está disponible nuevamente.</span>`;
  }
}

function wireSecurity(){
  if(securityWired) return;
  securityWired = true;

  if(!INVALIDATE_ON_TAB_LEAVE) return;

  document.addEventListener("visibilitychange", ()=>{
    incidents.visibilityChanges++;
    if(document.hidden){
      incidents.tabLeaves++;
      addIncident("tab_leave", `hidden (${incidents.tabLeaves})`);
      invalidate("cambio de pestaña / ventana");
    }
  });

  window.addEventListener("blur", ()=>{
    incidents.blurCount++;
    addIncident("window_blur", `blur (${incidents.blurCount})`);
  });

  window.addEventListener("beforeunload", (e)=>{
    if(!exam) return;
    incidents.beforeUnload++;
    addIncident("beforeunload", "attempt_leave_or_refresh");
    invalidate("recarga / cierre de ventana");
    e.preventDefault();
    e.returnValue = "";
  });
}

// ================= DRAFT =================
function saveDraft(){
  if(!candidate||!exam) return;
  const payload = { candidate, idx, answers: collectAnswers(), savedAtISO:new Date().toISOString() };
  localStorage.setItem(LS_DRAFT_KEY(candidate.cedula), JSON.stringify(payload));
}
function loadDraft(){
  if(!candidate) return null;
  const raw = localStorage.getItem(LS_DRAFT_KEY(candidate.cedula));
  if(!raw) return null;
  return safeJsonParse(raw, null);
}

// ================= RENDER 1 QUESTION =================
function renderCurrent(){
  const q = exam.questions[idx];
  const total = exam.questions.length;

  if($("progress")) $("progress").textContent = `Pregunta ${idx+1} de ${total}`;
  if($("okBtn")) $("okBtn").textContent = (idx === total-1) ? "OK" : "OK";

  const existing = exam.answersMap[q.id] || "";

  $("questionBox").innerHTML = `
    <div class="qtitle">${idx+1}. ${q.prompt}</div>
    <div class="qmeta">Módulo: ${q.moduleName}</div>
    <div class="qanswer">
      <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
    </div>
  `;

  const ta = $("answerBox");
  ta.value = existing;

  ta.addEventListener("input", ()=>{
    exam.answersMap[q.id] = ta.value;
    saveDraft();
  });
}

function collectAnswers(){
  return exam.questions.map(q => ({
    id:q.id,
    module:q.moduleName,
    moduleId:q.moduleId,
    prompt:q.prompt,
    answer:(exam.answersMap[q.id]||"").trim()
  }));
}

// ================= SUBMIT =================
async function submitAll(isAuto=false, autoReason=""){
  if(!exam || !candidate || invalidated) return;

  const answers = collectAnswers();
  if(!isAuto && answers.some(a=>!a.answer)){
    if($("submitMsg")) $("submitMsg").innerHTML = `<span class="bad">Falta responder una o más preguntas.</span>`;
    return;
  }

  const payload = {
    token: APP_TOKEN,
    candidate,
    meta:{
      startedAtISO: startedAt ? new Date(startedAt).toISOString() : null,
      submittedAtISO: new Date().toISOString(),
      durationSec: startedAt ? Math.floor((Date.now()-startedAt)/1000) : null,
      isAutoSubmit: isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    incidents,
    answers
  };

  if($("okBtn")) $("okBtn").disabled = true;
  if($("submitMsg")) $("submitMsg").textContent = "";

  const res = await fetch(APPS_SCRIPT_URL, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(()=> ({}));
  if(!res.ok || !data.ok){
    if($("okBtn")) $("okBtn").disabled = false;
    throw new Error(data.error || "Error enviando respuestas");
  }

  stopTimer();
  localStorage.removeItem(LS_DRAFT_KEY(candidate.cedula));
  localStorage.removeItem(LS_ACTIVE_KEY(candidate.cedula));

  // Bloquea para no repetir
  lockCedula(candidate.cedula, { ...candidate, submittedAtISO:new Date().toISOString() });

  if($("submitMsg")){
    $("submitMsg").innerHTML = `<span class="ok">Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.</span>`;
  }
}

async function autoSubmit(reason){
  if($("submitMsg")) $("submitMsg").innerHTML = `<span class="bad">${reason}. Procesando…</span>`;
  await submitAll(true, reason);
}

// ================= START =================
async function startFlow(){
  clearDebug();
  if($("startMsg")) $("startMsg").textContent = "";

  const err = validateForm();
  if(err){
    $("startMsg").innerHTML = `<span class="bad">${err}</span>`;
    return;
  }

  candidate = getCandidate();

  if(isLocked(candidate.cedula)){
    $("startMsg").innerHTML = `<span class="bad">Esta evaluación ya no está disponible para esta cédula en este dispositivo.</span>`;
    return;
  }

  const meta = await apiGet("meta", candidate.area);
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

  // Popup informativo SOLO aquí
  openModal(
    infoHtml(mmss(totalSec)),
    ()=>{},
    async ()=>{
      // Continuar => inicia
      localStorage.setItem(LS_CAND_KEY(candidate.cedula), JSON.stringify(candidate));
      localStorage.setItem(LS_ACTIVE_KEY(candidate.cedula), JSON.stringify({ startedAtISO:new Date().toISOString() }));

      const out = await apiGet("questions", candidate.area);

      exam = { area: out.area, questions: out.questions || [], answersMap:{} };
      if(!exam.questions.length){
        $("startMsg").innerHTML = `<span class="bad">Área sin preguntas disponibles.</span>`;
        return;
      }

      // muestra examen
      $("examCard").classList.remove("hidden");

      startedAt = Date.now();
      deadlineAt = startedAt + totalSec*1000;
      $("pillLimit").textContent = `Límite: ${mmss(totalSec)}`;
      $("timer").textContent = mmss(totalSec);

      // seguridad tras iniciar (como pediste)
      wireSecurity();
      startTimer();

      // carga draft
      const draft = loadDraft();
      if(draft && Array.isArray(draft.answers)){
        draft.answers.forEach(a=>{ if(a?.id) exam.answersMap[a.id]=a.answer||""; });
        idx = Math.min(Math.max(draft.idx||0,0), exam.questions.length-1);
      } else {
        idx = 0;
      }

      renderCurrent();
      saveDraft();

      $("startMsg").innerHTML = `<span class="ok">Evaluación iniciada.</span>`;
      window.scrollTo({ top: $("examCard").offsetTop - 10, behavior:"smooth" });
    }
  );
}

// ================= OK BUTTON (1x1) =================
async function onOk(){
  if(!exam || invalidated) return;

  const q = exam.questions[idx];
  const ans = ($("answerBox")?.value || "").trim();
  exam.answersMap[q.id] = ans;
  saveDraft();

  // requiere respuesta para avanzar
  if(!ans){
    if($("submitMsg")) $("submitMsg").innerHTML = `<span class="bad">Debes responder antes de continuar.</span>`;
    return;
  }

  $("submitMsg").textContent = "";

  const last = (idx === exam.questions.length - 1);
  if(!last){
    idx++;
    renderCurrent();
    return;
  }

  // último OK => envía todo
  await submitAll(false, "");
}

// ================= INIT =================
(function init(){
  const area = $("area");
  const startBtn = $("startBtn");

  if(!area || !startBtn){
    showDebug("No se encontró #area o #startBtn. Revisa que el index.html sea el correcto.");
    return;
  }

  area.addEventListener("change", ()=> safe(()=> apiGet("meta", area.value).then(meta=>{
    const totalSec = (meta.questionCount||0) * PER_QUESTION_SEC;
    $("startMsg").innerHTML = area.value ? `<span class="hint">Tiempo disponible: <b>${mmss(totalSec)}</b></span>` : "";
  })));

  startBtn.addEventListener("click", ()=> safe(startFlow));

  const okBtn = $("okBtn");
  if(okBtn) okBtn.addEventListener("click", ()=> safe(onOk));
})();

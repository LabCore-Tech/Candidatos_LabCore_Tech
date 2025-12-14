// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const TOTAL_SEC = 90 * 60; // 90 minutos fijos
const MAX_CV_BYTES = 8 * 1024 * 1024;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

async function apiGet(mode, area){
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("token", APP_TOKEN);
  u.searchParams.set("area", area);
  const r = await fetch(u.toString(), { cache:"no-store" });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.ok) throw new Error(d.error || "Error consultando servidor");
  return d;
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=> {
      const res = String(fr.result || "");
      const base64 = res.split(",")[1] || "";
      resolve(base64);
    };
    fr.onerror = ()=> reject(new Error("No se pudo leer el archivo."));
    fr.readAsDataURL(file);
  });
}

// ================= STATE =================
let candidate = null;
let cvPayload = null;
let exam = null;
let idx = 0;

let startedAt = 0;
let deadlineAt = 0;
let timerInt = null;

let securityWired = false;
let invalidated = false;

const LS_PREFIX = "labcore_eval";
const LS_LOCK = (ced) => `${LS_PREFIX}:lock:${ced}`;
const OUTBOX_KEY = `${LS_PREFIX}:outbox`; // cola de envíos pendientes

// incidencias (para ti)
const incidents = {
  total:0, copyBlocked:0, pasteBlocked:0, cutBlocked:0, contextMenuBlocked:0,
  printScreen:0, ctrlP:0, visibilityChanges:0, blurCount:0, beforeUnload:0,
  events:[]
};
function addIncident(type, detail){
  incidents.total++;
  incidents.events.push({ type, detail, at:new Date().toISOString() });
  if(incidents.events.length > 120) incidents.events.shift();
}

function lockCedula(ced){ localStorage.setItem(LS_LOCK(ced), "1"); }
function isLocked(ced){ return localStorage.getItem(LS_LOCK(ced)) === "1"; }

// ============== OUTBOX (resiliencia) ==============
function getOutbox(){
  try{ return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); }catch(_){ return []; }
}
function setOutbox(list){
  try{ localStorage.setItem(OUTBOX_KEY, JSON.stringify(list)); }catch(_){}
}
function queuePayload(p){
  const q = getOutbox(); q.push(p); setOutbox(q);
}
function tryFlushOutbox(){
  const q = getOutbox();
  if(!q.length) return;
  const next = q.shift();
  setOutbox(q);
  // Enviamos silencioso
  if(navigator.sendBeacon){
    const blob = new Blob([JSON.stringify(next)], { type:"application/json" });
    const ok = navigator.sendBeacon(APPS_SCRIPT_URL, blob);
    if(!ok){ queuePayload(next); }
  }else{
    fetch(APPS_SCRIPT_URL, {
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(next)
    }).catch(()=> queuePayload(next));
  }
}

// ================= MODAL =================
function openModal(html){
  $("modalBody").innerHTML = html;
  $("infoModal").classList.remove("hidden");
}
function closeModal(){ $("infoModal").classList.add("hidden"); }

function modalHtml(){
  return `
    <div>
      Esta evaluación tiene una duración máxima de <b>90 minutos</b>.
      Se recomienda disponer de ese tiempo sin interrupciones.
      <ul>
        <li>Evita recargar o cerrar la página durante la sesión.</li>
        <li>Desde este dispositivo, solo es posible realizar una evaluación por cédula.</li>
      </ul>
    </div>
  `;
}

// ================= AREA (interna) =================
function deriveAreaFromRole(role){ return "DEV"; } // ambos cargos usan DEV

// ================= VALIDATION =================
function validateForm(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = $("cedula").value.trim();
  const university = $("university").value.trim();
  const career     = $("career").value;
  const semester   = $("semester").value;
  const role       = $("role").value;
  const cvFile = $("cvFile").files && $("cvFile").files[0];

  if(firstName.length < 2) return "Nombre inválido.";
  if(lastName.length < 2) return "Apellido inválido.";
  if(cedula.length < 5) return "Cédula inválida.";
  if(university.length < 2) return "Universidad inválida.";
  if(!career) return "Selecciona la carrera.";
  if(!semester) return "Selecciona el semestre.";
  if(!role) return "Selecciona el cargo a aspirar.";
  if(!cvFile) return "Debes anexar la hoja de vida.";
  if(cvFile.size > MAX_CV_BYTES) return "La hoja de vida excede 8 MB.";
  return null;
}

function buildCandidate(){
  const role = $("role").value;
  const area = deriveAreaFromRole(role);
  return {
    firstName: $("firstName").value.trim(),
    lastName:  $("lastName").value.trim(),
    cedula:    $("cedula").value.trim(),
    university: $("university").value.trim(),
    career:     $("career").value,
    semester:   $("semester").value,
    role, area,
    fullName: `${$("firstName").value.trim()} ${$("lastName").value.trim()}`
  };
}

// ================= SECURITY =================
function wireSecurityOnce(){
  if(securityWired) return; securityWired = true;
  document.addEventListener("copy", (e)=>{ incidents.copyBlocked++; addIncident("copy_blocked","copy"); e.preventDefault(); });
  document.addEventListener("cut", (e)=>{ incidents.cutBlocked++; addIncident("cut_blocked","cut"); e.preventDefault(); });
  document.addEventListener("paste",(e)=>{ incidents.pasteBlocked++; addIncident("paste_blocked","paste"); e.preventDefault(); });
  document.addEventListener("contextmenu",(e)=>{ incidents.contextMenuBlocked++; addIncident("contextmenu_blocked","contextmenu"); e.preventDefault(); });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "PrintScreen"){ incidents.printScreen++; addIncident("printscreen","PrintScreen"); }
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    if(ctrlOrCmd && (e.key.toLowerCase() === "p")){
      incidents.ctrlP++; addIncident("print_attempt","Ctrl/Cmd+P"); e.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", ()=>{
    incidents.visibilityChanges++; addIncident("visibilitychange", document.hidden ? "hidden":"visible");
    if(document.hidden){ invalidate("Cambio de pestaña/ventana"); }
  });
  window.addEventListener("blur", ()=>{ incidents.blurCount++; addIncident("window_blur","blur"); });
  window.addEventListener("beforeunload", (e)=>{
    if(!exam) return; incidents.beforeUnload++; addIncident("beforeunload","attempt_leave_or_refresh");
    invalidate("Intento de recarga/cierre"); e.preventDefault(); e.returnValue = "";
  });
}

function invalidate(reason){
  if(invalidated) return; invalidated = true; addIncident("invalidated", reason);
  if(candidate?.cedula) lockCedula(candidate.cedula);
  stopTimer(); if($("okBtn")) $("okBtn").disabled = true;
  // Al usuario no se le muestra error; solo se registra para tu informe.
}

// ================= TIMER =================
function startTimer(){
  $("timer").textContent = mmss(TOTAL_SEC);
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(rem);
    if(rem <= 0){ stopTimer(); submitAll(true, "Tiempo agotado"); }
  }, 500);
}
function stopTimer(){ if(timerInt) clearInterval(timerInt); timerInt = null; }

// ================= RENDER (1 a la vez, sin módulo ni contador) =================
function renderQuestion(){
  const q = exam.questions[idx];
  const current = exam.answersMap[q.id] || "";
  $("questionBox").innerHTML = `
    <div class="qtitle">${q.prompt}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;
  const ta = $("answerBox"); ta.value = current;
  ta.addEventListener("paste", (e)=>{ incidents.pasteBlocked++; addIncident("paste_blocked","textarea_paste"); e.preventDefault(); });
  ta.addEventListener("input", ()=>{ exam.answersMap[q.id] = ta.value; });
}

function buildAnswers(){
  return exam.questions.map(q => ({
    id:q.id, prompt:q.prompt, answer:(exam.answersMap[q.id]||"").trim()
  }));
}

// ================= FLOW =================
let pendingStart = null;

async function onStartClick(){
  $("startMsg").textContent = ""; $("submitMsg").textContent = "";
  const err = validateForm(); if(err){ $("startMsg").textContent = err; return; }

  candidate = buildCandidate();
  if(isLocked(candidate.cedula)){ $("startMsg").textContent = "Esta evaluación ya no está disponible para esta cédula en este dispositivo."; return; }

  const file = $("cvFile").files[0];
  const base64 = await fileToBase64(file);
  cvPayload = { name:file.name, mime:file.type || "application/octet-stream", base64, bytes:file.size };

  pendingStart = async () => {
    wireSecurityOnce();

    // Traer preguntas (si falla, mostramos mensaje neutro y no rompemos)
    let qdata = { questions:[] };
    try{
      qdata = await apiGet("questions", candidate.area);
    }catch(e){
      // En caso extremo, no bloqueamos; pero sin preguntas no hay examen.
      $("startMsg").textContent = "No fue posible cargar el cuestionario. Inténtalo de nuevo.";
      return;
    }
    if(!qdata.questions || !qdata.questions.length){
      $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
      return;
    }

    exam = { questions:qdata.questions, answersMap:{} }; idx = 0;

    startedAt = Date.now(); deadlineAt = startedAt + (TOTAL_SEC * 1000);

    $("formCard").classList.add("hidden");
    $("examCard").classList.remove("hidden");

    renderQuestion();
    startTimer();
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior:"smooth" });
  };

  openModal(modalHtml());
}

async function onOkClick(){
  if(!exam || invalidated) return;
  const ans = ($("answerBox")?.value || "").trim();
  if(!ans){ $("submitMsg").innerHTML = "<span class='bad'>Debes responder antes de continuar.</span>"; return; }

  const q = exam.questions[idx];
  exam.answersMap[q.id] = ans;
  $("submitMsg").textContent = "";

  if(idx < exam.questions.length - 1){ idx++; renderQuestion(); return; }

  stopTimer(); await submitAll(false, "");
}

// ================= SUBMIT =================
async function submitAll(isAuto, autoReason){
  if(!exam || !candidate) return;
  lockCedula(candidate.cedula);

  const payload = {
    token: APP_TOKEN,
    candidate,
    meta: {
      startedAtISO: new Date(startedAt).toISOString(),
      submittedAtISO: new Date().toISOString(),
      durationSec: Math.floor((Date.now() - startedAt)/1000),
      isAutoSubmit: !!isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    incidents,
    answers: buildAnswers(),
    cv: cvPayload
  };

  // Intento normal
  let sent = false;
  try{
    const r = await fetch(APPS_SCRIPT_URL, {
      method:"POST", headers:{ "Content-Type":"application/json" }, body: JSON.stringify(payload)
    });
    sent = r.ok;
  }catch(_){ sent = false; }

  if(!sent){
    // Encolar y flush en background (el usuario NO ve error)
    queuePayload(payload);
    tryFlushOutbox();
  }

  // Mensaje para el evaluado SIEMPRE positivo
  $("okBtn").disabled = true;
  $("submitMsg").innerHTML = "<span class='ok'>Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.</span>";
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", ()=>{
  tryFlushOutbox(); // por si había pendientes

  $("startBtn").addEventListener("click", ()=> onStartClick().catch(()=>{}));
  $("okBtn").addEventListener("click", ()=> onOkClick().catch(()=>{}));

  $("modalCloseX").addEventListener("click", ()=> closeModal());
  $("cancelStartBtn").addEventListener("click", ()=> closeModal());
  $("confirmStartBtn").addEventListener("click", ()=> { closeModal(); if(typeof pendingStart==="function"){ pendingStart().catch(()=>{}); }});
});
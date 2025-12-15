// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

// 90s por pregunta (8 preguntas = 12:00)
const PER_QUESTION_SEC = 90;
const MAX_CV_BYTES = 8 * 1024 * 1024; // 8 MB recomendado

// Área interna (NO se muestra)
const INTERNAL_AREA = "DEV";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

async function apiGet(mode){
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("token", APP_TOKEN);
  u.searchParams.set("area", INTERNAL_AREA);

  const r = await fetch(u.toString(), { cache: "no-store" });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.ok) throw new Error(d.error || "server_error");
  return d;
}

function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>{
      const res = String(fr.result || "");
      const base64 = res.split(",")[1] || "";
      resolve(base64);
    };
    fr.onerror = ()=> reject(new Error("file_read_error"));
    fr.readAsDataURL(file);
  });
}

// ================= STATE =================
let candidate = null;
let cvPayload = null; // {name,mime,base64,bytes}
let exam = null;      // {questions[], answersMap{}}
let idx = 0;

let startedAt = 0;
let deadlineAt = 0;
let timerInt = null;

const LS_PREFIX = "labcore_eval";
const LS_LOCK = (ced) => `${LS_PREFIX}:lock:${ced}`;
const LS_LAST = `${LS_PREFIX}:last_payload`; // respaldo local si falla envío

function lockCedula(ced){
  localStorage.setItem(LS_LOCK(ced), "1");
}
function isLocked(ced){
  return localStorage.getItem(LS_LOCK(ced)) === "1";
}

// ================= Incidencias (SOLO para correo) =================
const incidents = {
  total:0,
  copyBlocked:0,
  pasteBlocked:0,
  cutBlocked:0,
  contextMenuBlocked:0,
  printScreen:0,
  ctrlP:0,
  visibilityChanges:0,
  blurCount:0,
  beforeUnload:0,
  events:[]
};
function addIncident(type, detail){
  incidents.total++;
  incidents.events.push({ type, detail, at: new Date().toISOString() });
  if(incidents.events.length > 200) incidents.events.shift();
}

// ================= MODAL (1 modal reutilizable) =================
let modalConfirmHandler = null;
let modalCancelHandler = null;

function openModal({ title, bodyHtml, showCancel, confirmText, cancelText }){
  $("modalBody").innerHTML = bodyHtml || "";
  const titleEl = document.querySelector(".modal-title");
  if(titleEl) titleEl.textContent = title || "Información";

  const cancelBtn = $("cancelStartBtn");
  const confirmBtn = $("confirmStartBtn");

  cancelBtn.textContent = cancelText || "Cancelar";
  confirmBtn.textContent = confirmText || "Aceptar";

  cancelBtn.style.display = showCancel ? "" : "none";

  $("infoModal").classList.remove("hidden");
}

function closeModal(){
  $("infoModal").classList.add("hidden");
  modalConfirmHandler = null;
  modalCancelHandler = null;
}

function wireModalButtonsOnce(){
  if(wireModalButtonsOnce._done) return;
  wireModalButtonsOnce._done = true;

  $("modalCloseX").addEventListener("click", ()=>{
    // X: cerrar sin cambios
    closeModal();
    if(typeof modalCancelHandler === "function") modalCancelHandler();
  });

  $("cancelStartBtn").addEventListener("click", ()=>{
    // Cancelar: cerrar sin cambios
    closeModal();
    if(typeof modalCancelHandler === "function") modalCancelHandler();
  });

  $("confirmStartBtn").addEventListener("click", ()=>{
    const fn = modalConfirmHandler;
    closeModal();
    if(typeof fn === "function") fn();
  });
}

function startInfoHtml(totalStr){
  return `
    <div>
      <p style="margin:0 0 10px 0;">
        Esta evaluación de ingreso tiene una duración máxima de <b>${totalStr}</b>.
        Se recomienda disponer de este tiempo completo para responder con calma y sin interrupciones.
      </p>
      <ul style="margin:0 0 0 18px; padding:0;">
        <li>Durante la sesión, evita recargar la página o cerrar la ventana.</li>
        <li>Si la sesión se interrumpe, la evaluación no podrá iniciarse nuevamente desde este dispositivo.</li>
      </ul>
    </div>
  `;
}

function finishInfoHtml(){
  return `
    <div>
      <p style="margin:0;">
        Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.
      </p>
    </div>
  `;
}

// ================= SECURITY (registrar, NO romper evaluación) =================
let securityWired = false;
function wireSecurityOnce(){
  if(securityWired) return;
  securityWired = true;

  // Bloquear copiar/pegar/cortar + click derecho
  document.addEventListener("copy", (e)=>{
    incidents.copyBlocked++; addIncident("copy_blocked", "copy");
    e.preventDefault();
  });
  document.addEventListener("cut", (e)=>{
    incidents.cutBlocked++; addIncident("cut_blocked", "cut");
    e.preventDefault();
  });
  document.addEventListener("paste", (e)=>{
    incidents.pasteBlocked++; addIncident("paste_blocked", "paste");
    e.preventDefault();
  });
  document.addEventListener("contextmenu", (e)=>{
    incidents.contextMenuBlocked++; addIncident("contextmenu_blocked", "contextmenu");
    e.preventDefault();
  });

  // Registrar intentos comunes (NO se puede impedir screenshot real del sistema)
  document.addEventListener("keydown", (e)=>{
    if(e.key === "PrintScreen"){
      incidents.printScreen++; addIncident("printscreen", "PrintScreen");
    }
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    if(ctrlOrCmd && e.key.toLowerCase() === "p"){
      incidents.ctrlP++; addIncident("print_attempt", "Ctrl/Cmd+P");
      e.preventDefault();
    }
  });

  document.addEventListener("visibilitychange", ()=>{
    incidents.visibilityChanges++;
    addIncident("visibilitychange", document.hidden ? "hidden" : "visible");
  });

  window.addEventListener("blur", ()=>{
    incidents.blurCount++;
    addIncident("window_blur", "blur");
  });

  // Evitar recarga/salida accidental durante examen (confirmación del navegador)
  window.addEventListener("beforeunload", (e)=>{
    if(!exam) return;
    incidents.beforeUnload++;
    addIncident("beforeunload", "attempt_leave_or_refresh");
    e.preventDefault();
    e.returnValue = "";
  });
}

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

  const acceptPolicy = $("acceptPolicy") ? $("acceptPolicy").checked : true;

  if(firstName.length < 2) return "Nombre inválido.";
  if(lastName.length < 2) return "Apellido inválido.";
  if(cedula.length < 5) return "Cédula inválida.";

  if(university.length < 2) return "Universidad inválida.";
  if(!career) return "Selecciona la carrera.";
  if(!semester) return "Selecciona el semestre.";
  if(!role) return "Selecciona el cargo a aspirar.";

  if(!cvFile) return "Debes anexar la hoja de vida.";
  if(cvFile.size > MAX_CV_BYTES) return "La hoja de vida excede el tamaño recomendado (8 MB).";

  if(!acceptPolicy) return "Debes aceptar la Política de tratamiento de datos para continuar.";

  return null;
}

function buildCandidate(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    cedula: $("cedula").value.trim(),
    area: INTERNAL_AREA,
    university: $("university").value.trim(),
    career: $("career").value,
    semester: $("semester").value,
    role: $("role").value
  };
}

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(rem);
    if(rem <= 0){
      stopTimer();
      submitAll(true, "time_over").catch(()=>{});
    }
  }, 500);
}
function stopTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt = null;
}

// ================= RENDER 1 QUESTION =================
function renderQuestion(){
  const q = exam.questions[idx];
  const current = exam.answersMap[q.id] || "";

  $("questionBox").innerHTML = `
    <div class="qtitle">${idx + 1}. ${q.prompt}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;

  const ta = $("answerBox");
  ta.value = current;

  ta.addEventListener("paste", (e)=>{
    incidents.pasteBlocked++; addIncident("paste_blocked", "textarea_paste");
    e.preventDefault();
  });

  ta.addEventListener("input", ()=>{
    exam.answersMap[q.id] = ta.value;
  });
}

function buildAnswers(){
  return exam.questions.map(q => ({
    id: q.id,
    prompt: q.prompt,
    moduleId: q.moduleId,
    moduleName: q.moduleName,
    answer: (exam.answersMap[q.id] || "").trim()
  }));
}

// ================= FLOW =================
async function onStartClick(){
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";

  const err = validateForm();
  if(err){
    $("startMsg").textContent = err;
    return;
  }

  candidate = buildCandidate();

  if(isLocked(candidate.cedula)){
    $("startMsg").textContent = "Esta evaluación ya no está disponible para esta cédula en este dispositivo.";
    return;
  }

  // Leer CV
  const file = $("cvFile").files[0];
  const base64 = await fileToBase64(file);
  cvPayload = {
    name: file.name,
    mime: file.type || "application/octet-stream",
    base64,
    bytes: file.size
  };

  // meta (cantidad preguntas) -> tiempo total
  const meta = await apiGet("meta");
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

  // popup SOLO al click iniciar
  wireModalButtonsOnce();
  openModal({
    title: "Información antes de iniciar",
    bodyHtml: startInfoHtml(mmss(totalSec)),
    showCancel: true,
    cancelText: "Cancelar",
    confirmText: "Acepto, continuar"
  });

  modalCancelHandler = ()=>{ /* cierra sin cambios */ };

  modalConfirmHandler = async ()=>{
    wireSecurityOnce();

    const qdata = await apiGet("questions");
    if(!qdata.questions || !qdata.questions.length){
      $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
      return;
    }

    exam = { questions: qdata.questions, answersMap: {} };
    idx = 0;

    startedAt = Date.now();
    deadlineAt = startedAt + (totalSec * 1000);

    $("timer").textContent = mmss(totalSec);

    $("formCard").classList.add("hidden");
    $("examCard").classList.remove("hidden");

    renderQuestion();
    startTimer();
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  };
}

async function onOkClick(){
  if(!exam) return;

  const ans = ($("answerBox")?.value || "").trim();
  if(!ans){
    $("submitMsg").textContent = "Debes responder antes de continuar.";
    return;
  }

  const q = exam.questions[idx];
  exam.answersMap[q.id] = ans;
  $("submitMsg").textContent = "";

  const last = (idx === exam.questions.length - 1);
  if(!last){
    idx++;
    renderQuestion();
    return;
  }

  stopTimer();
  await submitAll(false, "");
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
      durationSec: Math.floor((Date.now() - startedAt) / 1000),
      isAutoSubmit: !!isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    incidents,
    answers: buildAnswers(),
    cv: cvPayload
  };

  // POST sin preflight (text/plain)
  try{
    const r = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    const d = await r.json().catch(()=> ({}));
    if(!r.ok || !d.ok) throw new Error(d.error || "send_failed");
  }catch(err){
    // respaldo local
    try{ localStorage.setItem(LS_LAST, JSON.stringify(payload)); }catch(_){}
  }

  $("okBtn").disabled = true;

  wireModalButtonsOnce();
  openModal({
    title: "Evaluación finalizada",
    bodyHtml: finishInfoHtml(),
    showCancel: false,
    confirmText: "OK",
    cancelText: ""
  });

  modalConfirmHandler = ()=>{
    window.location.href = "index.html";
  };
}

// ================= INIT =================
document.addEventListener("DOMContentLoaded", ()=>{
  wireModalButtonsOnce();

  $("startBtn").addEventListener("click", ()=>{
    onStartClick().catch(()=>{ $("startMsg").textContent = "No fue posible iniciar en este momento."; });
  });

  $("okBtn").addEventListener("click", ()=>{
    onOkClick().catch(()=>{ $("submitMsg").textContent = "Ocurrió un inconveniente, intenta continuar."; });
  });
});

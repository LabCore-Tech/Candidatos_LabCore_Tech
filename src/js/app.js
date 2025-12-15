// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

// 90s por pregunta
const PER_QUESTION_SEC = 90;
const MAX_CV_BYTES = 8 * 1024 * 1024; // 8 MB recomendado

// Área interna (no se muestra)
const INTERNAL_AREA = "DEV";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function showDebug(msg){
  const b = $("debugBox");
  if(!b) return;
  b.textContent = msg;
  b.classList.remove("hidden");
}
function clearDebug(){
  const b = $("debugBox");
  if(!b) return;
  b.textContent = "";
  b.classList.add("hidden");
}

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

  const r = await fetch(u.toString(), { cache:"no-store" });
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

// “No repetir evaluación” (por cédula en este navegador)
const LS_PREFIX = "labcore_eval";
const LS_LOCK = (ced) => `${LS_PREFIX}:lock:${ced}`;

// Cola de envíos si falla red
const LS_QUEUE = `${LS_PREFIX}:pending_submissions`;

// incidencias SOLO para ti (NO afectan al usuario)
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
  incidents.events.push({ type, detail, at:new Date().toISOString() });
  if(incidents.events.length > 120) incidents.events.shift();
}

function lockCedula(ced){
  localStorage.setItem(LS_LOCK(ced), "1");
}
function isLocked(ced){
  return localStorage.getItem(LS_LOCK(ced)) === "1";
}

// ================= MODAL =================
function openModal(html){
  $("modalBody").innerHTML = html;
  $("infoModal").classList.remove("hidden");
}
function closeModal(){
  $("infoModal").classList.add("hidden");
}
function modalHtml(totalStr){
  return `
    <div>
      Esta evaluación tiene una duración máxima de <b>${totalStr}</b>. Se recomienda disponer de este tiempo completo para responder con calma.
      <ul style="margin:10px 0 0 18px;">
        <li>Evita recargar la página o cerrar la ventana durante la sesión.</li>
        <li>Si la sesión se interrumpe, no es posible iniciar nuevamente la evaluación desde este dispositivo.</li>
      </ul>
    </div>
  `;
}

// ================= VALIDATION =================
function validateForm(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = $("cedula").value.trim();
  const university= $("university").value.trim();
  const career    = $("career").value;
  const semester  = $("semester").value;
  const role      = $("role").value;

  const cvFile = $("cvFile").files && $("cvFile").files[0];

  if(firstName.length < 2) return "Nombre inválido.";
  if(lastName.length < 2) return "Apellido inválido.";
  if(cedula.length < 5) return "Cédula inválida.";
  if(university.length < 2) return "Universidad inválida.";
  if(!career) return "Selecciona la carrera.";
  if(!semester) return "Selecciona el semestre.";
  if(!role) return "Selecciona el cargo a aspirar.";

  if(!cvFile) return "Debes anexar la hoja de vida.";
  if(cvFile.size > MAX_CV_BYTES) return "La hoja de vida excede el tamaño recomendado (8 MB).";

  return null;
}

function buildCandidate(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  return {
    firstName,
    lastName,
    cedula: $("cedula").value.trim(),
    university: $("university").value.trim(),
    career: $("career").value,
    semester: $("semester").value,
    role: $("role").value,
    area: INTERNAL_AREA, // interno
    fullName: `${firstName} ${lastName}`
  };
}

// ================= SECURITY (NO DAÑA UX) =================
let securityWired = false;
function wireSecurityOnce(){
  if(securityWired) return;
  securityWired = true;

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

  // Registrar (sin romper examen)
  window.addEventListener("beforeunload", (e)=>{
    if(!exam) return;
    incidents.beforeUnload++;
    addIncident("beforeunload", "attempt_leave_or_refresh");
    // No bloquear al usuario con mensajes ni invalidar
  });
}

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(rem);
    if(rem <= 0){
      stopTimer();
      // auto-submit silencioso
      submitAll(true, "Tiempo agotado");
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

  // IMPORTANTE: sin "módulo", sin "pregunta x de x", sin "límite"
  $("questionBox").innerHTML = `
    <div class="qtitle">${q.prompt}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;

  const ta = $("answerBox");
  ta.value = current;

  // bloquear pegar en textarea (registrar)
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
    moduleId: q.moduleId,
    module: q.moduleName,
    prompt: q.prompt,
    answer: (exam.answersMap[q.id] || "").trim()
  }));
}

// ================= QUEUE (si falla red) =================
function loadQueue(){
  try{
    return JSON.parse(localStorage.getItem(LS_QUEUE) || "[]");
  }catch{
    return [];
  }
}
function saveQueue(arr){
  localStorage.setItem(LS_QUEUE, JSON.stringify(arr));
}
function enqueuePayload(payload){
  const q = loadQueue();
  q.push({ payload, at: new Date().toISOString() });
  saveQueue(q);
}
async function flushQueue(){
  const q = loadQueue();
  if(!q.length) return;

  const remaining = [];
  for(const item of q){
    try{
      await fetch(APPS_SCRIPT_URL, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify(item.payload)
      });
    }catch{
      remaining.push(item);
    }
  }
  saveQueue(remaining);
}
setInterval(()=> flushQueue().catch(()=>{}), 15000);

// ================= FLOW =================
async function onStartClick(){
  clearDebug();
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";

  const err = validateForm();
  if(err){
    $("startMsg").textContent = err;
    return;
  }

  candidate = buildCandidate();

  if(isLocked(candidate.cedula)){
    $("startMsg").textContent = "Esta evaluación no está disponible nuevamente para esta cédula en este dispositivo.";
    return;
  }

  // leer CV antes (obligatorio)
  const file = $("cvFile").files[0];
  const base64 = await fileToBase64(file);
  cvPayload = { name: file.name, mime: file.type || "application/octet-stream", base64, bytes: file.size };

  // consultar meta (cantidad de preguntas)
  let meta;
  try{
    meta = await apiGet("meta");
  }catch(e){
    // NO mostrar error técnico al usuario
    $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
    return;
  }

  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;
  if(totalSec <= 0){
    $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
    return;
  }

  // Popup SOLO aquí (al click del botón)
  openModal(modalHtml(mmss(totalSec)));

  $("modalCloseX").onclick = () => closeModal();   // X: cierra sin cambios
  $("cancelStartBtn").onclick = () => closeModal(); // Cancelar: cierra sin cambios

  $("confirmStartBtn").onclick = async () => {
    closeModal();

    // a partir de aquí, inicia evaluación
    wireSecurityOnce();

    let qdata;
    try{
      qdata = await apiGet("questions");
    }catch(e){
      $("startMsg").textContent = "No fue posible cargar las preguntas. Intenta nuevamente.";
      return;
    }

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

  const q = exam.questions[idx];
  const ans = ($("answerBox")?.value || "").trim();

  if(!ans){
    // mensaje simple, corporativo (no técnico)
    $("submitMsg").innerHTML = "<span class='bad'>Por favor, registra tu respuesta antes de continuar.</span>";
    return;
  }

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

  // lock al finalizar (o auto-submit)
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

  // UX: siempre mostrar mensaje corporativo (sin errores técnicos)
  $("okBtn").disabled = true;
  $("submitMsg").innerHTML =
    "<span class='ok'>Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.</span>";

  // intentar enviar; si falla, encolar y reintentar en background
  try{
    await fetch(APPS_SCRIPT_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
  }catch{
    enqueuePayload(payload);
  }
}

// ================= INIT =================
$("startBtn").addEventListener("click", ()=> onStartClick().catch(()=>{
  // NO mostrar errores técnicos al usuario
  $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
}));

$("okBtn").addEventListener("click", ()=> onOkClick().catch(()=>{
  // NO mostrar errores técnicos al usuario
  $("submitMsg").innerHTML = "<span class='bad'>Ocurrió un inconveniente. Puedes continuar.</span>";
}));

// Intentar enviar pendientes si existen
flushQueue().catch(()=>{});

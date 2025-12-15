// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const PER_QUESTION_SEC = 90;              // 90 seg por pregunta
const MAX_CV_BYTES = 8 * 1024 * 1024;     // 8 MB

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}
function minutesLabel(sec){
  const m = Math.ceil(sec / 60);
  return `${m} min`;
}

async function apiGet(mode){
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("token", APP_TOKEN);
  u.searchParams.set("area", "DEV"); // interno

  const r = await fetch(u.toString(), { cache:"no-store" });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.ok) throw new Error(d.error || "server_error");
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
    fr.onerror = ()=> reject(new Error("file_read_error"));
    fr.readAsDataURL(file);
  });
}

// ================= STATE =================
let candidate = null;
let cvPayload = null;
let exam = null; // {questions[], answersMap{}}
let idx = 0;

let startedAt = 0;
let deadlineAt = 0;
let timerInt = null;

const LS_PREFIX = "labcore_eval";
const LS_LOCK = (ced) => `${LS_PREFIX}:lock:${ced}`;
const LS_QUEUE = `${LS_PREFIX}:queue`;

function lockCedula(ced){ localStorage.setItem(LS_LOCK(ced), "1"); }
function isLocked(ced){ return localStorage.getItem(LS_LOCK(ced)) === "1"; }

// incidencias (solo para ti por correo)
const incidents = {
  total:0,
  copy:0,
  paste:0,
  cut:0,
  contextmenu:0,
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
  if(incidents.events.length > 180) incidents.events.shift();
}

// ================= MODALS =================
function openModal(html){
  $("modalBody").innerHTML = html;
  $("infoModal").classList.remove("hidden");
}
function closeModal(){ $("infoModal").classList.add("hidden"); }

function openFinish(){
  $("finishModal").classList.remove("hidden");
}
function closeFinish(){
  $("finishModal").classList.add("hidden");
}

function modalHtml(totalLabel){
  return `
    <div>
      Esta evaluación tiene una duración máxima de <b>${totalLabel}</b>.
      Se recomienda disponer de este tiempo completo para responder con calma.
      <ul>
        <li>Evita recargar la página o cerrar la ventana durante la sesión.</li>
        <li>Si la sesión se interrumpe, se registrará como incidencia.</li>
      </ul>
    </div>
  `;
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
  const privacy = $("privacyAccept").checked;

  if(firstName.length < 2) return "Nombre inválido.";
  if(lastName.length < 2) return "Apellido inválido.";
  if(cedula.length < 5) return "Cédula inválida.";
  if(university.length < 2) return "Universidad inválida.";
  if(!career) return "Selecciona la carrera.";
  if(!semester) return "Selecciona el semestre.";
  if(!role) return "Selecciona el cargo a aspirar.";
  if(!cvFile) return "Debes anexar la hoja de vida.";
  if(cvFile.size > MAX_CV_BYTES) return "La hoja de vida excede el tamaño permitido (8 MB).";
  if(!privacy) return "Debes aceptar la Política de tratamiento de datos.";
  return null;
}

function buildCandidate(){
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  return {
    firstName,
    lastName,
    cedula: $("cedula").value.trim(),
    area: "DEV", // interno
    university: $("university").value.trim(),
    career: $("career").value,
    semester: $("semester").value,
    role: $("role").value,
    fullName: `${firstName} ${lastName}`.trim()
  };
}

// ================= SECURITY (SIN BLOQUEAR) =================
let securityWired = false;
function wireSecurityOnce(){
  if(securityWired) return;
  securityWired = true;

  document.addEventListener("copy", (e)=>{ incidents.copy++; addIncident("copy", "copy"); e.preventDefault(); });
  document.addEventListener("cut", (e)=>{ incidents.cut++; addIncident("cut", "cut"); e.preventDefault(); });
  document.addEventListener("paste", (e)=>{ incidents.paste++; addIncident("paste", "paste"); e.preventDefault(); });
  document.addEventListener("contextmenu", (e)=>{ incidents.contextmenu++; addIncident("contextmenu", "contextmenu"); e.preventDefault(); });

  document.addEventListener("keydown", (e)=>{
    if(e.key === "PrintScreen"){
      incidents.printScreen++; addIncident("printscreen", "PrintScreen");
    }
    const isMac = navigator.platform.toLowerCase().includes("mac");
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;
    if(ctrlOrCmd && (e.key.toLowerCase() === "p")){
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
  window.addEventListener("beforeunload", (e)=>{
    if(!exam) return;
    incidents.beforeUnload++;
    addIncident("beforeunload", "attempt_leave_or_refresh");
    // NO bloquea, NO muestra error. Solo registra.
    e.preventDefault();
    e.returnValue = "";
  });
}

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(rem);
    if(rem <= 0){
      stopTimer();
      submitAll(true, "Tiempo agotado");
    }
  }, 400);
}
function stopTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt = null;
}

// ================= RENDER QUESTION =================
function renderQuestion(){
  const q = exam.questions[idx];
  const n = idx + 1;

  const current = exam.answersMap[q.id] || "";

  $("questionBox").innerHTML = `
    <div class="qtitle">${n}. ${q.prompt}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;

  const ta = $("answerBox");
  ta.value = current;

  // bloquear pegar dentro de textarea (solo registra)
  ta.addEventListener("paste", (e)=>{
    incidents.paste++; addIncident("paste", "textarea_paste");
    e.preventDefault();
  });

  ta.addEventListener("input", ()=>{
    exam.answersMap[q.id] = ta.value;
  });
}

function buildAnswers(){
  return exam.questions.map((q, i) => ({
    n: i+1,
    id: q.id,
    prompt: q.prompt,
    answer: (exam.answersMap[q.id] || "").trim(),
    moduleId: q.moduleId,
    module: q.moduleName
  }));
}

// ================= QUEUE (si falla red) =================
function loadQueue(){
  try{ return JSON.parse(localStorage.getItem(LS_QUEUE) || "[]"); }
  catch{ return []; }
}
function saveQueue(arr){ localStorage.setItem(LS_QUEUE, JSON.stringify(arr)); }
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
        headers:{ "Content-Type":"text/plain;charset=utf-8" }, // evita preflight
        body: JSON.stringify(item.payload)
      });
    }catch{
      remaining.push(item);
    }
  }
  saveQueue(remaining);
}
setInterval(()=> flushQueue().catch(()=>{}), 12000);

// ================= FLOW =================
async function onStartClick(){
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";

  const err = validateForm();
  if(err){ $("startMsg").textContent = err; return; }

  candidate = buildCandidate();
  if(isLocked(candidate.cedula)){
    $("startMsg").textContent = "Esta evaluación ya fue realizada desde este dispositivo para esta cédula.";
    return;
  }

  // CV
  const file = $("cvFile").files[0];
  const base64 = await fileToBase64(file);
  cvPayload = { name: file.name, mime: file.type || "application/octet-stream", base64, bytes: file.size };

  // meta
  let meta;
  try{
    meta = await apiGet("meta");
  }catch{
    $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
    return;
  }

  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;
  if(totalSec <= 0){
    $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
    return;
  }

  openModal(modalHtml(minutesLabel(totalSec)));

  $("modalCloseX").onclick = closeModal;
  $("cancelStartBtn").onclick = closeModal;

  $("confirmStartBtn").onclick = async () => {
    closeModal();
    wireSecurityOnce();

    let qdata;
    try{
      qdata = await apiGet("questions");
    }catch{
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
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
}

async function onOkClick(){
  if(!exam) return;

  const q = exam.questions[idx];
  const ans = ($("answerBox")?.value || "").trim();

  if(!ans){
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

  // bloquear reintentos desde este dispositivo (como lo querías)
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

  $("okBtn").disabled = true;

  try{
    await fetch(APPS_SCRIPT_URL, {
      method:"POST",
      headers:{ "Content-Type":"text/plain;charset=utf-8" }, // evita preflight
      body: JSON.stringify(payload)
    });
  }catch{
    // NO mostramos error al usuario: se encola
    enqueuePayload(payload);
  }

  // popup final y volver al index
  openFinish();
}

// finish ok -> reset
$("finishOkBtn").addEventListener("click", ()=>{
  closeFinish();
  window.location.href = "index.html";
});

// ================= INIT =================
$("startBtn").addEventListener("click", ()=> onStartClick().catch(()=>{
  $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
}));

$("okBtn").addEventListener("click", ()=> onOkClick().catch(()=>{
  // no se cae el cuestionario
  $("submitMsg").innerHTML = "<span class='bad'>Ocurrió un inconveniente. Puedes continuar.</span>";
}));

flushQueue().catch(()=>{});

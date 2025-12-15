// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

// 90 segundos por pregunta (8 preguntas => 12 min)
const PER_QUESTION_SEC = 90;
const MAX_CV_BYTES = 8 * 1024 * 1024;

// Área interna (NO se muestra)
const AREA = "DEV";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function minutesLabel(totalSec){
  const min = Math.ceil(totalSec / 60);
  return `${min} minutos`;
}

function shuffle(a){
  a = a.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function apiGet(mode){
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("token", APP_TOKEN);
  u.searchParams.set("area", AREA);

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
      resolve((res.split(",")[1] || ""));
    };
    fr.onerror = ()=> reject(new Error("file_read_error"));
    fr.readAsDataURL(file);
  });
}

// ================= STATE =================
let candidate = null;
let cvPayload = null;

let exam = null; // { questions:[], answersMap:{} }
let idx = 0;

let startedAt = 0;
let deadlineAt = 0;
let timerInt = null;

// Lock por cédula en este dispositivo
const LS_PREFIX = "labcore_eval";
const LS_LOCK = (ced) => `${LS_PREFIX}:lock:${ced}`;

// Cola de envíos (si no hay internet o falla Apps Script)
const LS_QUEUE = `${LS_PREFIX}:pending_submissions`;

// Incidencias SOLO para ti (no afectan UX)
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
  if(incidents.events.length > 140) incidents.events.shift();
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
function modalHtml(totalSec){
  return `
    <div>
      Esta evaluación de ingreso tiene una duración máxima de
      <b>${minutesLabel(totalSec)}</b>.
      Se recomienda disponer de este tiempo completo para responder con calma.

      <ul style="margin:10px 0 0 18px;">
        <li>Evita recargar la página o cerrar la ventana durante la sesión.</li>
        <li>Una vez finalizada o interrumpida, la evaluación no estará disponible nuevamente desde este dispositivo.</li>
      </ul>

      <p class="legal-note" style="margin-top:12px; font-size:0.85rem; color:#6b7280;">
        Al continuar con esta evaluación, autorizas el tratamiento de tus datos personales
        conforme a la Ley 1581 de 2012, el Decreto 1377 de 2013 y la
        <a href="./politica-datos.html" target="_blank" rel="noopener noreferrer">
		  Política de Tratamiento de Datos Personales
		</a>
        de <strong>LabCore Tech</strong>.
      </p>
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
    area: AREA,
    fullName: `${firstName} ${lastName}`
  };
}

// ================= SECURITY (SILENCIOSO) =================
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

  // Registramos intento de refresh/cierre, pero NO dañamos el cuestionario ni mostramos mensaje
  window.addEventListener("beforeunload", ()=>{
    if(!exam) return;
    incidents.beforeUnload++;
    addIncident("beforeunload", "attempt_leave_or_refresh");
  });
}

// ================= TIMER (MINUTOS, ROJO) =================
function startTimer(totalSec){
  const end = Date.now() + totalSec * 1000;
  deadlineAt = end;

  const tick = ()=>{
    const remSec = Math.max(0, Math.ceil((deadlineAt - Date.now())/1000));
    const remMin = Math.max(0, Math.ceil(remSec/60));
    $("timer").textContent = `${remMin} min`;

    if(remSec <= 0){
      stopTimer();
      submitAll(true, "Tiempo agotado");
    }
  };

  tick();
  timerInt = setInterval(tick, 1000);
}

function stopTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt = null;
}

// ================= RENDER (1 PREGUNTA A LA VEZ) =================
function renderQuestion(){
  const q = exam.questions[idx];
  const current = exam.answersMap[q.id] || "";

  $("questionBox").innerHTML = `
    <div class="qtitle">${q.prompt}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;

  const ta = $("answerBox");
  ta.value = current;

  // Bloquear pegar dentro del textarea
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

// ================= QUEUE (FALLO DE RED NO DAÑA UX) =================
function loadQueue(){
  try{ return JSON.parse(localStorage.getItem(LS_QUEUE) || "[]"); }
  catch{ return []; }
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

// Reintentos cada 15s
setInterval(()=> flushQueue().catch(()=>{}), 15000);

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
    $("startMsg").textContent = "Esta evaluación no está disponible nuevamente para esta cédula en este dispositivo.";
    return;
  }

  // Leer CV (obligatorio)
  const file = $("cvFile").files[0];
  const base64 = await fileToBase64(file);
  cvPayload = { name: file.name, mime: file.type || "application/octet-stream", base64, bytes: file.size };

  // Pedir meta (cantidad preguntas)
  let meta;
  try{
    meta = await apiGet("meta");
  }catch{
    // sin error técnico
    $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
    return;
  }

  const qCount = Number(meta.questionCount || 0);
  if(qCount <= 0){
    $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
    return;
  }

  const totalSec = qCount * PER_QUESTION_SEC;

  // Modal SOLO aquí
  openModal(modalHtml(totalSec));

  $("modalCloseX").onclick = () => closeModal();
  $("cancelStartBtn").onclick = () => closeModal();

  $("confirmStartBtn").onclick = async () => {
    closeModal();

    wireSecurityOnce();

    // Pedir preguntas
    let qdata;
    try{
      qdata = await apiGet("questions");
    }catch{
      $("startMsg").textContent = "No fue posible cargar la evaluación. Intenta nuevamente.";
      return;
    }

    const questions = Array.isArray(qdata.questions) ? qdata.questions : [];
    if(!questions.length){
      $("startMsg").textContent = "No hay preguntas disponibles en este momento.";
      return;
    }

    // Seguridad extra: mezclar también en el front (por si acaso)
    const finalQuestions = shuffle(questions);

    exam = { questions: finalQuestions, answersMap: {} };
    idx = 0;

    startedAt = Date.now();

    $("formCard").classList.add("hidden");
    $("examCard").classList.remove("hidden");

    renderQuestion();
    startTimer(totalSec);

    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  };
}

async function onOkClick(){
  if(!exam) return;

  const ans = ($("answerBox")?.value || "").trim();
  if(!ans){
    $("submitMsg").innerHTML = "<span class='bad'>Por favor registra tu respuesta para continuar.</span>";
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
      durationSec: Math.floor((Date.now() - startedAt)/1000),
      isAutoSubmit: !!isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    incidents,
    answers: buildAnswers(),
    cv: cvPayload
  };

  // Mensaje corporativo (sin “si falló” ni errores)
  $("okBtn").disabled = true;
  $("submitMsg").innerHTML =
    "<span class='ok'>Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.</span>";

  try{
    await fetch(APPS_SCRIPT_URL, {
      method:"POST",
      headers:{ "Content-Type":"application/json" },
      body: JSON.stringify(payload)
    });
  }catch{
    // si falla: guardar y reintentar sin molestar al candidato
    enqueuePayload(payload);
  }
}

// ================= INIT =================
$("startBtn").addEventListener("click", ()=> onStartClick().catch(()=>{
  $("startMsg").textContent = "No fue posible iniciar en este momento. Intenta nuevamente.";
}));

$("okBtn").addEventListener("click", ()=> onOkClick().catch(()=>{
  // NO daño el cuestionario
  $("submitMsg").innerHTML = "<span class='bad'>Ocurrió un inconveniente. Puedes continuar.</span>";
}));

// Reintentar pendientes al cargar
flushQueue().catch(()=>{});

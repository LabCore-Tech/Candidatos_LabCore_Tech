// =====================
// CONFIG (EDITA AQUÍ)
// =====================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

// Opcional: si quieres exigir código de acceso
const ACCESS_CODE_REQUIRED = false;     // true/false
const ACCESS_CODE_VALUE = "LC-2026";    // si required=true

// Tiempo
const PER_QUESTION_SEC = 90; // 90s por pregunta (7 preguntas => 10.5 min)

// Salidas de pestaña
const TAB_LEAVE_POLICY = "autoSubmit"; // "logOnly" | "warn" | "autoSubmit"
const TAB_LEAVE_AUTOSUBMIT_THRESHOLD = 3;

// Anti copy/paste
const BLOCK_COPY_PASTE = true;

// =====================
// STATE
// =====================
let exam = null;
let startedAt = null;
let deadlineAt = null;
let timerInt = null;

const incidents = {
  total: 0,
  tabLeaves: 0,
  visibilityChanges: 0,
  blurCount: 0,
  copyAttempts: 0,
  pasteAttempts: 0,
  cutAttempts: 0,
  keyBlocked: 0,
  contextMenuBlocked: 0,
  selectionBlocked: 0,
  events: []
};

// =====================
// HELPERS
// =====================
const $ = (id) => document.getElementById(id);

function pad(n){ return String(n).padStart(2,'0'); }
function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec/60);
  const ss = sec%60;
  return `${pad(mm)}:${pad(ss)}`;
}

function shuffle(arr){
  const a = [...arr];
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function addIncident(type, detail){
  incidents.total += 1;
  incidents.events.push({ type, detail, at: new Date().toISOString() });
  if(incidents.events.length > 50) incidents.events.shift();

  $("pillIncidents").textContent = `Incidencias: ${incidents.total}`;
  $("pillTab").textContent = `Salidas: ${incidents.tabLeaves}`;
}

function validateCandidate(){
  const fullName = $("fullName").value.trim();
  const cedula = $("cedula").value.trim();
  const role = $("role").value.trim();

  if(fullName.length < 5) return "Nombre inválido.";
  if(cedula.length < 5) return "Cédula inválida.";
  if(role.length < 2) return "Rol/Personaje inválido.";

  if(ACCESS_CODE_REQUIRED){
    const ac = $("accessCode").value.trim();
    if(ac !== ACCESS_CODE_VALUE) return "Código de acceso inválido.";
  }

  return null;
}

async function loadQuestionsFromServer(){
  const ac = $("accessCode").value.trim();
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("mode", "questions");
  url.searchParams.set("token", APP_TOKEN);
  if(ac) url.searchParams.set("accessCode", ac);

  const res = await fetch(url.toString(), { cache: "no-store" });
  const data = await res.json();
  if(!data.ok) throw new Error(data.error || "No se pudieron cargar preguntas");
  return data;
}

function renderExam(examObj){
  const form = $("examForm");
  form.innerHTML = "";

  examObj.questions.forEach((q, idx)=>{
    const wrap = document.createElement("div");
    wrap.className = "q";
    wrap.dataset.qid = q.id;

    const title = document.createElement("h3");
    title.textContent = `${idx+1}. ${q.prompt}`;
    wrap.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "small";
    meta.textContent = `Módulo: ${q.moduleName} · ID: ${q.id}`;
    wrap.appendChild(meta);

    const ta = document.createElement("textarea");
    ta.name = `q_${q.id}`;
    ta.placeholder = "Escribe tu respuesta...";
    ta.required = true;
    wrap.appendChild(ta);

    form.appendChild(wrap);
  });
}

function collectAnswers(examObj){
  const form = $("examForm");
  const out = [];

  for(const q of examObj.questions){
    const key = `q_${q.id}`;
    const el = form.querySelector(`[name="${key}"]`);
    const value = el ? (el.value || "").trim() : "";

    out.push({
      id: q.id,
      module: q.moduleName,
      moduleId: q.moduleId,
      type: q.type,
      prompt: q.prompt,
      answer: value
    });
  }

  return out;
}

function startTimer(){
  const t = $("timer");
  timerInt = setInterval(()=>{
    const remaining = Math.max(0, Math.floor((deadlineAt - Date.now())/1000));
    t.textContent = mmss(remaining);

    if(remaining <= 0){
      stopTimer();
      autoSubmit("Tiempo agotado");
    }
  }, 250);
}

function stopTimer(){
  if(timerInt) clearInterval(timerInt);
  timerInt = null;
}

function setLimitPills(){
  const limitSec = exam.count * PER_QUESTION_SEC;
  $("pillLimit").textContent = `Límite: ${mmss(limitSec)}`;
}

function lockDown(){
  if(!BLOCK_COPY_PASTE) return;

  // bloquea clic derecho
  document.addEventListener("contextmenu", (e)=>{
    e.preventDefault();
    incidents.contextMenuBlocked += 1;
    addIncident("contextmenu_blocked", "Right click blocked");
  });

  // bloquea copiar/pegar/cortar
  document.addEventListener("copy", (e)=>{
    e.preventDefault();
    incidents.copyAttempts += 1;
    addIncident("copy_blocked", "copy event blocked");
  });
  document.addEventListener("paste", (e)=>{
    e.preventDefault();
    incidents.pasteAttempts += 1;
    addIncident("paste_blocked", "paste event blocked");
  });
  document.addEventListener("cut", (e)=>{
    e.preventDefault();
    incidents.cutAttempts += 1;
    addIncident("cut_blocked", "cut event blocked");
  });

  // bloquea teclas: Ctrl+C/V/X/A, Ctrl+Insert, Shift+Insert, etc.
  document.addEventListener("keydown", (e)=>{
    const key = (e.key || "").toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;

    const blocked =
      (ctrl && ["c","v","x","a"].includes(key)) ||
      (ctrl && key === "insert") ||
      (e.shiftKey && key === "insert");

    if(blocked){
      e.preventDefault();
      incidents.keyBlocked += 1;
      addIncident("key_blocked", `blocked key combo: ctrl/meta=${ctrl} key=${key}`);
    }
  }, true);

  // bloquea selección
  document.addEventListener("selectstart", (e)=>{
    e.preventDefault();
    incidents.selectionBlocked += 1;
    addIncident("selection_blocked", "selectstart blocked");
  });
}

function watchTabLeaves(){
  // cambia visibilidad
  document.addEventListener("visibilitychange", ()=>{
    incidents.visibilityChanges += 1;

    if(document.hidden){
      incidents.tabLeaves += 1;
      addIncident("tab_leave", `visibility hidden (${incidents.tabLeaves})`);

      if(TAB_LEAVE_POLICY === "warn"){
        $("submitMsg").innerHTML = `<span class="bad">Advertencia: no salgas de la pestaña. Salidas: ${incidents.tabLeaves}</span>`;
      }

      if(TAB_LEAVE_POLICY === "autoSubmit" && incidents.tabLeaves >= TAB_LEAVE_AUTOSUBMIT_THRESHOLD){
        autoSubmit(`Auto-envío por salidas de pestaña (${incidents.tabLeaves})`);
      }
    }
  });

  // blur (cambio de ventana)
  window.addEventListener("blur", ()=>{
    incidents.blurCount += 1;
    addIncident("window_blur", `blur (${incidents.blurCount})`);
  });
}

async function autoSubmit(reason){
  if(!exam) return;
  if($("submitBtn").disabled) return;

  $("submitMsg").innerHTML = `<span class="bad">${reason}. Enviando automáticamente...</span>`;
  await submitAnswers(true, reason);
}

// =====================
// SUBMIT
// =====================
async function submitAnswers(isAuto=false, autoReason=""){
  const form = $("examForm");
  if(!isAuto){
    const ok = form.checkValidity();
    if(!ok){
      form.reportValidity();
      $("submitMsg").innerHTML = `<span class="bad">Faltan respuestas.</span>`;
      return;
    }
  }

  const fullName = $("fullName").value.trim();
  const cedula = $("cedula").value.trim();
  const role = $("role").value.trim();

  const durationSec = startedAt ? Math.floor((Date.now() - startedAt)/1000) : null;
  const answers = collectAnswers(exam);

  const body = {
    token: APP_TOKEN,
    candidate: { fullName, cedula, role },
    meta: {
      startedAtISO: startedAt ? new Date(startedAt).toISOString() : null,
      submittedAtISO: new Date().toISOString(),
      durationSec,
      isAutoSubmit: isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    exam: {
      version: exam.version,
      count: exam.count
    },
    incidents,
    answers
  };

  $("submitBtn").disabled = true;
  $("startBtn").disabled = true;
  $("resetBtn").disabled = true;

  try{
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type":"application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(()=> ({}));

    if(!res.ok || !data.ok){
      throw new Error(data.error || "Error enviando. Revisa Apps Script.");
    }

    stopTimer();
    $("submitMsg").innerHTML = `<span class="ok">Listo. Respuestas enviadas.</span>`;
  } catch(e){
    $("submitBtn").disabled = false;
    $("resetBtn").disabled = false;
    $("submitMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
}

// =====================
// UI EVENTS
// =====================
$("startBtn").addEventListener("click", async ()=>{
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";

  const err = validateCandidate();
  if(err){
    $("startMsg").innerHTML = `<span class="bad">${err}</span>`;
    return;
  }
  if(APPS_SCRIPT_URL.includes("PEGAR_AQUI")){
    $("startMsg").innerHTML = `<span class="bad">Falta configurar APPS_SCRIPT_URL en app.js</span>`;
    return;
  }
  if(!APP_TOKEN || APP_TOKEN.length < 20){
    $("startMsg").innerHTML = `<span class="bad">APP_TOKEN inválido. Debe ser largo.</span>`;
    return;
  }

  try{
    const data = await loadQuestionsFromServer();
    exam = {
      version: data.version || "1.0",
      count: data.count || (data.questions ? data.questions.length : 0),
      questions: data.questions || []
    };

    if(!exam.questions.length){
      $("startMsg").innerHTML = `<span class="bad">No llegaron preguntas.</span>`;
      return;
    }

    renderExam(exam);
    $("examCard").classList.remove("hidden");

    // tiempo
    startedAt = Date.now();
    const limitSec = exam.count * PER_QUESTION_SEC;
    deadlineAt = startedAt + limitSec * 1000;
    $("timer").textContent = mmss(limitSec);
    setLimitPills();
    startTimer();

    // seguridad
    lockDown();
    watchTabLeaves();

    $("startMsg").innerHTML = `<span class="ok">Examen iniciado (${exam.count} preguntas). No cierres la pestaña.</span>`;
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  } catch(e){
    $("startMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
});

$("submitBtn").addEventListener("click", async ()=>{
  $("submitMsg").textContent = "";
  await submitAnswers(false, "");
});

$("resetBtn").addEventListener("click", ()=>{
  stopTimer();
  exam = null;
  startedAt = null;
  deadlineAt = null;

  // reset UI
  $("examForm").innerHTML = "";
  $("examCard").classList.add("hidden");
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";
  $("timer").textContent = "--:--";
  $("pillLimit").textContent = "Límite: --:--";
  $("pillIncidents").textContent = "Incidencias: 0";
  $("pillTab").textContent = "Salidas: 0";

  // reset incidents
  for(const k of Object.keys(incidents)){
    if(typeof incidents[k] === "number") incidents[k] = 0;
    if(Array.isArray(incidents[k])) incidents[k] = [];
  }

  $("submitBtn").disabled = false;
  $("startBtn").disabled = false;
  $("resetBtn").disabled = false;
});

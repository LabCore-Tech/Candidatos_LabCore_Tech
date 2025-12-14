// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";
// ================= CONFIG =================

const PER_QUESTION_SEC = 90;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
}

async function api(mode, area){
  const u = new URL(APPS_SCRIPT_URL);
  u.searchParams.set("mode", mode);
  u.searchParams.set("token", APP_TOKEN);
  u.searchParams.set("area", area);

  const r = await fetch(u.toString(), { cache: "no-store" });
  const d = await r.json().catch(()=> ({}));
  if(!r.ok || !d.ok) throw new Error(d.error || "Error consultando servidor");
  return d;
}

// ================= STATE =================
let candidate = null;
let exam = null; // { questions[], answersMap{} }
let idx = 0;
let startedAt = 0;
let deadlineAt = 0;
let timerInt = null;

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const rem = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(rem);
    if(rem <= 0){
      stopTimer();
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
  const total = exam.questions.length;

  $("progress").textContent = `Pregunta ${idx + 1} de ${total}`;

  const current = exam.answersMap[q.id] || "";

  $("questionBox").innerHTML = `
    <div class="qtitle">${idx + 1}. ${q.prompt}</div>
    <div class="qmeta">Módulo: ${q.moduleName}</div>
    <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
  `;

  $("answerBox").value = current;
  $("answerBox").addEventListener("input", ()=>{
    exam.answersMap[q.id] = $("answerBox").value;
  });
}

// ================= START =================
async function startExam(){
  $("startMsg").textContent = "";
  $("submitMsg").textContent = "";

  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = $("cedula").value.trim();
  const area      = $("area").value;

  if(!firstName || !lastName || !cedula || !area){
    $("startMsg").textContent = "Completa todos los campos.";
    return;
  }

  candidate = { firstName, lastName, cedula, area, fullName: `${firstName} ${lastName}` };

  // meta (tiempo total)
  const meta = await api("meta", area);
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

  // questions
  const qdata = await api("questions", area);
  if(!qdata.questions || !qdata.questions.length){
    $("startMsg").textContent = "No hay preguntas disponibles para esta área.";
    return;
  }

  exam = { questions: qdata.questions, answersMap: {} };
  idx = 0;

  startedAt = Date.now();
  deadlineAt = startedAt + totalSec * 1000;

  $("pillLimit").textContent = `Límite: ${mmss(totalSec)}`;
  $("timer").textContent = mmss(totalSec);

  $("formCard").classList.add("hidden");
  $("examCard").classList.remove("hidden");

  renderQuestion();
  startTimer();
}

// ================= OK (next or submit) =================
async function onOk(){
  if(!exam) return;

  const q = exam.questions[idx];
  const ans = ($("answerBox")?.value || "").trim();

  if(!ans){
    $("submitMsg").innerHTML = "<span class='bad'>Debes responder antes de continuar.</span>";
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

  // último OK => envía
  stopTimer();
  await submitAll(false, "");
}

// ================= SUBMIT =================
async function submitAll(isAuto, autoReason){
  const answers = exam.questions.map(q => ({
    id: q.id,
    module: q.moduleName,
    moduleId: q.moduleId,
    prompt: q.prompt,
    answer: (exam.answersMap[q.id] || "").trim()
  }));

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
    answers
  };

  // no mostramos “enviado al correo”, solo mensaje corporativo
  await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  $("okBtn").disabled = true;

  $("submitMsg").innerHTML =
    "<span class='ok'>Tus respuestas serán remitidas satisfactoriamente al área encargada de LabCore Tech.</span>";
}

// ================= INIT =================
$("startBtn").addEventListener("click", ()=> startExam().catch(e=>{
  $("startMsg").textContent = String(e?.message || e);
}));

$("okBtn").addEventListener("click", ()=> onOk().catch(e=>{
  $("submitMsg").innerHTML = `<span class='bad'>${String(e?.message || e)}</span>`;
}));

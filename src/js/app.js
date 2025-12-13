// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const PER_QUESTION_SEC = 90;
const TAB_LEAVE_AUTOSUBMIT_THRESHOLD = 3;
const BLOCK_COPY_PASTE = true;

// ================= STATE =================
let exam = null;
let startedAt = null;
let deadlineAt = null;
let timerInt = null;

const incidents = {
  total: 0,
  tabLeaves: 0,
  copyAttempts: 0,
  pasteAttempts: 0,
  events: []
};

// ================= HELPERS =================
const $ = id => document.getElementById(id);

function mmss(sec){
  sec = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
}

function addIncident(type){
  incidents.total++;
  incidents.events.push({ type, at: new Date().toISOString() });
  $("pillIncidents").textContent = `Incidencias: ${incidents.total}`;
  $("pillTab").textContent = `Salidas: ${incidents.tabLeaves}`;
}

function validateCandidate(){
  if($("firstName").value.trim().length < 2) return "Nombre inválido.";
  if($("lastName").value.trim().length < 2) return "Apellido inválido.";
  if($("cedula").value.trim().length < 5) return "Cédula inválida.";
  if(!$("area").value) return "Debe seleccionar el área a concursar.";
  return null;
}

// ================= LOAD QUESTIONS =================
async function loadQuestions(area){
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("mode","questions");
  url.searchParams.set("token",APP_TOKEN);
  url.searchParams.set("area",area);

  const r = await fetch(url.toString(),{cache:"no-store"});
  const d = await r.json();
  if(!d.ok) throw new Error(d.error || "No se pudieron cargar preguntas");
  return d.questions;
}

// ================= RENDER =================
function renderExam(qs){
  const f = $("examForm");
  f.innerHTML = "";
  qs.forEach((q,i)=>{
    f.innerHTML += `
      <div class="q">
        <h3>${i+1}. ${q.prompt}</h3>
        <div class="small">Módulo: ${q.moduleName}</div>
        <textarea name="q_${q.id}" required></textarea>
      </div>`;
  });
}

// ================= TIMER =================
function startTimer(){
  timerInt = setInterval(()=>{
    const r = Math.floor((deadlineAt - Date.now())/1000);
    $("timer").textContent = mmss(r);
    if(r<=0) autoSubmit("Tiempo agotado");
  },250);
}

function stopTimer(){
  if(timerInt) clearInterval(timerInt);
}

// ================= LOCKDOWN =================
document.addEventListener("copy",e=>{e.preventDefault();incidents.copyAttempts++;addIncident("copy");});
document.addEventListener("paste",e=>{e.preventDefault();incidents.pasteAttempts++;addIncident("paste");});
document.addEventListener("visibilitychange",()=>{
  if(document.hidden){
    incidents.tabLeaves++;
    addIncident("tab_leave");
    if(incidents.tabLeaves>=TAB_LEAVE_AUTOSUBMIT_THRESHOLD){
      autoSubmit("Salida reiterada de la pestaña");
    }
  }
});

// ================= SUBMIT =================
async function submit(auto=false,reason=""){
  const answers = exam.map(q=>({
    id:q.id,
    module:q.moduleName,
    prompt:q.prompt,
    answer:document.querySelector(`[name="q_${q.id}"]`).value.trim()
  }));

  const payload = {
    token:APP_TOKEN,
    candidate:{
      fullName:`${firstName.value} ${lastName.value}`,
      firstName:firstName.value,
      lastName:lastName.value,
      cedula:cedula.value,
      area:area.value
    },
    meta:{
      durationSec:Math.floor((Date.now()-startedAt)/1000),
      isAutoSubmit:auto,
      autoReason:reason
    },
    incidents,
    answers
  };

  await fetch(APPS_SCRIPT_URL,{
    method:"POST",
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });

  stopTimer();
  $("submitMsg").innerHTML = `<span class="ok">Evaluación enviada correctamente.</span>`;
}

function autoSubmit(reason){
  if($("submitBtn").disabled) return;
  $("submitMsg").innerHTML = `<span class="bad">${reason}. Enviando…</span>`;
  $("submitBtn").disabled = true;
  submit(true,reason);
}

// ================= UI =================
startBtn.onclick = async ()=>{
  startMsg.textContent="";
  const err = validateCandidate();
  if(err){ startMsg.innerHTML=`<span class="bad">${err}</span>`; return; }

  exam = await loadQuestions(area.value);
  renderExam(exam);

  $("examCard").classList.remove("hidden");

  startedAt = Date.now();
  deadlineAt = startedAt + exam.length * PER_QUESTION_SEC * 1000;

  $("pillLimit").textContent = `Límite: ${mmss(exam.length*PER_QUESTION_SEC)}`;
  startTimer();
};

submitBtn.onclick = ()=> submit(false,"");
resetBtn.onclick = ()=> location.reload();

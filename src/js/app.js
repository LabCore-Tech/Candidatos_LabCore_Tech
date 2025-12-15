/* =========================
   LabCore Tech - Evaluación
   ========================= */

/* =========================
   CONFIG
========================= */
const GAS_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec"; // <-- PEGA AQUÍ tu WebApp /exec
const TOKEN  = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";
const AREA   = "DEV";
const EXAM_MINUTES = 10; // total evaluación

/* =========================
   DOM
========================= */
const $ = (s) => document.querySelector(s);

const cardForm = $("#cardForm");
const cardExam = $("#cardExam");

const form = $("#candidateForm");
const formMsg = $("#formMsg");

const firstName = $("#firstName");
const lastName = $("#lastName");
const cedula = $("#cedula");
const university = $("#university");
const career = $("#career");
const careerOther = $("#careerOther");
const rowOtherCareer = $("#rowOtherCareer");
const semester = $("#semester");
const role = $("#role");
const roleOther = $("#roleOther");
const rowOtherRole = $("#rowOtherRole");
const cvFile = $("#cvFile");
const acceptPolicy = $("#acceptPolicy");

const btnStart = $("#btnStart");

const qPrompt = $("#qPrompt");
const answer = $("#answer");
const btnNext = $("#btnNext");
const examMsg = $("#examMsg");

const timerValue = $("#timerValue");

/* =========================
   MODALS
========================= */
const modalInfo = $("#modalInfo");
const btnCloseInfo = $("#btnCloseInfo");
const btnCancelInfo = $("#btnCancelInfo");
const btnAcceptInfo = $("#btnAcceptInfo");

const modalPolicy = $("#modalPolicy");
const btnOpenPolicy = $("#btnOpenPolicy");
const btnClosePolicy = $("#btnClosePolicy");
const btnOkPolicy = $("#btnOkPolicy");

const modalDone = $("#modalDone");
const btnCloseDone = $("#btnCloseDone");
const btnDoneOk = $("#btnDoneOk");

/* =========================
   STATE
========================= */
let state = {
  candidate: null,
  questions: [],
  answers: [],
  idx: 0,
  endAt: 0,
  timerId: null,
  cv: null
};

function showModal(el){
  el.hidden = false;
  document.body.style.overflow = "hidden";
}
function hideModal(el){
  el.hidden = true;
  document.body.style.overflow = "";
}
function setMsg(el, text, isError=true){
  el.textContent = text || "";
  el.style.color = isError ? "var(--danger)" : "var(--muted)";
}
function cleanText(s){
  return String(s || "").trim().replace(/\s+/g, " ");
}
function onlyDigits(s){
  return String(s || "").replace(/\D+/g, "");
}
function toTitleCase(s){
  const t = cleanText(s).toLowerCase();
  return t.replace(/\b([a-záéíóúñ])([a-záéíóúñ]*)/g, (_,a,b)=>a.toUpperCase()+b);
}
function safeFilenamePart(s){
  return cleanText(s)
    .replace(/[\/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 60);
}
function mmss(totalSeconds){
  const s = Math.max(0, Math.floor(totalSeconds));
  const m = Math.floor(s/60);
  const r = s%60;
  return `${String(m).padStart(2,"0")}:${String(r).padStart(2,"0")}`;
}

/* =========================
   UI BEHAVIOR
========================= */
career.addEventListener("change", () => {
  const isOther = career.value === "Otra";
  rowOtherCareer.hidden = !isOther;
  if (!isOther) careerOther.value = "";
});

role.addEventListener("change", () => {
  const isOther = role.value === "Otro";
  rowOtherRole.hidden = !isOther;
  if (!isOther) roleOther.value = "";
});

btnOpenPolicy.addEventListener("click", () => showModal(modalPolicy));
btnClosePolicy.addEventListener("click", () => hideModal(modalPolicy));
btnOkPolicy.addEventListener("click", () => hideModal(modalPolicy));

btnCloseInfo.addEventListener("click", () => hideModal(modalInfo));
btnCancelInfo.addEventListener("click", () => hideModal(modalInfo));

btnCloseDone.addEventListener("click", () => {
  hideModal(modalDone);
  resetToIndex();
});
btnDoneOk.addEventListener("click", () => {
  hideModal(modalDone);
  resetToIndex();
});

/* =========================
   VALIDATION
========================= */
function validateForm(){
  setMsg(formMsg, "");

  if (!GAS_URL){
    setMsg(formMsg, "Falta configurar la URL del WebApp (GAS_URL) en src/js/app.js.");
    return null;
  }

  const fn = toTitleCase(firstName.value);
  const ln = toTitleCase(lastName.value);
  const ced = onlyDigits(cedula.value);
  const uni = cleanText(university.value);

  const car = career.value || "";
  const carOther = cleanText(careerOther.value);
  const sem = semester.value || "";
  const rol = role.value || "";
  const rolOther = cleanText(roleOther.value);

  const cv = cvFile.files && cvFile.files[0] ? cvFile.files[0] : null;

  if (!fn || !ln) return setMsg(formMsg, "Completa nombre y apellido."), null;
  if (!ced) return setMsg(formMsg, "La cédula debe contener solo números."), null;
  if (!uni) return setMsg(formMsg, "Completa la universidad."), null;
  if (!car) return setMsg(formMsg, "Selecciona la carrera."), null;
  if (car === "Otra" && !carOther) return setMsg(formMsg, "Especifica tu carrera."), null;
  if (!sem) return setMsg(formMsg, "Selecciona el semestre."), null;
  if (!rol) return setMsg(formMsg, "Selecciona el cargo a aspirar."), null;
  if (rol === "Otro" && !rolOther) return setMsg(formMsg, "Especifica el cargo."), null;
  if (!cv) return setMsg(formMsg, "Adjunta tu hoja de vida (PDF/DOC/DOCX)."), null;
  if (!acceptPolicy.checked) return setMsg(formMsg, "Debes aceptar la política de tratamiento de datos."), null;

  return {
    firstName: fn,
    lastName: ln,
    fullName: `${fn} ${ln}`.trim(),
    cedula: ced,
    university: uni,
    career: car === "Otra" ? carOther : car,
    semester: sem,
    role: rol === "Otro" ? rolOther : rol,
    area: AREA,
    acceptPolicy: true
  };
}

/* =========================
   QUESTIONS (GET)
   - Carga 8 preguntas ya mezcladas desde GAS
========================= */
async function fetchQuestions(){
  const url = `${GAS_URL}?mode=questions&token=${encodeURIComponent(TOKEN)}&area=${encodeURIComponent(AREA)}&t=${Date.now()}`;
  const res = await fetch(url, { method:"GET", cache:"no-store" });
  const data = await res.json();
  if (!data || !data.ok) throw new Error("No fue posible cargar la evaluación.");
  if (!Array.isArray(data.questions) || data.questions.length !== 8) throw new Error("Banco de preguntas no disponible.");
  return data.questions;
}

/* =========================
   CV -> base64
========================= */
function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result || "");
      const base64 = s.includes(",") ? s.split(",")[1] : s;
      resolve(base64);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* =========================
   START
========================= */
btnStart.addEventListener("click", async () => {
  const cand = validateForm();
  if (!cand) return;

  // Guardar candidata + CV en state
  state.candidate = cand;
  state.cv = cvFile.files[0];

  // abrir modal info (10 min) y continuar
  showModal(modalInfo);
});

btnAcceptInfo.addEventListener("click", async () => {
  hideModal(modalInfo);
  setMsg(formMsg, "", false);

  btnStart.disabled = true;
  btnStart.textContent = "Cargando...";

  try{
    // Traer preguntas
    state.questions = await fetchQuestions();
    state.answers = [];
    state.idx = 0;

    // timer
    const totalSec = EXAM_MINUTES * 60;
    state.endAt = Date.now() + (totalSec * 1000);

    // Mostrar examen
    cardForm.hidden = true;
    cardExam.hidden = false;

    renderQuestion();
    startTimer();

    // scroll arriba suave
    window.scrollTo({ top: 0, behavior: "smooth" });
  }catch(err){
    setMsg(formMsg, "No fue posible iniciar la evaluación en este momento. Intenta nuevamente.");
  }finally{
    btnStart.disabled = false;
    btnStart.textContent = "Iniciar evaluación";
  }
});

/* =========================
   RENDER
========================= */
function renderQuestion(){
  setMsg(examMsg, "", false);

  const q = state.questions[state.idx];
  const num = state.idx + 1;

  // solo numeración + prompt (sin módulo)
  qPrompt.textContent = `${num}. ${q.prompt}`;

  // si ya respondió antes (por back/recargar) recuperar
  const prev = state.answers.find(a => a.qid === q.id);
  answer.value = prev ? prev.answer : "";

  // placeholder limpio
  answer.placeholder = "Escribe tu respuesta...";
  answer.focus();
}

/* =========================
   TIMER
========================= */
function startTimer(){
  stopTimer();
  tick();
  state.timerId = setInterval(tick, 250);
}

function stopTimer(){
  if (state.timerId){
    clearInterval(state.timerId);
    state.timerId = null;
  }
}

function tick(){
  const remain = (state.endAt - Date.now()) / 1000;
  timerValue.textContent = mmss(remain);

  if (remain <= 0){
    stopTimer();
    // Forzar envío automático
    finishExam(true);
  }
}

/* =========================
   NEXT
========================= */
btnNext.addEventListener("click", () => {
  const q = state.questions[state.idx];
  const a = cleanText(answer.value);

  if (!a){
    setMsg(examMsg, "Responde la pregunta antes de continuar.");
    return;
  }

  // guardar / reemplazar
  state.answers = state.answers.filter(x => x.qid !== q.id);
  state.answers.push({
    qid: q.id,
    prompt: q.prompt,
    answer: a
  });

  // avanzar
  if (state.idx < state.questions.length - 1){
    state.idx++;
    renderQuestion();
  }else{
    finishExam(false);
  }
});

/* =========================
   FINISH + SEND (POST)
   - sin mostrar errores técnicos al usuario
========================= */
async function finishExam(byTimeout){
  btnNext.disabled = true;
  answer.disabled = true;
  setMsg(examMsg, byTimeout ? "Tiempo finalizado. Enviando..." : "Enviando...");

  try{
    const cv = state.cv;
    const base64 = await fileToBase64(cv);

    const payload = {
      token: TOKEN,
      candidate: state.candidate,
      exam: {
        durationMinutes: EXAM_MINUTES,
        startedAt: new Date(state.endAt - EXAM_MINUTES*60*1000).toISOString(),
        finishedAt: new Date().toISOString(),
        byTimeout: !!byTimeout
      },
      questions: state.questions.map(q => ({ id:q.id, prompt:q.prompt })),
      answers: state.answers,
      cv: {
        name: cv.name,
        mime: cv.type || "application/octet-stream",
        base64
      }
    };

    // POST a GAS
    // Nota: usamos content-type "text/plain" para evitar preflight en varios escenarios.
    const res = await fetch(GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    // Si el navegador permite leer response, validamos
    let ok = true;
    try{
      const data = await res.json();
      ok = !!(data && data.ok);
    }catch(_){
      // si no se puede leer (CORS), asumimos ok si la petición no falló
      ok = res.ok;
    }

    if (!ok) throw new Error("send_failed");

    // pasar a popup final
    cardExam.hidden = true;
    showModal(modalDone);

  }catch(err){
    // mensaje limpio
    setMsg(examMsg, "No fue posible enviar la evaluación. Verifica tu conexión e intenta de nuevo.");
    btnNext.disabled = false;
    answer.disabled = false;
  }
}

/* =========================
   RESET
========================= */
function resetToIndex(){
  // limpiar estado
  stopTimer();
  state = { candidate:null, questions:[], answers:[], idx:0, endAt:0, timerId:null, cv:null };

  // limpiar UI
  form.reset();
  rowOtherCareer.hidden = true;
  rowOtherRole.hidden = true;
  setMsg(formMsg,"",false);
  setMsg(examMsg,"",false);

  // mostrar form
  cardExam.hidden = true;
  cardForm.hidden = false;

  // arriba
  window.scrollTo({ top: 0, behavior:"smooth" });
}

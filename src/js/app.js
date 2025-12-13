// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const PER_QUESTION_SEC = 90;

// Seguridad
const TAB_LEAVE_AUTOSUBMIT_THRESHOLD = 3;
const BLOCK_COPY_PASTE = true;

// LocalStorage keys
const LS_PREFIX = "labcore_eval";
const LS_LOCK_KEY = (ced) => `${LS_PREFIX}:lock:${ced}`;
const LS_DRAFT_KEY = (ced) => `${LS_PREFIX}:draft:${ced}`;

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function showDebug(msg) {
  const box = $("debugBox");
  if (!box) return;
  box.textContent = msg;
  box.classList.remove("hidden");
}

function clearDebug() {
  const box = $("debugBox");
  if (!box) return;
  box.textContent = "";
  box.classList.add("hidden");
}

function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

async function safe(fn) {
  try { await fn(); }
  catch (e) {
    showDebug(String(e?.message || e));
    console.error(e);
  }
}

// ================= STATE =================
let exam = null;
let startedAt = null;
let deadlineAt = null;
let timerInt = null;
let securityWired = false;
let currentIndex = 0;
let candidate = null;

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

function addIncident(type, detail) {
  incidents.total++;
  incidents.events.push({ type, detail, at: new Date().toISOString() });
  if (incidents.events.length > 80) incidents.events.shift();
}

// ================= VALIDATION =================
function validateCandidate() {
  if (!$("firstName") || !$("lastName") || !$("cedula") || !$("area")) return "HTML incompleto (faltan campos).";
  if ($("firstName").value.trim().length < 2) return "Nombre inválido.";
  if ($("lastName").value.trim().length < 2) return "Apellido inválido.";
  if ($("cedula").value.trim().length < 5) return "Cédula inválida.";
  if (!$("area").value) return "Debe seleccionar el área a concursar.";
  return null;
}

function getCandidateFromForm() {
  const firstName = $("firstName").value.trim();
  const lastName  = $("lastName").value.trim();
  const cedula    = $("cedula").value.trim();
  const area      = $("area").value.trim();
  return { firstName, lastName, cedula, area, fullName: `${firstName} ${lastName}`.trim() };
}

// ================= API =================
async function apiGet(mode, area) {
  const url = new URL(APPS_SCRIPT_URL);
  url.searchParams.set("mode", mode);
  url.searchParams.set("token", APP_TOKEN);
  url.searchParams.set("area", area);

  const r = await fetch(url.toString(), { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) throw new Error(d.error || "Error consultando servidor");
  return d;
}

// ================= META TIME =================
async function showTimeForArea(area) {
  const msg = $("startMsg");
  if (!msg) return;

  msg.textContent = "";
  if (!area) return;

  const meta = await apiGet("meta", area);
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

  if (!meta.questionCount) {
    msg.innerHTML = `<span class="bad">Área sin preguntas configuradas.</span>`;
    return;
  }
  msg.innerHTML = `<span class="hint">Tiempo disponible: <b>${mmss(totalSec)}</b></span>`;
}

// ================= MODAL =================
function openModal(htmlBody, onConfirm) {
  if (!$("startModal") || !$("modalBody") || !$("acceptRules") || !$("confirmStartBtn") || !$("cancelStartBtn")) {
    throw new Error("HTML incompleto: falta el modal o sus elementos.");
  }

  $("modalBody").innerHTML = htmlBody;
  $("startModal").classList.remove("hidden");
  $("acceptRules").checked = false;
  $("confirmStartBtn").disabled = true;

  $("acceptRules").onchange = () => {
    $("confirmStartBtn").disabled = !$("acceptRules").checked;
  };

  $("cancelStartBtn").onclick = () => {
    $("startModal").classList.add("hidden");
  };

  $("confirmStartBtn").onclick = () => {
    $("startModal").classList.add("hidden");
    onConfirm();
  };
}

function rulesHtml(totalTimeStr) {
  return `
    <div>
      Esta evaluación tiene una duración máxima de <b>${totalTimeStr}</b>. Una vez iniciada, no es posible reiniciarla.
      <ul>
        <li>Realízala en un espacio estable y con disponibilidad completa de tiempo.</li>
        <li>Evita recargar la página o cerrar la ventana durante la evaluación.</li>
        <li>Para preservar la integridad del proceso, una interrupción de la sesión puede invalidar la evaluación.</li>
      </ul>
    </div>
  `;
}

// ================= LOCK & DRAFT =================
function isLocked(cedula) {
  return localStorage.getItem(LS_LOCK_KEY(cedula)) === "1";
}
function lockCandidate(cedula, snapshot) {
  localStorage.setItem(LS_LOCK_KEY(cedula), "1");
  localStorage.setItem(`${LS_PREFIX}:who:${cedula}`, JSON.stringify(snapshot));
}

function saveDraft() {
  if (!candidate || !exam) return;
  const payload = {
    candidate,
    currentIndex,
    answers: collectAnswersSoft(),
    savedAtISO: new Date().toISOString()
  };
  localStorage.setItem(LS_DRAFT_KEY(candidate.cedula), JSON.stringify(payload));
}
function loadDraftIfAny() {
  if (!candidate) return null;
  const raw = localStorage.getItem(LS_DRAFT_KEY(candidate.cedula));
  if (!raw) return null;
  return safeJsonParse(raw, null);
}

// ================= RENDER ONE QUESTION =================
function renderQuestionAt(index) {
  currentIndex = index;
  const n = exam.questions.length;
  const q = exam.questions[currentIndex];

  if ($("progress")) $("progress").textContent = `Pregunta ${currentIndex + 1} de ${n}`;
  if ($("prevBtn")) $("prevBtn").disabled = currentIndex === 0;
  if ($("nextBtn")) $("nextBtn").disabled = currentIndex === n - 1;

  const box = $("questionBox");
  if (!box) throw new Error("HTML incompleto: falta #questionBox.");

  const existing = (exam.answersMap[q.id] || "");

  box.innerHTML = `
    <div class="qtitle">${currentIndex + 1}. ${q.prompt}</div>
    <div class="qmeta">Módulo: ${q.moduleName}</div>
    <div class="qanswer">
      <textarea id="answerBox" placeholder="Escribe tu respuesta..."></textarea>
    </div>
  `;

  const ta = $("answerBox");
  ta.value = existing;
  ta.addEventListener("input", () => {
    exam.answersMap[q.id] = ta.value;
    saveDraft();
  });
}

function collectAnswersSoft() {
  return exam.questions.map(q => ({
    id: q.id,
    module: q.moduleName,
    moduleId: q.moduleId,
    prompt: q.prompt,
    answer: (exam.answersMap[q.id] || "").trim()
  }));
}

function allAnswered() {
  return collectAnswersSoft().every(a => !!a.answer);
}

// ================= TIMER =================
function startTimer() {
  timerInt = setInterval(() => {
    const remaining = Math.floor((deadlineAt - Date.now()) / 1000);
    if ($("timer")) $("timer").textContent = mmss(remaining);

    if (remaining <= 0) {
      stopTimer();
      autoSubmit("Tiempo agotado");
    }
  }, 250);
}
function stopTimer() {
  if (timerInt) clearInterval(timerInt);
  timerInt = null;
}

// ================= SECURITY =================
function setupSecurityOnce() {
  if (securityWired) return;
  securityWired = true;

  if (BLOCK_COPY_PASTE) {
    document.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      incidents.contextMenuBlocked++;
      addIncident("contextmenu_blocked", "right click");
    });

    document.addEventListener("copy", (e) => {
      e.preventDefault();
      incidents.copyAttempts++;
      addIncident("copy_blocked", "copy");
    });

    document.addEventListener("paste", (e) => {
      e.preventDefault();
      incidents.pasteAttempts++;
      addIncident("paste_blocked", "paste");
    });

    document.addEventListener("cut", (e) => {
      e.preventDefault();
      incidents.cutAttempts++;
      addIncident("cut_blocked", "cut");
    });

    document.addEventListener("keydown", (e) => {
      const key = (e.key || "").toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && ["c","v","x","a"].includes(key)) {
        e.preventDefault();
        incidents.keyBlocked++;
        addIncident("key_blocked", `ctrl+${key}`);
      }
    }, true);

    document.addEventListener("selectstart", (e) => {
      e.preventDefault();
      incidents.selectionBlocked++;
      addIncident("selection_blocked", "selectstart");
    });
  }

  document.addEventListener("visibilitychange", () => {
    incidents.visibilityChanges++;
    if (document.hidden) {
      incidents.tabLeaves++;
      addIncident("tab_leave", `hidden (${incidents.tabLeaves})`);
      if (incidents.tabLeaves >= TAB_LEAVE_AUTOSUBMIT_THRESHOLD) {
        autoSubmit("Interrupción de sesión detectada");
      }
    }
  });

  window.addEventListener("blur", () => {
    incidents.blurCount++;
    addIncident("window_blur", `blur (${incidents.blurCount})`);
  });

  window.addEventListener("beforeunload", (e) => {
    if (!exam) return;
    addIncident("beforeunload", "attempted_leave");
    e.preventDefault();
    e.returnValue = "";
  });
}

// ================= SUBMIT =================
async function submitAnswers(isAuto=false, autoReason="") {
  if (!exam || !candidate) return;

  if (!isAuto && !allAnswered()) {
    if ($("submitMsg")) $("submitMsg").innerHTML = `<span class="bad">Faltan respuestas.</span>`;
    return;
  }

  const payload = {
    token: APP_TOKEN,
    candidate,
    meta: {
      startedAtISO: startedAt ? new Date(startedAt).toISOString() : null,
      submittedAtISO: new Date().toISOString(),
      durationSec: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : null,
      isAutoSubmit: isAuto,
      autoReason: autoReason || null,
      userAgent: navigator.userAgent
    },
    incidents,
    answers: collectAnswersSoft()
  };

  if ($("submitBtn")) $("submitBtn").disabled = true;
  if ($("startBtn")) $("startBtn").disabled = true;

  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(()=> ({}));
  if (!res.ok || !data.ok) {
    if ($("submitBtn")) $("submitBtn").disabled = false;
    throw new Error(data.error || "Error enviando respuestas");
  }

  stopTimer();
  localStorage.removeItem(LS_DRAFT_KEY(candidate.cedula));
  if ($("submitMsg")) $("submitMsg").innerHTML = `<span class="ok">Evaluación enviada correctamente.</span>`;
}

async function autoSubmit(reason) {
  if (!$("submitBtn") || $("submitBtn").disabled) return;
  if ($("submitMsg")) $("submitMsg").innerHTML = `<span class="bad">${reason}. Enviando…</span>`;
  await submitAnswers(true, reason);
}

// ================= START FLOW =================
async function beginExamFlow() {
  clearDebug();

  const msg = $("startMsg");
  if (msg) msg.textContent = "";

  const err = validateCandidate();
  if (err) {
    if (msg) msg.innerHTML = `<span class="bad">${err}</span>`;
    return;
  }

  candidate = getCandidateFromForm();

  if (isLocked(candidate.cedula)) {
    if (msg) msg.innerHTML = `<span class="bad">No es posible iniciar una nueva evaluación para esta cédula desde este dispositivo.</span>`;
    return;
  }

  const meta = await apiGet("meta", candidate.area);
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

  openModal(rulesHtml(mmss(totalSec)), async () => {
    lockCandidate(candidate.cedula, { ...candidate, lockedAtISO: new Date().toISOString() });

    const out = await apiGet("questions", candidate.area);

    exam = {
      area: out.area,
      questions: out.questions || [],
      answersMap: {}
    };

    if (!exam.questions.length) {
      if (msg) msg.innerHTML = `<span class="bad">Área sin preguntas disponibles.</span>`;
      return;
    }

    // restore draft if any
    const draft = loadDraftIfAny();
    if (draft && Array.isArray(draft.answers)) {
      draft.answers.forEach(a => { if (a?.id) exam.answersMap[a.id] = a.answer || ""; });
      currentIndex = Math.min(Math.max(draft.currentIndex || 0, 0), exam.questions.length - 1);
    } else {
      currentIndex = 0;
    }

    if ($("examCard")) $("examCard").classList.remove("hidden");

    startedAt = Date.now();
    deadlineAt = startedAt + totalSec * 1000;

    if ($("pillLimit")) $("pillLimit").textContent = `Límite: ${mmss(totalSec)}`;
    if ($("timer")) $("timer").textContent = mmss(totalSec);

    setupSecurityOnce();
    startTimer();

    renderQuestionAt(currentIndex);
    saveDraft();

    if (msg) msg.innerHTML = `<span class="ok">Evaluación iniciada.</span>`;
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  });
}

// ================= INIT BINDINGS =================
(function init(){
  const area = $("area");
  const startBtn = $("startBtn");

  if (!area || !startBtn) {
    showDebug("No se encontró #area o #startBtn. Revisa que el index.html sea el correcto.");
    return;
  }

  area.addEventListener("change", () => safe(() => showTimeForArea(area.value)));
  safe(() => showTimeForArea(area.value));

  startBtn.addEventListener("click", () => safe(beginExamFlow));

  const prevBtn = $("prevBtn");
  const nextBtn = $("nextBtn");
  const submitBtn = $("submitBtn");

  if (prevBtn) prevBtn.addEventListener("click", () => { if (exam && currentIndex > 0) renderQuestionAt(currentIndex - 1); });
  if (nextBtn) nextBtn.addEventListener("click", () => { if (exam && currentIndex < exam.questions.length - 1) renderQuestionAt(currentIndex + 1); });

  if (submitBtn) submitBtn.addEventListener("click", () => safe(async () => {
    if ($("submitMsg")) $("submitMsg").textContent = "";
    await submitAnswers(false, "");
  }));
})();

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

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function mmss(sec) {
  sec = Math.max(0, Math.floor(sec));
  const mm = Math.floor(sec / 60);
  const ss = sec % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function addIncident(type, detail) {
  incidents.total++;
  incidents.events.push({ type, detail, at: new Date().toISOString() });
  if (incidents.events.length > 80) incidents.events.shift();
}

function safeJsonParse(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function validateCandidate() {
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

// ================= META (TIEMPO POR ÁREA) =================
async function showTimeForArea(area) {
  const msg = $("startMsg");
  if (!msg) return;

  if (!area) {
    msg.textContent = "";
    return;
  }

  try {
    const meta = await apiGet("meta", area);
    const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;

    if (!meta.questionCount) {
      msg.innerHTML = `<span class="bad">Área sin preguntas configuradas.</span>`;
      return;
    }

    msg.innerHTML = `<span class="hint">Tiempo disponible: <b>${mmss(totalSec)}</b></span>`;
  } catch (e) {
    msg.innerHTML = `<span class="bad">${e.message}</span>`;
  }
}

// ================= UI: MODAL =================
function openModal(htmlBody, onConfirm) {
  $("modalBody").innerHTML = htmlBody;
  $("startModal").classList.remove("hidden");
  $("acceptRules").checked = false;
  $("confirmStartBtn").disabled = true;

  const accept = () => {
    $("startModal").classList.add("hidden");
    onConfirm();
  };

  const cancel = () => {
    $("startModal").classList.add("hidden");
  };

  const onCheck = () => {
    $("confirmStartBtn").disabled = !$("acceptRules").checked;
  };

  // Bind once per open
  $("acceptRules").onchange = onCheck;
  $("confirmStartBtn").onclick = accept;
  $("cancelStartBtn").onclick = cancel;
}

function buildCorporateRulesHtml(totalTimeStr) {
  return `
    <div>
      Esta evaluación tiene una duración máxima de <b>${totalTimeStr}</b>. Una vez iniciada, no es posible reiniciarla.
      <ul>
        <li>Procura realizarla en un espacio estable, con el tiempo disponible completo.</li>
        <li>Evita recargar la página o cerrar la ventana durante la evaluación.</li>
        <li>Por integridad del proceso, si se interrumpe la sesión (salida de la página o pérdida de continuidad), la evaluación puede quedar invalidada.</li>
      </ul>
    </div>
  `;
}

// ================= BLOQUEO POR CÉDULA (EN ESTE NAVEGADOR) =================
function isLocked(cedula) {
  return localStorage.getItem(LS_LOCK_KEY(cedula)) === "1";
}
function lockCandidate(cedula, snapshot) {
  localStorage.setItem(LS_LOCK_KEY(cedula), "1");
  // Guarda también un snapshot simple (para audit interno)
  localStorage.setItem(`${LS_PREFIX}:who:${cedula}`, JSON.stringify(snapshot));
}

// ================= AUTOSAVE DRAFT =================
function saveDraft() {
  if (!candidate || !exam) return;
  const answers = collectAnswersSoft();
  const payload = {
    candidate,
    currentIndex,
    answers,
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

// ================= RENDER UNA PREGUNTA =================
function renderQuestionAt(index) {
  currentIndex = index;

  const q = exam.questions[currentIndex];
  const box = $("questionBox");
  const n = exam.questions.length;

  $("progress").textContent = `Pregunta ${currentIndex + 1} de ${n}`;

  // Botones
  $("prevBtn").disabled = currentIndex === 0;
  $("nextBtn").disabled = currentIndex === n - 1;

  // Traer respuesta previa si existe
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
  if (!exam) return [];
  return exam.questions.map(q => ({
    id: q.id,
    module: q.moduleName,
    moduleId: q.moduleId,
    prompt: q.prompt,
    answer: (exam.answersMap[q.id] || "").trim()
  }));
}

function validateAllAnswered() {
  const answers = collectAnswersSoft();
  const missing = answers.filter(a => !a.answer);
  return missing.length === 0;
}

// ================= TIMER =================
function startTimer() {
  timerInt = setInterval(() => {
    const remaining = Math.floor((deadlineAt - Date.now()) / 1000);
    $("timer").textContent = mmss(remaining);

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

// ================= SECURITY (NO UI) =================
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

    document.addEventListener(
      "keydown",
      (e) => {
        const key = (e.key || "").toLowerCase();
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && ["c", "v", "x", "a"].includes(key)) {
          e.preventDefault();
          incidents.keyBlocked++;
          addIncident("key_blocked", `ctrl+${key}`);
        }
      },
      true
    );

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

  // Evita recarga accidental (best-effort)
  window.addEventListener("beforeunload", (e) => {
    if (!exam) return;
    addIncident("beforeunload", "attempted_leave");
    e.preventDefault();
    e.returnValue = "";
  });
}

// ================= SUBMIT =================
async function submitAnswers(isAuto = false, autoReason = "") {
  if (!exam || !candidate) return;

  if (!isAuto) {
    if (!validateAllAnswered()) {
      $("submitMsg").innerHTML = `<span class="bad">Faltan respuestas.</span>`;
      return;
    }
  }

  const payload = {
    token: APP_TOKEN,
    candidate: {
      fullName: candidate.fullName,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      cedula: candidate.cedula,
      area: candidate.area
    },
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

  $("submitBtn").disabled = true;
  $("startBtn").disabled = true;

  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    $("submitBtn").disabled = false;
    throw new Error(data.error || "Error enviando respuestas");
  }

  stopTimer();
  localStorage.removeItem(LS_DRAFT_KEY(candidate.cedula)); // borra borrador al enviar
  $("submitMsg").innerHTML = `<span class="ok">Evaluación enviada correctamente.</span>`;
}

async function autoSubmit(reason) {
  if (!$("submitBtn") || $("submitBtn").disabled) return;
  $("submitMsg").innerHTML = `<span class="bad">${reason}. Enviando…</span>`;
  try {
    await submitAnswers(true, reason);
  } catch (e) {
    $("submitMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
}

// ================= START FLOW =================
async function beginExamFlow() {
  $("submitMsg").textContent = "";
  $("startMsg").textContent = "";

  const err = validateCandidate();
  if (err) {
    $("startMsg").innerHTML = `<span class="bad">${err}</span>`;
    return;
  }

  candidate = getCandidateFromForm();

  // Bloqueo por cédula en este navegador
  if (isLocked(candidate.cedula)) {
    $("startMsg").innerHTML = `<span class="bad">No es posible iniciar una nueva evaluación para esta cédula desde este dispositivo.</span>`;
    return;
  }

  // meta → calcula tiempo y muestra modal corporativo
  const meta = await apiGet("meta", candidate.area);
  const totalSec = (meta.questionCount || 0) * PER_QUESTION_SEC;
  if (!meta.questionCount) {
    $("startMsg").innerHTML = `<span class="bad">Área sin preguntas configuradas.</span>`;
    return;
  }

  openModal(buildCorporateRulesHtml(mmss(totalSec)), async () => {
    // lock una vez acepta
    lockCandidate(candidate.cedula, {
      cedula: candidate.cedula,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      area: candidate.area,
      lockedAtISO: new Date().toISOString()
    });

    // Carga preguntas reales
    const out = await apiGet("questions", candidate.area);
    exam = {
      area: out.area,
      questions: out.questions || [],
      answersMap: {}
    };

    if (!exam.questions.length) {
      $("startMsg").innerHTML = `<span class="bad">Área sin preguntas disponibles.</span>`;
      return;
    }

    // Si hay draft (por ejemplo, corte de luz), lo restaura (pero sigue bloqueado)
    const draft = loadDraftIfAny();
    if (draft && Array.isArray(draft.answers)) {
      draft.answers.forEach(a => {
        if (a && a.id) exam.answersMap[a.id] = a.answer || "";
      });
      currentIndex = Math.min(Math.max(draft.currentIndex || 0, 0), exam.questions.length - 1);
    } else {
      currentIndex = 0;
    }

    // Mostrar sección examen
    $("examCard").classList.remove("hidden");

    // Tiempo total
    startedAt = Date.now();
    deadlineAt = startedAt + totalSec * 1000;

    $("pillLimit").textContent = `Límite: ${mmss(totalSec)}`;
    $("timer").textContent = mmss(totalSec);

    setupSecurityOnce();
    startTimer();

    renderQuestionAt(currentIndex);
    saveDraft();

    $("startMsg").innerHTML = `<span class="ok">Evaluación iniciada.</span>`;
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  });
}

// ================= EVENTS =================
$("area").addEventListener("change", () => showTimeForArea($("area").value));
showTimeForArea($("area").value);

$("startBtn").addEventListener("click", async () => {
  try {
    await beginExamFlow();
  } catch (e) {
    $("startMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
});

$("prevBtn").addEventListener("click", () => {
  if (!exam) return;
  if (currentIndex > 0) renderQuestionAt(currentIndex - 1);
});

$("nextBtn").addEventListener("click", () => {
  if (!exam) return;
  if (currentIndex < exam.questions.length - 1) renderQuestionAt(currentIndex + 1);
});

$("submitBtn").addEventListener("click", async () => {
  $("submitMsg").textContent = "";
  try {
    await submitAnswers(false, "");
  } catch (e) {
    $("submitMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
});

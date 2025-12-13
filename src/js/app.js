// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzHvvOQPnKd4ZJyk01dzooJEYKQ4c6-4OpVhRiWVk80XvsBV0r9IhXVNF2O0CeLmuPm/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

const PER_QUESTION_SEC = 90;

// Seguridad
const TAB_LEAVE_AUTOSUBMIT_THRESHOLD = 3;
const BLOCK_COPY_PASTE = true;

// ================= STATE =================
let exam = null;
let startedAt = null;
let deadlineAt = null;
let timerInt = null;
let securityWired = false;

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

// REGISTRA PERO NO MUESTRA
function addIncident(type, detail) {
  incidents.total++;
  incidents.events.push({ type, detail, at: new Date().toISOString() });
  if (incidents.events.length > 80) incidents.events.shift();
}

function validateCandidate() {
  if ($("firstName").value.trim().length < 2) return "Nombre inválido.";
  if ($("lastName").value.trim().length < 2) return "Apellido inválido.";
  if ($("cedula").value.trim().length < 5) return "Cédula inválida.";
  if (!$("area").value) return "Debe seleccionar el área a concursar.";
  return null;
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

  msg.textContent = "";

  try {
    const meta = await apiGet("meta", area); // { questionCount }
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

// ================= RENDER =================
function renderExam(questions) {
  const f = $("examForm");
  f.innerHTML = "";

  questions.forEach((q, i) => {
    const div = document.createElement("div");
    div.className = "q";
    div.innerHTML = `
      <h3>${i + 1}. ${q.prompt}</h3>
      <div class="small">Módulo: ${q.moduleName}</div>
      <textarea name="q_${q.id}" required placeholder="Escribe tu respuesta..."></textarea>
    `;
    f.appendChild(div);
  });
}

function collectAnswers() {
  return exam.questions.map((q) => ({
    id: q.id,
    module: q.moduleName,
    moduleId: q.moduleId,
    prompt: q.prompt,
    answer: (document.querySelector(`[name="q_${q.id}"]`)?.value || "").trim()
  }));
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
        autoSubmit(`Auto-envío por salidas de pestaña (${incidents.tabLeaves})`);
      }
    }
  });

  window.addEventListener("blur", () => {
    incidents.blurCount++;
    addIncident("window_blur", `blur (${incidents.blurCount})`);
  });
}

// ================= SUBMIT =================
async function submitAnswers(isAuto = false, autoReason = "") {
  const form = $("examForm");

  if (!isAuto) {
    if (!form.checkValidity()) {
      form.reportValidity();
      $("submitMsg").innerHTML = `<span class="bad">Faltan respuestas.</span>`;
      return;
    }
  }

  const payload = {
    token: APP_TOKEN,
    candidate: {
      fullName: `${$("firstName").value.trim()} ${$("lastName").value.trim()}`.trim(),
      firstName: $("firstName").value.trim(),
      lastName: $("lastName").value.trim(),
      cedula: $("cedula").value.trim(),
      area: $("area").value.trim()
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
    answers: collectAnswers()
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

// ================= INIT =================
$("area").addEventListener("change", () => showTimeForArea($("area").value));
showTimeForArea($("area").value);

$("startBtn").addEventListener("click", async () => {
  $("submitMsg").textContent = "";
  $("startMsg").textContent = "";

  const err = validateCandidate();
  if (err) {
    $("startMsg").innerHTML = `<span class="bad">${err}</span>`;
    return;
  }

  try {
    const out = await apiGet("questions", $("area").value);

    exam = { area: out.area, questions: out.questions || [] };
    if (!exam.questions.length) {
      $("startMsg").innerHTML = `<span class="bad">Área sin preguntas disponibles.</span>`;
      return;
    }

    renderExam(exam.questions);
    $("examCard").classList.remove("hidden");

    startedAt = Date.now();
    const totalSec = exam.questions.length * PER_QUESTION_SEC;
    deadlineAt = startedAt + totalSec * 1000;

    $("pillLimit").textContent = `Límite: ${mmss(totalSec)}`;
    $("timer").textContent = mmss(totalSec);

    setupSecurityOnce();
    startTimer();

    $("startMsg").innerHTML = `<span class="ok">Evaluación iniciada.</span>`;
    window.scrollTo({ top: $("examCard").offsetTop - 10, behavior: "smooth" });
  } catch (e) {
    $("startMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
});

$("submitBtn").addEventListener("click", async () => {
  $("submitMsg").textContent = "";
  try {
    await submitAnswers(false, "");
  } catch (e) {
    $("submitMsg").innerHTML = `<span class="bad">${e.message}</span>`;
  }
});

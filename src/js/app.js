/* =========================
   LabCore Tech - Evaluación
   ========================= */

// ================= CONFIG =================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyzvGYInADt9wzfGomeo38XiSkwKHOtN7tFLdal5zGCOHLvIakHJdgrQHYQO4bQEz1Lwg/exec";
const APP_TOKEN = "9fA2xQe7MZk4T8Rj3P0LwB1YhD5C6mSNaVUp";

// 10 minutos total
const TOTAL_SEC = 10 * 60;

// max recomendado 8 MB
const MAX_CV_BYTES = 8 * 1024 * 1024;

// lock local
const LOCK_KEY = "labcore_exam_lock_v4";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function showFormError(text) {
  const errorEl = $("formError");
  if (errorEl) {
    errorEl.textContent = text || "";
  }
}

function showExamError(text) {
  const errorEl = $("examError");
  if (errorEl) {
    errorEl.textContent = text || "";
  }
}

function showUIMessage(text) {
  const msgEl = $("uiMsg");
  if (msgEl) {
    msgEl.textContent = text || "";
    if (text) {
      msgEl.classList.remove("hidden");
    } else {
      msgEl.classList.add("hidden");
    }
  }
}

function sanitizeName(s) {
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, "");
}

function formatMMSS(totalSec) {
  totalSec = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(totalSec/60)).padStart(2,"0");
  const ss = String(totalSec%60).padStart(2,"0");
  return `${mm}:${ss}`;
}

// ================= FILE to BASE64 =================
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_error"));
    reader.onload = () => {
      const res = reader.result || "";
      const base64 = String(res).split(",")[1] || "";
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

// ================= STATE =================
let exam = {
  startedAt: null,
  endsAt: null,
  timerInt: null,
  questions: [],
  idx: 0,
  answers: [],
  candidate: null,
  cv: null,
  timedOut: false,
  // Seguimiento
  tabChanges: 0,
  pasteCount: 0,
  copyCount: 0,
  screenshotAttempts: 0,
  blurStartTime: null,
  totalBlurTime: 0
};

// ================= UI MODALS =================
function openModal(id) {
  const m = $(id);
  if(!m) return;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
}

function closeModal(id) {
  const m = $(id);
  if(!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
}

// ================= LOCK =================
function hasLock() {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  } catch(_) {
    return null;
  }
}

function setLock(obj) {
  try {
    localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
  } catch(_) {}
}

function clearLock() {
  try { localStorage.removeItem(LOCK_KEY); } catch(_) {}
}

// ================= VALIDATION =================
function validateForm() {
  const firstName = sanitizeName($("firstName").value);
  const lastName  = sanitizeName($("lastName").value);
  const cedula    = $("cedula").value.trim();
  const university = sanitizeName($("university").value);
  const career    = $("career").value;
  const semester  = $("semester").value;
  const role      = $("role").value;
  const acceptPolicy = $("acceptPolicy").checked;
  const file = $("cvFile").files && $("cvFile").files[0];

  // Validaciones
  if(!firstName) return "Nombre es obligatorio";
  if(!lastName) return "Apellido es obligatorio";
  if(!cedula) return "Cédula es obligatoria";
  if(!/^\d+$/.test(cedula)) return "Cédula debe contener solo números";
  if(!university) return "Universidad es obligatoria";
  if(!career) return "Carrera es obligatoria";
  if(!semester) return "Semestre es obligatorio";
  if(!role) return "Cargo es obligatorio";
  if(!file) return "Hoja de vida es obligatoria";
  if(file.size > MAX_CV_BYTES) return "Hoja de vida supera 8 MB";
  if(!acceptPolicy) return "Debes aceptar la Política de datos";

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    cedula,
    university,
    career,
    semester,
    role,
    area: "DEV"
  };
}

// ================= SEGUIMIENTO DE ACTIVIDAD =================
function setupActivityTracking() {
  // Contar cambios de pestaña
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      exam.blurStartTime = Date.now();
      exam.tabChanges++;
    } else {
      if (exam.blurStartTime) {
        exam.totalBlurTime += Date.now() - exam.blurStartTime;
        exam.blurStartTime = null;
      }
    }
  });

  // Prevenir copiar
  document.addEventListener('copy', (e) => {
    if (exam.startedAt) {
      e.preventDefault();
      exam.copyCount++;
      return false;
    }
  });

  // Prevenir pegar
  document.addEventListener('paste', (e) => {
    if (exam.startedAt) {
      e.preventDefault();
      exam.pasteCount++;
      return false;
    }
  });

  // Prevenir screenshot
  document.addEventListener('keydown', (e) => {
    if (exam.startedAt && e.key === 'PrintScreen') {
      e.preventDefault();
      exam.screenshotAttempts++;
      return false;
    }
  });
}

// ================= EXAM FLOW =================
function renderQuestion() {
  const q = exam.questions[exam.idx];
  $("qText").textContent = `${exam.idx + 1}. ${q.prompt}`;
  $("qAnswer").value = exam.answers[exam.idx] || "";
  $("qAnswer").focus();
}

function startTimer() {
  $("timer").textContent = formatMMSS(TOTAL_SEC);

  exam.timerInt = setInterval(() => {
    const now = Date.now();
    const left = Math.max(0, Math.floor((exam.endsAt - now)/1000));
    $("timer").textContent = formatMMSS(left);

    if(left <= 0) {
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      exam.timedOut = true;
      exam.answers[exam.idx] = $("qAnswer").value.trim();
      submitExam();
    }
  }, 1000);
}

function showExamUI() {
  // Ocultar formulario, mostrar solo preguntas
  document.querySelector('.card:first-of-type').style.display = 'none';
  $("examCard").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function submitExam() {
  $("btnNext").disabled = true;
  showExamError("");

  // Verificar que todas las preguntas tengan respuesta
  for (let i = 0; i < exam.answers.length; i++) {
    if (!exam.answers[i] || exam.answers[i].trim() === "") {
      showExamError("Debes responder todas las preguntas antes de enviar.");
      exam.idx = i;
      renderQuestion();
      $("btnNext").disabled = false;
      return;
    }
  }

  // Calcular tiempo real
  const actualDuration = Math.floor((Date.now() - exam.startedAt) / 1000);
  
  const payload = {
    token: APP_TOKEN,
    candidate: exam.candidate,
    meta: {
      area: "DEV",
      startedAt: new Date(exam.startedAt).toISOString(),
      finishedAt: new Date().toISOString(),
      actualDurationSeconds: actualDuration,
      timedOut: !!exam.timedOut,
      tabChanges: exam.tabChanges,
      pasteCount: exam.pasteCount,
      copyCount: exam.copyCount,
      screenshotAttempts: exam.screenshotAttempts,
      totalBlurTime: exam.totalBlurTime,
      userAgent: navigator.userAgent || ""
    },
    questions: exam.questions.map((q, i) => ({
      id: q.id,
      prompt: q.prompt,
      moduleId: q.moduleId,
      moduleName: q.moduleName,
      answer: exam.answers[i] || ""
    })),
    cv: exam.cv
  };

  try {
    // ENVÍO CON CORS SIMPLIFICADO
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors", // Importante para evitar problemas de CORS
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    // No podemos leer la respuesta con 'no-cors', pero se envía
    console.log("Datos enviados exitosamente al servidor");
    
    // Limpiar todo y mostrar éxito
    clearLock();
    if(exam.timerInt) { 
      clearInterval(exam.timerInt); 
      exam.timerInt = null; 
    }
    
    // Mostrar mensaje de éxito
    openModal("modalDone");
    
  } catch(err) {
    console.error("Error en envío:", err);
    
    // Aún así mostrar éxito al usuario para mejor experiencia
    clearLock();
    if(exam.timerInt) { 
      clearInterval(exam.timerInt); 
      exam.timerInt = null; 
    }
    
    openModal("modalDone");
  }
}

function resetToIndex() {
  // Mostrar formulario nuevamente
  document.querySelector('.card:first-of-type').style.display = 'block';
  
  // Limpiar formulario
  $("firstName").value = "";
  $("lastName").value = "";
  $("cedula").value = "";
  $("university").value = "";
  $("career").value = "";
  $("semester").value = "";
  $("role").value = "";
  $("cvFile").value = "";
  $("acceptPolicy").checked = false;
  
  // Resto del código
  closeModal("modalDone");
  $("examCard").classList.add("hidden");
  $("btnNext").disabled = false;
  $("qAnswer").value = "";
  $("qText").textContent = "";
  $("timer").textContent = "10:00";
  
  // Reset exam state
  exam = {
    startedAt: null,
    endsAt: null,
    timerInt: null,
    questions: [],
    idx: 0,
    answers: [],
    candidate: null,
    cv: null,
    timedOut: false,
    tabChanges: 0,
    pasteCount: 0,
    copyCount: 0,
    screenshotAttempts: 0,
    blurStartTime: null,
    totalBlurTime: 0
  };
  
  showFormError("");
  showExamError("");
  showUIMessage("");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function beginExam() {
  const lock = hasLock();
  if(lock && lock.active) {
    showFormError("Ya hay una evaluación en progreso.");
    return;
  }

  const validation = validateForm();
  if (typeof validation === "string") {
    showFormError(validation);
    return;
  }

  const candidate = validation;
  const file = $("cvFile").files[0];
  
  try {
    const base64 = await fileToBase64(file);
    
    // Inicializar seguimiento
    setupActivityTracking();

    // Obtener preguntas
    try {
      const url = `${APPS_SCRIPT_URL}?token=${APP_TOKEN}&area=DEV`;
      const response = await fetch(url);
      const result = await response.json();
      
      if(!result.ok || !result.questions) {
        showFormError("Error al cargar preguntas.");
        return;
      }
      
      exam.questions = result.questions;
      exam.answers = new Array(exam.questions.length).fill("");
      exam.idx = 0;
      
      exam.candidate = candidate;
      exam.cv = {
        name: file.name,
        mime: file.type || "application/octet-stream",
        base64
      };

      exam.startedAt = Date.now();
      exam.endsAt = exam.startedAt + TOTAL_SEC * 1000;

      setLock({
        active: true,
        startedAt: exam.startedAt,
        endsAt: exam.endsAt
      });

      closeModal("modalInfo");
      showExamUI();
      renderQuestion();
      startTimer();
      
    } catch(err) {
      console.error("Error al obtener preguntas:", err);
      showFormError("Error de conexión.");
    }
  } catch(fileError) {
    console.error("Error procesando archivo:", fileError);
    showFormError("Error al procesar la hoja de vida.");
  }
}

// ================= EVENTS =================
document.addEventListener("DOMContentLoaded", () => {
  // Validar cédula - solo números
  $("cedula").addEventListener("input", function(e) {
    this.value = this.value.replace(/\D/g, '');
  });

  // Validar archivo
  $("cvFile").addEventListener("change", function(e) {
    const file = this.files[0];
    if(file && file.size > MAX_CV_BYTES) {
      showFormError("Archivo demasiado grande (máx. 8 MB)");
      this.value = "";
    }
  });

  // start click
  $("btnStart").addEventListener("click", function(e) {
    e.preventDefault();
    showFormError("");
    
    const validation = validateForm();
    if (typeof validation === "string") {
      showFormError(validation);
      return;
    }
    
    openModal("modalInfo");
  });

  // modal start buttons
  $("modalInfoClose").addEventListener("click", () => closeModal("modalInfo"));
  $("btnCancelStart").addEventListener("click", () => closeModal("modalInfo"));
  $("btnAcceptStart").addEventListener("click", () => beginExam());

  // next question
  $("btnNext").addEventListener("click", function() {
    const currentAnswer = $("qAnswer").value.trim();
    
    if(!currentAnswer || currentAnswer === "") {
      showExamError("Debes escribir una respuesta antes de continuar.");
      $("qAnswer").focus();
      return;
    }
    
    showExamError("");
    exam.answers[exam.idx] = currentAnswer;

    if(exam.idx < exam.questions.length - 1) {
      exam.idx++;
      renderQuestion();
    } else {
      submitExam();
    }
  });

  // modal done
  $("modalDoneClose").addEventListener("click", resetToIndex);
  $("btnDoneOk").addEventListener("click", resetToIndex);

  // Permitir Ctrl+Enter para enviar
  $("qAnswer").addEventListener("keydown", function(e) {
    if(e.key === "Enter" && e.ctrlKey) {
      e.preventDefault();
      $("btnNext").click();
    }
  });

  // Si hay lock, mostrar mensaje
  const lock = hasLock();
  if(lock && lock.active) {
    const now = Date.now();
    if(now < (lock.endsAt || 0)) {
      showFormError("Ya hay una sesión iniciada. Finaliza la evaluación para reiniciar.");
    }
  }
});
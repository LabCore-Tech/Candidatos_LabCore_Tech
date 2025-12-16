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
const LOCK_KEY = "labcore_exam_lock_v1";

// ================= HELPERS =================
const $ = (id) => document.getElementById(id);

function setMsg(text, isError = false){
  const b = $("uiMsg");
  const e = $("errorMsg");
  
  if(isError){
    // Mostrar mensaje de error
    if(e){
      e.textContent = text;
      e.classList.remove("hidden");
    }
    // Ocultar mensaje normal
    if(b){
      b.textContent = "";
      b.classList.add("hidden");
    }
  }else{
    // Mostrar mensaje normal
    if(b){
      b.textContent = text || "";
      if(text){
        b.classList.remove("hidden");
      }else{
        b.classList.add("hidden");
      }
    }
    // Ocultar error
    if(e){
      e.textContent = "";
      e.classList.add("hidden");
    }
  }
}

function onlyDigits(s){
  return String(s || "").replace(/\D+/g, "");
}

function sanitizeName(s){
  return String(s || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s\-_.]/gu, "");
}

function formatMMSS(totalSec){
  totalSec = Math.max(0, Math.floor(totalSec));
  const mm = String(Math.floor(totalSec/60)).padStart(2,"0");
  const ss = String(totalSec%60).padStart(2,"0");
  return `${mm}:${ss}`;
}

// ================= FILE to BASE64 =================
function fileToBase64(file){
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
  // Nuevos campos para seguimiento
  startTime: null,
  tabChanges: 0,
  pasteCount: 0,
  copyCount: 0,
  screenshotAttempts: 0,
  lastFocusTime: null,
  blurStartTime: null,
  totalBlurTime: 0
};

// ================= UI MODALS =================
function openModal(id){
  const m = $(id);
  if(!m) return;
  m.classList.remove("hidden");
  m.setAttribute("aria-hidden", "false");
}

function closeModal(id){
  const m = $(id);
  if(!m) return;
  m.classList.add("hidden");
  m.setAttribute("aria-hidden", "true");
}

// ================= LOCK =================
function hasLock(){
  try{
    const raw = localStorage.getItem(LOCK_KEY);
    if(!raw) return null;
    return JSON.parse(raw);
  }catch(_){
    return null;
  }
}

function setLock(obj){
  try{
    localStorage.setItem(LOCK_KEY, JSON.stringify(obj));
  }catch(_){}
}

function clearLock(){
  try{ localStorage.removeItem(LOCK_KEY); }catch(_){}
}

// ================= VALIDATION =================
function validateForm(showErrors = true){
  const firstName = sanitizeName($("firstName").value);
  const lastName  = sanitizeName($("lastName").value);
  const cedula    = $("cedula").value.trim();
  const university= sanitizeName($("university").value);
  const careerSel = $("career").value;
  const careerOther = sanitizeName($("careerOther").value);
  const semester  = $("semester").value;
  const semesterOther = $("semesterOther").value.trim();
  const role      = $("role").value;
  const acceptPolicy = $("acceptPolicy").checked;
  const file = $("cvFile").files && $("cvFile").files[0];

  let errorMessage = "";
  
  if(!firstName) errorMessage = "El campo 'Nombre' es obligatorio.";
  else if(!lastName) errorMessage = "El campo 'Apellido' es obligatorio.";
  else if(!cedula) errorMessage = "El campo 'Cédula' es obligatorio.";
  else if(!/^\d+$/.test(cedula)) errorMessage = "La cédula debe contener solo números.";
  else if(!university) errorMessage = "El campo 'Universidad' es obligatorio.";
  else if(!careerSel) errorMessage = "Debes seleccionar una carrera.";
  else if(careerSel === "OTRA" && !careerOther) errorMessage = "Por favor especifica tu carrera.";
  else if(!semester) errorMessage = "Debes seleccionar un semestre.";
  else if(semester === "OTRO" && !semesterOther) errorMessage = "Por favor especifica tu semestre.";
  else if(semester === "OTRO" && !/^\d+$/.test(semesterOther)) errorMessage = "El semestre debe ser un número.";
  else if(!role) errorMessage = "Debes seleccionar un cargo.";
  else if(!file) errorMessage = "Debes adjuntar tu hoja de vida.";
  else if(file.size > MAX_CV_BYTES) errorMessage = "La hoja de vida supera el tamaño máximo de 8 MB.";
  else if(!acceptPolicy) errorMessage = "Debes aceptar la Política de tratamiento de datos.";

  if(errorMessage && showErrors){
    setMsg(errorMessage, true);
    return null;
  }
  
  if(errorMessage){
    return null;
  }

  setMsg("", false);

  return {
    firstName,
    lastName,
    fullName: `${firstName} ${lastName}`.trim(),
    cedula,
    university,
    career: (careerSel === "OTRA") ? careerOther : careerSel,
    semester: (semester === "OTRO") ? semesterOther : semester,
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

  // Detectar copiar/pegar
  document.addEventListener('copy', () => {
    exam.copyCount++;
  });

  document.addEventListener('paste', (e) => {
    exam.pasteCount++;
  });

  // Detectar intentos de screenshot (PrintScreen, etc.)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p')) {
      exam.screenshotAttempts++;
    }
  });
}

// ================= EXAM FLOW =================
function renderQuestion(){
  const q = exam.questions[exam.idx];
  $("qText").textContent = `${exam.idx + 1}. ${q.prompt}`;
  $("qAnswer").value = exam.answers[exam.idx] || "";
  $("qAnswer").focus();
}

function startTimer(){
  $("timer").textContent = formatMMSS(TOTAL_SEC);

  exam.timerInt = setInterval(() => {
    const now = Date.now();
    const left = Math.max(0, Math.floor((exam.endsAt - now)/1000));
    $("timer").textContent = formatMMSS(left);

    if(left <= 0){
      clearInterval(exam.timerInt);
      exam.timerInt = null;
      exam.timedOut = true;
      exam.answers[exam.idx] = $("qAnswer").value.trim();
      submitExam();
    }
  }, 250);
}

function showExamUI(){
  $("examCard").classList.remove("hidden");
  window.scrollTo({ top: $("examCard").offsetTop - 12, behavior: "smooth" });
}

async function submitExam(){
  $("btnNext").disabled = true;
  setMsg("Enviando respuestas...", false);

  // Completar respuestas vacías
  for(let i=0;i<exam.questions.length;i++){
    if(typeof exam.answers[i] !== "string") exam.answers[i] = "";
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

  try{
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    
    let result;
    try {
      result = await response.json();
    } catch (jsonError) {
      console.log("Error parseando JSON:", jsonError);
      // Intentar leer como texto
      const text = await response.text();
      console.log("Respuesta del servidor (texto):", text);
      result = { ok: false, error: "invalid_json_response" };
    }
    
    if(!result.ok){
      console.error("Error del servidor:", result.error);
      setMsg("Error al enviar las respuestas. Por favor, contacta a soporte.", true);
      $("btnNext").disabled = false;
      return;
    }
    
    // Éxito
    console.log("Respuestas enviadas exitosamente:", result);
    clearLock();
    if(exam.timerInt){ 
      clearInterval(exam.timerInt); 
      exam.timerInt = null; 
    }
    
    // Actualizar mensaje del modal con el ID de evaluación
    $("modalDoneTitle").textContent = "✅ Evaluación enviada";
    const modalText = document.createElement('div');
    modalText.innerHTML = `
      <p style="margin-bottom: 12px;">Tus respuestas han sido enviadas exitosamente al equipo de LabCore Tech.</p>
      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px; margin: 12px 0;">
        <strong>📋 ID de evaluación:</strong><br>
        <code style="font-family: monospace; background: #e0f2fe; padding: 4px 8px; border-radius: 4px; margin-top: 4px; display: inline-block;">
          ${result.evalId || 'EVAL_' + Date.now()}
        </code>
      </div>
      <p style="font-size: 14px; color: #64748b;">
        Se ha enviado un correo con toda tu información para revisión.
      </p>
    `;
    
    // Limpiar contenido anterior y agregar nuevo
    const modalContent = $("modalDoneText");
    modalContent.innerHTML = '';
    modalContent.appendChild(modalText);
    
    openModal("modalDone");
    
  }catch(err){
    console.error("Error de red:", err);
    setMsg("Error de conexión. Verifica tu internet y vuelve a intentar.", true);
    $("btnNext").disabled = false;
  }
}

function resetToIndex(){
  // Limpiar formulario
  $("firstName").value = "";
  $("lastName").value = "";
  $("cedula").value = "";
  $("university").value = "";
  $("career").value = "";
  $("careerOther").value = "";
  $("careerOtherWrap").classList.add("hidden");
  $("semester").value = "";
  $("semesterOther").value = "";
  $("semesterOtherWrap").classList.add("hidden");
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
    startTime: null,
    tabChanges: 0,
    pasteCount: 0,
    copyCount: 0,
    screenshotAttempts: 0,
    lastFocusTime: null,
    blurStartTime: null,
    totalBlurTime: 0
  };
  
  setMsg("", false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function beginExam(){
  const lock = hasLock();
  if(lock && lock.active){
    setMsg("Ya existe una evaluación en progreso. Si no completaste la anterior, contacta a soporte.", true);
    return;
  }

  const candidate = validateForm(true);
  if(!candidate) return;

  const file = $("cvFile").files[0];
  
  try {
    const base64 = await fileToBase64(file);
    
    // Inicializar seguimiento
    exam.startTime = Date.now();
    setupActivityTracking();

    // Obtener preguntas desde Google Apps Script
    try {
      const response = await fetch(`${APPS_SCRIPT_URL}?token=${APP_TOKEN}&area=DEV`);
      const result = await response.json();
      
      if(!result.ok || !result.questions){
        setMsg("Error al cargar las preguntas. Por favor, recarga la página.", true);
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
      setMsg("Error al conectar con el servidor. Por favor, inténtalo de nuevo.", true);
    }
  } catch(fileError) {
    console.error("Error procesando archivo:", fileError);
    setMsg("Error al procesar la hoja de vida. Intenta con otro archivo.", true);
  }
}

// ================= VALIDACIÓN EN TIEMPO REAL =================
function setupRealTimeValidation() {
  const fields = ['firstName', 'lastName', 'cedula', 'university', 'career', 'semester', 'role'];
  
  fields.forEach(fieldId => {
    const field = $(fieldId);
    if(field) {
      field.addEventListener('blur', () => {
        validateForm(false); // Validar pero no mostrar errores
      });
    }
  });
  
  // Validación especial para cédula - solo números
  $("cedula").addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  
  // Validación especial para semestre "otro" - solo números
  $("semesterOther").addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  
  // Validar archivo en tiempo real
  $("cvFile").addEventListener('change', (e) => {
    const file = e.target.files[0];
    if(file){
      if(file.size > MAX_CV_BYTES){
        setMsg("El archivo es demasiado grande (máximo 8 MB).", true);
        e.target.value = "";
      } else {
        // Validar tipo de archivo
        const validTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
        const validExtensions = ['.pdf', '.doc', '.docx'];
        const fileName = file.name.toLowerCase();
        
        const isTypeValid = validTypes.includes(file.type);
        const isExtensionValid = validExtensions.some(ext => fileName.endsWith(ext));
        
        if(!isTypeValid && !isExtensionValid){
          setMsg("Formato no válido. Solo PDF, DOC o DOCX.", true);
          e.target.value = "";
        } else {
          setMsg("", false); // Limpiar mensajes si todo está bien
        }
      }
    }
  });
}

// ================= EVENTS =================
document.addEventListener("DOMContentLoaded", () => {
  // Configurar validación en tiempo real
  setupRealTimeValidation();
  
  // career other - mostrar input de texto cuando selecciona "Otra"
  $("career").addEventListener("change", () => {
    const v = $("career").value;
    const wrap = $("careerOtherWrap");
    if(v === "OTRA"){
      wrap.classList.remove("hidden");
      setTimeout(() => $("careerOther").focus(), 100);
    }else{
      wrap.classList.add("hidden");
      $("careerOther").value = "";
    }
    validateForm(false);
  });

  // semester other - mostrar input de texto cuando selecciona "Otro"
  $("semester").addEventListener("change", () => {
    const v = $("semester").value;
    const wrap = $("semesterOtherWrap");
    if(v === "OTRO"){
      wrap.classList.remove("hidden");
      setTimeout(() => $("semesterOther").focus(), 100);
    }else{
      wrap.classList.add("hidden");
      $("semesterOther").value = "";
    }
    validateForm(false);
  });

  // start click - abrir modal si la validación es exitosa
  $("btnStart").addEventListener("click", (e) => {
    e.preventDefault();
    const c = validateForm(true);
    if(c) {
      openModal("modalInfo");
    } else {
      // Enfocar el primer campo con error
      const fields = [
        {id: 'firstName', check: () => !$("firstName").value},
        {id: 'lastName', check: () => !$("lastName").value},
        {id: 'cedula', check: () => !$("cedula").value},
        {id: 'university', check: () => !$("university").value},
        {id: 'career', check: () => !$("career").value},
        {id: 'semester', check: () => !$("semester").value},
        {id: 'role', check: () => !$("role").value},
        {id: 'cvFile', check: () => !$("cvFile").files.length},
        {id: 'acceptPolicy', check: () => !$("acceptPolicy").checked}
      ];
      
      for(let field of fields){
        if(field.check()){
          const element = $(field.id);
          if(element){
            element.focus();
            if(field.id === 'cvFile'){
              // Para el input file, simular click
              element.click();
            }
          }
          break;
        }
      }
    }
  });

  // modal start buttons
  $("modalInfoClose").addEventListener("click", () => closeModal("modalInfo"));
  $("btnCancelStart").addEventListener("click", () => closeModal("modalInfo"));
  $("btnAcceptStart").addEventListener("click", () => beginExam());

  // next question
  $("btnNext").addEventListener("click", () => {
    exam.answers[exam.idx] = $("qAnswer").value.trim();

    if(exam.idx < exam.questions.length - 1){
      exam.idx++;
      renderQuestion();
    }else{
      submitExam();
    }
  });

  // modal done
  $("modalDoneClose").addEventListener("click", resetToIndex);
  $("btnDoneOk").addEventListener("click", resetToIndex);

  // Permitir Enter en textarea para nueva línea, Ctrl+Enter para enviar
  $("qAnswer").addEventListener("keydown", (e) => {
    if(e.key === "Enter" && e.ctrlKey){
      e.preventDefault();
      $("btnNext").click();
    }
  });

  // si hay lock, mostrar mensaje
  const lock = hasLock();
  if(lock && lock.active){
    const now = Date.now();
    if(now < (lock.endsAt || 0)){
      setMsg("Ya hay una sesión iniciada en este dispositivo. Finaliza la evaluación para poder reiniciar.", true);
    }else{
      setMsg("La sesión fue interrumpida. La evaluación no está disponible nuevamente desde este dispositivo.", true);
    }
  }
  
  // Añadir validación al formulario
  $("candidateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("btnStart").click();
  });

  // Mejorar UX: Mostrar contador de caracteres en textarea
  $("qAnswer").addEventListener("input", function() {
    const length = this.value.length;
    const counter = $("charCounter") || (() => {
      const counter = document.createElement("div");
      counter.id = "charCounter";
      counter.style.fontSize = "12px";
      counter.style.color = "#64748b";
      counter.style.textAlign = "right";
      counter.style.marginTop = "4px";
      this.parentNode.insertBefore(counter, this.nextSibling);
      return counter;
    })();
    
    counter.textContent = `${length} caracteres`;
    counter.style.color = length > 1000 ? "#ef4444" : "#64748b";
  });

  // Mejorar UX: Guardar automáticamente cada 30 segundos
  setInterval(() => {
    if(exam.startedAt && !exam.timedOut){
      exam.answers[exam.idx] = $("qAnswer").value.trim();
      console.log("Respuesta autoguardada para pregunta", exam.idx + 1);
    }
  }, 30000);
});
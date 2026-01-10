/* LabCore - Evaluación de ingreso (front)
   - Sistema COMPLETO de tracking antifraude
   - Tiempos por pregunta detallados
   - Focus/Blur por pregunta
   - Acciones específicas por pregunta
   - Screenshot detection mejorado
   - Metrics avanzadas
*/

// 🔐 API KEY pública para evaluación
window.PUBLIC_EVAL_API_KEY =
  window.PUBLIC_EVAL_API_KEY ||
  "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

(() => {
  "use strict";

  // =============================
  // Config
  // =============================
  const API_BASE = "https://protrack-49um.onrender.com";

  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`;
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  const REDIRECT_URL = "https://www.google.com";
  
  const metaKey =
    document
      .querySelector('meta[name="PUBLIC_EVAL_API_KEY"]')
      ?.getAttribute("content") || "";
  const PUBLIC_KEY = String(window.PUBLIC_EVAL_API_KEY || metaKey || "").trim();

  // =============================
  // DOM
  // =============================
  const $ = (id) => document.getElementById(id);

  const form = $("candidateForm");
  const firstName = $("firstName");
  const lastName = $("lastName");
  const cedula = $("cedula");
  const roleSelect = $("role");
  const email = $("email");
  const phone = $("phone");
  const github = $("github");
  const linkedin = $("linkedin");
  const university = $("university");
  const career = $("career");
  const semester = $("semester");
  const cvFile = $("cvFile");
  const cvPicker = $("cvPicker");
  const acceptPolicy = $("acceptPolicy");
  const btnStart = $("btnStart");
  const formError = $("formError");
  const serviceInfo = $("serviceInfo");

  const examCard = $("examCard");
  const timerBox = $("timerBox");
  const timerEl = $("timer");
  const timeHint = $("timeHint");
  const examError = $("examError");
  const questionHost = $("questionHost");
  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");
  const modalResult = $("modalResult");
  const mrMsg = $("mrMsg");
  const btnCloseResult = $("btnCloseResult");

    // ✅ Modal Integridad (ALERTA)
  const modalIntegrity = $("modalIntegrity");
  const miwBody = $("miwBody");
  const btnIntegrityOk = $("btnIntegrityOk");

  // =============================
  // State - ANTIFRAUDE COMPLETO MEJORADO
  // =============================
  const state = {
    evalByPosition: new Map(),
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,
    timedOut: false,
    
    // 🔴 SISTEMA COMPLETO DE ANTIFRAUDE
    antifraud: {
      // Tiempos globales
      startTime: null,
      endTime: null,
      totalOutOfFocusTime: 0,
      lastFocusLossTime: null,
      // ✅ Mostrar alerta solo una vez por evaluación
      integrityWarned: false,
      // Detalles por pregunta
      questionsDetail: {}, // {qId: {times, focusEvents, actions, flags}}
      
      // Acciones globales
      totalTabChanges: 0,
      totalCopyActions: 0,
      totalPasteActions: 0,
      totalCutActions: 0,
      screenshotAttempts: 0,
      contextMenuAttempts: 0,
      devToolsAttempts: 0,
      
      // Estado actual
      currentQuestionId: null,
      questionStartTime: null,
      questionFocusStartTime: null,
      questionOutOfFocusTime: 0,
      questionOutOfFocusEvents: [],
      
      // Flags y patrones
      flags: [],
      patterns: {
        rapidSequenceAnswers: 0,
        copyPastePattern: false,
        tabSwitchPattern: false
      },
      
      // Metadata del navegador
      browserInfo: {
        userAgent: navigator.userAgent,
        language: navigator.language,
        platform: navigator.platform,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        windowWidth: window.innerWidth,
        windowHeight: window.innerHeight,
        colorDepth: window.screen.colorDepth,
        pixelDepth: window.screen.pixelDepth,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        cookiesEnabled: navigator.cookieEnabled,
        doNotTrack: navigator.doNotTrack || 'unspecified'
      }
    }
  };

  let currentIndex = 0;

  // =============================
  // Utils
  // =============================
  function setMsg(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    if (msg) el.classList.remove("hidden", "is-hidden");
    else el.classList.add("hidden");
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("hidden");
    el.classList.remove("is-hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("hidden");
    el.classList.add("is-hidden");
  }

  function getTimestamp() {
    return Date.now();
  }

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // =============================
  // ANTIFRAUDE: Sistema de Tiempos por Pregunta
  // =============================
  function startQuestionTracking(questionId) {
    const now = getTimestamp();
    
    // Finalizar pregunta anterior si existe
    if (state.antifraud.currentQuestionId) {
      endQuestionTracking(state.antifraud.currentQuestionId);
    }
    
    // Inicializar nueva pregunta
    state.antifraud.currentQuestionId = questionId;
    state.antifraud.questionStartTime = now;
    state.antifraud.questionFocusStartTime = now;
    state.antifraud.questionOutOfFocusTime = 0;
    state.antifraud.questionOutOfFocusEvents = [];
    
    // Crear estructura de pregunta si no existe
    if (!state.antifraud.questionsDetail[questionId]) {
      state.antifraud.questionsDetail[questionId] = {
        times: {
          start: now,
          end: null,
          totalDuration: 0,
          focusedDuration: 0,
          outOfFocusDuration: 0,
          outOfFocusEvents: []
        },
        focusEvents: [],
        actions: {
          copy: 0,
          paste: 0,
          cut: 0,
          tabChanges: 0,
          screenshotAttempts: 0,
          contextMenuAttempts: 0
        },
        flags: [],
        metrics: {
          typingSpeed: null,
          answerLength: 0,
          timeToFirstKey: null,
          lastKeyTime: null
        }
      };
    } else {
      // Actualizar tiempo de inicio
      state.antifraud.questionsDetail[questionId].times.start = now;
    }
  }

  function endQuestionTracking(questionId) {
    const now = getTimestamp();
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (!questionData) return;
    
    // Calcular tiempos finales
    const totalDuration = Math.round((now - questionData.times.start) / 1000);
    const outOfFocusDuration = state.antifraud.questionOutOfFocusTime;
    const focusedDuration = totalDuration - outOfFocusDuration;
    
    questionData.times.end = now;
    questionData.times.totalDuration = totalDuration;
    questionData.times.outOfFocusDuration = outOfFocusDuration;
    questionData.times.focusedDuration = focusedDuration;
    questionData.times.outOfFocusEvents = [...state.antifraud.questionOutOfFocusEvents];
    
    // 🔴 FLAG: Respuesta muy rápida (< 15 segundos)
    if (totalDuration < 15) {
      const flag = `quick_answer_${questionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
    
    // 🔴 FLAG: Mucho tiempo fuera de foco (> 30% del tiempo total)
    if (outOfFocusDuration > totalDuration * 0.3) {
      const flag = `excessive_out_of_focus_${questionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
    
    // 🔴 FLAG: Respuesta demasiado lenta (> 3 minutos)
    if (totalDuration > 180) {
      const flag = `slow_answer_${questionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
    }
    
    // Resetear contadores de pregunta
    state.antifraud.questionOutOfFocusTime = 0;
    state.antifraud.questionOutOfFocusEvents = [];
  }

  // =============================
  // ANTIFRAUDE: Tracking de Focus/Blur DETALLADO
  // =============================
  function handleFocusLoss() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
        showIntegrityAlertOnce();

    
    const now = getTimestamp();
    state.antifraud.lastFocusLossTime = now;
    state.antifraud.totalTabChanges++;
    
    // Registrar evento de pérdida de foco
    const focusEvent = {
      type: 'focus_loss',
      timestamp: now,
      questionId: state.antifraud.currentQuestionId
    };
    
    // Añadir a eventos globales de la pregunta
    const questionData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
    if (questionData) {
      questionData.focusEvents.push(focusEvent);
      questionData.actions.tabChanges++;
    }
    
    // 🔴 PATTERN: Patrón de cambio rápido de pestañas
    if (questionData && questionData.actions.tabChanges >= 3) {
      state.antifraud.patterns.tabSwitchPattern = true;
      const flag = `tab_switch_pattern_${state.antifraud.currentQuestionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
    }
  }

  function handleFocusGain() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    const now = getTimestamp();
    
    // Calcular tiempo fuera de foco
    if (state.antifraud.lastFocusLossTime) {
      const timeOut = Math.round((now - state.antifraud.lastFocusLossTime) / 1000);
      state.antifraud.totalOutOfFocusTime += timeOut;
      state.antifraud.questionOutOfFocusTime += timeOut;
      
      // Registrar evento de recuperación de foco
      const focusEvent = {
        type: 'focus_gain',
        timestamp: now,
        timeOut: timeOut,
        questionId: state.antifraud.currentQuestionId
      };
      
      // Añadir a eventos de la pregunta
      const questionData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
      if (questionData) {
        questionData.focusEvents.push(focusEvent);
        
        // Registrar evento de fuera de foco
        state.antifraud.questionOutOfFocusEvents.push({
          start: state.antifraud.lastFocusLossTime,
          end: now,
          duration: timeOut
        });
        
        questionData.times.outOfFocusEvents.push({
          start: state.antifraud.lastFocusLossTime,
          end: now,
          duration: timeOut
        });
      }
      
      state.antifraud.lastFocusLossTime = null;
    }
    
    // Registrar evento de ganancia de foco
    const focusEvent = {
      type: 'focus_gain',
      timestamp: now,
      questionId: state.antifraud.currentQuestionId
    };
    
    const questionData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
    if (questionData) {
      questionData.focusEvents.push(focusEvent);
    }
  }

  // =============================
  // ANTIFRAUDE: Tracking de Acciones por Pregunta
  // =============================
  function registerCopyAction() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    showIntegrityAlertOnce();
    
    state.antifraud.totalCopyActions++;
    
    const questionId = state.antifraud.currentQuestionId;
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (questionData) {
      questionData.actions.copy++;
      
      // 🔴 FLAG: Muchas acciones de copia en una pregunta
      if (questionData.actions.copy >= 3) {
        const flag = `excessive_copy_${questionId}`;
        if (!questionData.flags.includes(flag)) {
          questionData.flags.push(flag);
        }
      }
      
      // 🔴 PATTERN: Patrón de copy/paste
      if (questionData.actions.copy >= 2 && questionData.actions.paste >= 2) {
        state.antifraud.patterns.copyPastePattern = true;
        const flag = `copy_paste_pattern_${questionId}`;
        if (!questionData.flags.includes(flag)) {
          questionData.flags.push(flag);
        }
      }
    }
  }

  function registerPasteAction() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    state.antifraud.totalPasteActions++;
    
    const questionId = state.antifraud.currentQuestionId;
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (questionData) {
      questionData.actions.paste++;
      
      // 🔴 FLAG: Muchas acciones de pegado en una pregunta
      if (questionData.actions.paste >= 3) {
        const flag = `excessive_paste_${questionId}`;
        if (!questionData.flags.includes(flag)) {
          questionData.flags.push(flag);
        }
      }
    }
  }

  function registerCutAction() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    state.antifraud.totalCutActions++;
    
    const questionId = state.antifraud.currentQuestionId;
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (questionData) {
      questionData.actions.cut++;
    }
  }

  function registerScreenshotAttempt() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    state.antifraud.screenshotAttempts++;
    
    const questionId = state.antifraud.currentQuestionId;
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (questionData) {
      questionData.actions.screenshotAttempts++;
      
      const flag = `screenshot_attempt_${questionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
  }

  function registerContextMenuAttempt() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    showIntegrityAlertOnce();

    state.antifraud.contextMenuAttempts++;
    
    const questionId = state.antifraud.currentQuestionId;
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (questionData) {
      questionData.actions.contextMenuAttempts++;
      
      const flag = `context_menu_attempt_${questionId}`;
      if (!questionData.flags.includes(flag)) {
        questionData.flags.push(flag);
      }
    }
  }

  // =============================
  // ANTIFRAUDE: Detección de DevTools
  // =============================
  function detectDevTools() {
    if (!state.examStarted) return;
    
    const widthThreshold = 160;
    const element = new Image();
    
    Object.defineProperty(element, 'id', {
      get: function() {
        state.antifraud.devToolsAttempts++;
        const flag = 'dev_tools_detected';
        if (!state.antifraud.flags.includes(flag)) {
          state.antifraud.flags.push(flag);
        }
      }
    });
    
    console.log(element);
    
    // Detectar tamaño de consola
    if (window.outerWidth - window.innerWidth > widthThreshold || 
        window.outerHeight - window.innerHeight > widthThreshold) {
      state.antifraud.devToolsAttempts++;
      const flag = 'dev_tools_open';
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
  }

  // =============================
  // ANTIFRAUDE: Preparar Datos para Envío
  // =============================
  function prepareAntifraudData() {
    const now = getTimestamp();
    const totalExamTime = state.antifraud.startTime ? 
      Math.round((now - state.antifraud.startTime) / 1000) : 0;
    
    // Calcular métricas agregadas
    const questionsSummary = {};
    let totalQuestionsTime = 0;
    let totalOutOfFocusTime = 0;
    
    Object.entries(state.antifraud.questionsDetail).forEach(([qId, qData]) => {
      totalQuestionsTime += qData.times.totalDuration || 0;
      totalOutOfFocusTime += qData.times.outOfFocusDuration || 0;
      
      questionsSummary[qId] = {
        total_duration: qData.times.totalDuration,
        focused_duration: qData.times.focusedDuration,
        out_of_focus_duration: qData.times.outOfFocusDuration,
        out_of_focus_events_count: qData.times.outOfFocusEvents.length,
        copy_actions: qData.actions.copy,
        paste_actions: qData.actions.paste,
        cut_actions: qData.actions.cut,
        tab_changes: qData.actions.tabChanges,
        screenshot_attempts: qData.actions.screenshotAttempts,
        context_menu_attempts: qData.actions.contextMenuAttempts,
        flags: qData.flags
      };
    });
    
    // Calcular porcentajes
    const percentageOutOfFocus = totalExamTime > 0 ? 
      Math.round((state.antifraud.totalOutOfFocusTime / totalExamTime) * 100) : 0;
    
    const avgTimePerQuestion = state.questions.length > 0 ? 
      Math.round(totalQuestionsTime / state.questions.length) : 0;
    
    // 🔴 FLAG: Examen completado demasiado rápido
    if (totalExamTime < 300 && state.questions.length >= 8) { // < 5 minutos para 8 preguntas
      if (!state.antifraud.flags.includes('exam_completed_too_fast')) {
        state.antifraud.flags.push('exam_completed_too_fast');
      }
    }
    
    // 🔴 FLAG: Mucho tiempo fuera de foco (> 20% del tiempo total)
    if (percentageOutOfFocus > 20) {
      if (!state.antifraud.flags.includes('high_out_of_focus_percentage')) {
        state.antifraud.flags.push('high_out_of_focus_percentage');
      }
    }
    
    // 🔴 FLAG: Muchas acciones de copy/paste
    const totalCopyPaste = state.antifraud.totalCopyActions + state.antifraud.totalPasteActions;
    if (totalCopyPaste > 10) {
      if (!state.antifraud.flags.includes('excessive_copy_paste_total')) {
        state.antifraud.flags.push('excessive_copy_paste_total');
      }
    }
    
    // 🔴 FLAG: Muchos cambios de pestaña
    if (state.antifraud.totalTabChanges > 5) {
      if (!state.antifraud.flags.includes('excessive_tab_changes')) {
        state.antifraud.flags.push('excessive_tab_changes');
      }
    }
    
    return {
      // Información básica
      basics: {
        lang: navigator.language || 'unknown',
        user_agent: navigator.userAgent.substring(0, 500),
        timed_out: state.timedOut,
        remaining_seconds: state.remaining,
        total_questions: state.questions.length,
        exam_duration_seconds: totalExamTime
      },
      
      // Información del navegador
      browser_info: state.antifraud.browserInfo,
      
      // Tiempos globales
      times: {
        start_time: state.antifraud.startTime ? new Date(state.antifraud.startTime).toISOString() : null,
        end_time: new Date(now).toISOString(),
        total_exam_seconds: totalExamTime,
        total_out_of_focus_seconds: state.antifraud.totalOutOfFocusTime,
        percentage_out_of_focus: percentageOutOfFocus,
        average_time_per_question: avgTimePerQuestion,
        time_per_question_summary: questionsSummary
      },
      
      // Acciones globales
      actions: {
        total_tab_changes: state.antifraud.totalTabChanges,
        total_copy_actions: state.antifraud.totalCopyActions,
        total_paste_actions: state.antifraud.totalPasteActions,
        total_cut_actions: state.antifraud.totalCutActions,
        screenshot_attempts: state.antifraud.screenshotAttempts,
        context_menu_attempts: state.antifraud.contextMenuAttempts,
        dev_tools_attempts: state.antifraud.devToolsAttempts,
        total_copy_paste_actions: totalCopyPaste
      },
      
      // Detalles por pregunta (COMPLETOS)
      questions_detail: state.antifraud.questionsDetail,
      
      // Patrones detectados
      patterns: state.antifraud.patterns,
      
      // Flags y alertas
      flags: state.antifraud.flags,
      
      // Metadata
      metadata: {
        submission_timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client_timestamp: now,
        exam_version: '1.0'
      }
    };
  }

  // =============================
  // Funciones HTTP (mantenidas)
  // =============================
  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY;
    return h;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: headers(), cache: "no-store" });
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!ct.includes("application/json")) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Respuesta no JSON (${res.status}). ${txt.slice(0, 160)}`);
    }

    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = data?.msg || data?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return data;
  }

  async function postJson(url, payload) {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = (res.headers.get("content-type") || "").toLowerCase();
    let data = null;

    if (ct.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      const txt = await res.text().catch(() => "");
      data = { ok: false, msg: txt?.slice(0, 220) || `HTTP ${res.status}` };
    }

    if (!res.ok || !data || data.ok === false) {
      const code = String(data?.code || data?.error_code || "").trim();
      const msg = String(data?.msg || data?.message || `HTTP ${res.status}`).trim();
      const err = new Error(msg || "Error");
      err.code = code;
      err.raw = data;
      throw err;
    }

    return data;
  }

  // =============================
  // Normalización evaluación
  // =============================
  function normalizeEvalResponse(data) {
    // ✅ V2: { ok:true, data: { eval: { questions:[...], duration_minutes } } }
    if (data?.ok === true && data?.data?.eval && Array.isArray(data.data.eval.questions)) {
      return {
        ok: true,
        questions: data.data.eval.questions,
        duration_minutes: Number(data.data.eval.duration_minutes || 10),
        raw: data,
      };
    }

    // ✅ V2 alterno: { ok:true, data: { questions:[...] } }
    if (data?.ok === true && data?.data && Array.isArray(data.data.questions)) {
      return {
        ok: true,
        questions: data.data.questions,
        duration_minutes: Number(data.data.duration_minutes || 10),
        raw: data,
      };
    }

    // V1 compat
    if (data?.ok === true && Array.isArray(data.questions)) {
      return {
        ok: true,
        questions: data.questions,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    if (data?.eval && Array.isArray(data.eval.questions)) {
      return {
        ok: true,
        questions: data.eval.questions,
        duration_minutes: Number(data.eval.duration_minutes || 10),
        raw: data,
      };
    }

    if (data?.ok === true && Array.isArray(data.modules)) {
      const flat = [];
      for (const m of data.modules) {
        const moduleId = String(m?.id || m?.moduleId || m?.code || "").trim();
        const moduleName = String(m?.name || m?.moduleName || "").trim();
        const qs = Array.isArray(m?.questions) ? m.questions : [];
        for (const q of qs) {
          flat.push({
            id: q?.id || q?.qid || "",
            moduleId,
            moduleName,
            prompt: q?.text || q?.prompt || q?.question || "",
          });
        }
      }
      return {
        ok: true,
        questions: flat,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    return { ok: false, questions: [], duration_minutes: 10, raw: data };
  }

  function normalizeEvalResponse(data) {
    
    if (data?.ok === true && Array.isArray(data.questions)) {
      return {
        ok: true,
        questions: data.questions,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    if (data?.eval && Array.isArray(data.eval.questions)) {
      return {
        ok: true,
        questions: data.eval.questions,
        duration_minutes: Number(data.eval.duration_minutes || 10),
        raw: data,
      };
    }

    if (data?.ok === true && Array.isArray(data.modules)) {
      const flat = [];
      for (const m of data.modules) {
        const moduleId = String(m?.id || m?.moduleId || m?.code || "").trim();
        const moduleName = String(m?.name || m?.moduleName || "").trim();
        const qs = Array.isArray(m?.questions) ? m.questions : [];
        for (const q of qs) {
          flat.push({
            id: q?.id || q?.qid || "",
            moduleId,
            moduleName,
            prompt: q?.text || q?.prompt || q?.question || "",
          });
        }
      }
      return {
        ok: true,
        questions: flat,
        duration_minutes: Number(data.duration_minutes || 10),
        raw: data,
      };
    }

    return { ok: false, questions: [], duration_minutes: 10, raw: data };
  }

  function shuffleInPlace(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function pickOnePerModule(flatQuestions) {
    const by = new Map();
    for (const q of flatQuestions || []) {
      const mid = String(q?.moduleId || q?.module || "M0");
      if (!by.has(mid)) by.set(mid, []);
      by.get(mid).push(q);
    }

    const picked = [];
    for (const [mid, list] of by.entries()) {
      if (!list.length) continue;
      const idx = Math.floor(Math.random() * list.length);
      const q = list[idx];
      picked.push({
        id: q.id || "",
        moduleId: q.moduleId || mid,
        moduleName: q.moduleName || "",
        prompt: String(q.prompt || q.text || q.question || "").trim(),
      });
    }

    shuffleInPlace(picked);
    return picked;
  }

  // =============================
  // CV picker
  // =============================
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    cvPicker.textContent = f ? f.name : "Haz clic para adjuntar tu PDF";
  }

  function fileToBase64NoPrefix(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const res = String(fr.result || "");
        const parts = res.split("base64,");
        resolve(parts.length > 1 ? parts[1] : "");
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  // =============================
  // Validation
  // =============================
  function hasPdfSelected() {
    const f = cvFile?.files?.[0];
    if (!f) return false;
    const mime = String(f.type || "").toLowerCase();
    const name = String(f.name || "").toLowerCase();
    if (mime === "application/pdf") return true;
    if (name.endsWith(".pdf")) return true;
    return false;
  }

  function isFormOk() {
    if (!firstName?.value.trim()) return false;
    if (!lastName?.value.trim()) return false;
    if (!cedula?.value.trim()) return false;

    const pid = roleSelect?.value ? String(roleSelect.value).trim() : "";
    if (!pid) return false;

    if (!email?.value.trim()) return false;
    if (!phone?.value.trim()) return false;
    //if (!github?.value.trim()) return false;

    if (!cvFile || cvFile.files.length === 0) return false;

    if (!university?.value.trim()) return false;
    if (!career?.value.trim()) return false;
    if (!semester?.value.trim()) return false;

    if (!acceptPolicy?.checked) return false;

    const evalData = state.evalByPosition.get(pid);
    if (!evalData?.ok || !evalData.questions?.length) return false;

    return true;
  }

  function refreshStartButton() {
    if (!btnStart) return;
    const ok = isFormOk();
    btnStart.disabled = !ok;
    if (ok) setMsg(formError, "");
  }

  function normalizeText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function isValidAnswer(txt) {
    const s = normalizeText(txt);
    if (!s) return false;
    if (/^[\.\,\-\_\:\;\!\?\(\)\[\]\{\}\s]+$/.test(s)) return false;
    const letters = (s.match(/[a-zA-ZáéíóúÁÉÍÓÚñÑ]/g) || []).length;
    if (letters < 6) return false;
    if (s.length < 20) return false;
    return true;
  }

  // =============================
  // Load positions + preload eval
  // =============================
  async function loadPositions() {
    setMsg(formError, "");
    roleSelect.innerHTML = `<option value="" selected>Cargando...</option>`;

    const data = await fetchJson(ENDPOINT_POSITIONS);

    const positions = Array.isArray(data)
      ? data
      : Array.isArray(data.positions)
      ? data.positions
      : Array.isArray(data.data)
      ? data.data
      : [];

    roleSelect.innerHTML = `<option value="" disabled selected>Selecciona un cargo</option>`;

    for (const p of positions) {
      const id = String(p.position_id || p.id || "").trim();
      const name = String(p.position_name || p.name || id || "").trim();
      if (!id) continue;
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = name || id;
      roleSelect.appendChild(opt);
    }
  }

  async function preloadEvalForPosition(positionId) {
    const pid = String(positionId || "").trim();
    if (!pid) return;

    setMsg(formError, "");
    try {
      const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(pid)}`;
      const data = await fetchJson(url);
      const normalized = normalizeEvalResponse(data);

      const selected = pickOnePerModule(normalized.questions || []);
      normalized.questions = selected;

      state.evalByPosition.set(pid, normalized);

      if (!normalized.ok) {
        setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      } else if (!normalized.questions?.length) {
        setMsg(formError, "La evaluación existe, pero no tiene preguntas.");
      }
    } catch (err) {
      state.evalByPosition.set(pid, { ok: false, questions: [], duration_minutes: 10 });
      setMsg(formError, `No se pudo cargar la evaluación: ${err.message}`);
    } finally {
      refreshStartButton();
    }
  }

  // =============================
  // Exam UI
  // =============================
  function ensureQuestionUI() {
    if (!questionHost) return;
    if (questionHost.querySelector("#qText") && questionHost.querySelector("#qAnswer")) return;

    questionHost.innerHTML = `
      <div class="question">
        <div id="qText" class="question__text"></div>
        <textarea id="qAnswer" class="input textarea" rows="6"></textarea>
      </div>
    `.trim();
  }

  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  function updateTimerUI() {
    if (timerEl) timerEl.textContent = formatTime(state.remaining);

    if (timerBox) {
      const timerWrap = timerBox.querySelector(".timer");
      if (timerWrap) {
        timerWrap.classList.remove("is-warn", "is-danger");
        if (state.remaining <= 180 && state.remaining > 60) timerWrap.classList.add("is-warn");
        if (state.remaining <= 60) timerWrap.classList.add("is-danger");
      }
    }

    if (timeHint) {
      if (state.remaining === 180) {
        timeHint.classList.remove("hidden");
        timeHint.classList.remove("is-danger");
        timeHint.textContent = "Quedan 3 minutos.";
      } else if (state.remaining === 60) {
        timeHint.classList.remove("hidden");
        timeHint.classList.add("is-danger");
        timeHint.textContent = "Queda 1 minuto.";
      } else if (state.remaining === 0) {
        timeHint.classList.remove("hidden");
        timeHint.classList.add("is-danger");
        timeHint.textContent = "Tiempo finalizado.";
      }
    }
  }

  function startTimer() {
    stopTimer();
    state.timedOut = false;
    if (timerBox) show(timerBox);
    updateTimerUI();

    state.timerHandle = setInterval(async () => {
      state.remaining -= 1;
      updateTimerUI();

      if (state.remaining <= 0) {
        stopTimer();
        state.timedOut = true;
        await finishExam(true).catch(() => {});
      }
    }, 1000);
  }

  function goToExamStep() {
    hide(form);
    show(examCard);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveCurrentAnswer() {
    const ta = questionHost?.querySelector("#qAnswer");
    state.answers[currentIndex] = String(ta?.value || "");
  }

  function renderQuestion() {
    ensureQuestionUI();
    const q = state.questions[currentIndex];
    if (!q) return;

    const qTextEl2 = questionHost.querySelector("#qText");
    const qAnswerEl2 = questionHost.querySelector("#qAnswer");

    const prompt = String(q.prompt || q.text || q.question || "").trim();
    qTextEl2.textContent = `${currentIndex + 1} de ${state.questions.length}. ${prompt}`;

    qAnswerEl2.value = state.answers[currentIndex] || "";
    qAnswerEl2.placeholder = "Escribe tu respuesta aquí...";
    
    // 🔴 ANTIFRAUDE: Iniciar tracking de nueva pregunta
    const questionId = q.id || `Q${currentIndex + 1}`;
    startQuestionTracking(questionId);
    
    // Prevenir acciones
    qAnswerEl2.onpaste = (e) => { 
      e.preventDefault(); 
      registerPasteAction();
    };
    qAnswerEl2.oncopy = (e) => { 
      e.preventDefault(); 
      registerCopyAction();
    };
    qAnswerEl2.oncut = (e) => { 
      e.preventDefault(); 
      registerCutAction();
    };
    
    // Prevenir menú contextual
    qAnswerEl2.oncontextmenu = (e) => {
      e.preventDefault();
      registerContextMenuAttempt();
    };

    qAnswerEl2.focus();

    if (currentIndex === state.questions.length - 1) {
      hide(btnNext);
      show(btnSubmit);
    } else {
      show(btnNext);
      hide(btnSubmit);
    }

    setMsg(examError, "");
  }

  function beginExam() {
    const pid = String(roleSelect.value || "").trim();
    const evalData = state.evalByPosition.get(pid);

    if (!evalData?.ok || !evalData.questions?.length) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      refreshStartButton();
      return;
    }

    state.questions = Array.isArray(evalData.questions) ? evalData.questions.slice(0) : [];
    state.answers = new Array(state.questions.length).fill("");

    state.durationSeconds = Math.max(1, Number(evalData.duration_minutes || 10) * 60);
    state.remaining = state.durationSeconds;

    // 🔴 ANTIFRAUDE: Inicializar sistema completo
    state.antifraud.startTime = Date.now();
    state.antifraud.endTime = null;
    state.antifraud.totalOutOfFocusTime = 0;
    state.antifraud.totalTabChanges = 0;
    state.antifraud.totalCopyActions = 0;
    state.antifraud.totalPasteActions = 0;
    state.antifraud.totalCutActions = 0;
    state.antifraud.screenshotAttempts = 0;
    state.antifraud.contextMenuAttempts = 0;
    state.antifraud.devToolsAttempts = 0;
    state.antifraud.questionsDetail = {};
    state.antifraud.flags = [];
    state.antifraud.patterns = {
      rapidSequenceAnswers: 0,
      copyPastePattern: false,
      tabSwitchPattern: false
    };

    currentIndex = 0;
    state.examStarted = true;

    // 🔴 Detectar DevTools al inicio
    setTimeout(detectDevTools, 1000);
    // Verificar periódicamente
    setInterval(detectDevTools, 30000);

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  // =============================
  // Modal Functions
  // =============================

  // 🔔 Modal de integridad
    function openModalIntegrity(customMsg = "") {
      if (!modalIntegrity) return;
      if (miwBody && customMsg) {
        miwBody.textContent = customMsg;
      }
      modalIntegrity.classList.remove("hidden", "is-hidden");
      document.body.style.overflow = "hidden";
    }

    function closeModalIntegrity() {
      if (!modalIntegrity) return;
      modalIntegrity.classList.add("hidden");
      document.body.style.overflow = "";
    }

    // ⚠️ Mostrar alerta de integridad SOLO UNA VEZ
    function showIntegrityAlertOnce() {
      if (!state.examStarted) return;
      if (state.antifraud.integrityWarned) return;

      state.antifraud.integrityWarned = true;

      const INTEGRITY_MESSAGE =
        "Atención\n\n" +
        "Esta evaluación cuenta con control de integridad.\n\n" +
        "Responde con tu propio criterio y mantén el foco en la prueba. " +
        "El sistema realiza seguimiento continuo durante todo el proceso.\n\n" +
        "La evaluación está diseñada para resolverse en aproximadamente 10 minutos. " +
        "Concéntrate y continúa.";

      openModalIntegrity(INTEGRITY_MESSAGE);
    }
    
  function openModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("hidden", "is-hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.add("hidden");
    document.body.style.overflow = "";
  }

  function openModalResult(msg, isTimeout = false) {
    if (mrMsg) {
      mrMsg.textContent = msg || "Evaluación enviada correctamente.";
      
      const icon = modalResult.querySelector('.modal__icon');
      if (icon) {
        if (isTimeout) {
          icon.classList.add('modal__icon--warning');
          icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V9zm-1.5 7.5a.75.75 0 001.5 0 .75.75 0 00-1.5 0z" clip-rule="evenodd" />
            </svg>
          `;
        } else {
          icon.classList.remove('modal__icon--warning');
          icon.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
              <path fill-rule="evenodd" d="M2.25 12c0-5.385 4.365-9.75 9.75-9.75s9.75 4.365 9.75 9.75-4.365 9.75-9.75 9.75S2.25 17.385 2.25 12zm13.36-1.814a.75.75 0 10-1.22-.872l-3.236 4.53L9.53 12.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.14-.094l3.75-5.25z" clip-rule="evenodd" />
            </svg>
          `;
        }
      }
    }
    
    if (!modalResult) return;
    modalResult.classList.remove("hidden", "is-hidden");
    document.body.style.overflow = "hidden";
  }

  function closeModalResult() {
    if (!modalResult) return;
    modalResult.classList.add("hidden");
    document.body.style.overflow = "";
    
    setTimeout(() => {
      window.location.href = REDIRECT_URL;
    }, 300);
  }

  async function finishExam(force = false) {
    // 🔴 ANTIFRAUDE: Finalizar tracking de pregunta actual
    if (state.antifraud.currentQuestionId) {
      endQuestionTracking(state.antifraud.currentQuestionId);
    }
    
    // 🔴 ANTIFRAUDE: Guardar tiempo final
    state.antifraud.endTime = Date.now();

    saveCurrentAnswer();

    if (!force && !isValidAnswer(state.answers[currentIndex])) {
      setMsg(examError, "Responde de forma completa antes de continuar.");
      return;
    }

    if (!force) {
      const empty = state.answers.findIndex((a) => !isValidAnswer(a));
      if (empty !== -1) {
        currentIndex = empty;
        renderQuestion();
        setMsg(examError, `Falta responder correctamente la pregunta ${empty + 1}.`);
        return;
      }
    }

    const file = cvFile?.files?.[0];
    if (!file) {
      setMsg(examError, "Falta adjuntar el CV.");
      return;
    }
    if (!hasPdfSelected()) {
      setMsg(examError, "El CV debe ser PDF.");
      return;
    }

    btnSubmit.disabled = true;
    const originalText = btnSubmit.textContent;
    btnSubmit.textContent = "Enviando...";

    try {
      const cvB64 = await fileToBase64NoPrefix(file);
      const pid = String(roleSelect.value || "").trim();

      // 🔴 ANTIFRAUDE: Preparar datos COMPLETOS
      const antifraudData = prepareAntifraudData();

      const payload = {
        position_id: pid,

        candidate: {
          // datos principales
          first_name: firstName.value.trim(),
          last_name: lastName.value.trim(),
          cedula: cedula.value.trim(),

          email: email.value.trim(),
          phone: phone.value.trim(),
          github: (github?.value || "").trim(),
          linkedin: (linkedin?.value || "").trim(),

          university: university.value.trim(),
          career: career.value.trim(),
          semester: semester.value.trim(),
        },

        // V2 usa "answers" (no "questions")
        answers: state.questions.map((q, i) => ({
          question_id: q.id || q.qid || `Q${i + 1}`,
          module_id: q.moduleId || q.module || "",
          module_name: q.moduleName || "",
          prompt: q.prompt || q.text || q.question || "",
          answer: normalizeText(state.answers[i] || ""),
        })),

        // meta: aquí metemos antifraude completo + básicos
        meta: {
          ...antifraudData.basics,
          antifraud: antifraudData,
          source: "github_pages",
          schema: "v2",
        },

        // V2 espera filename/base64 (sin mime)
        cv: {
          filename: file.name || "cv.pdf",
          base64: cvB64,
        },
      };


      console.log("📊 Datos de antifraude enviados:", antifraudData);
      
      await postJson(ENDPOINT_SUBMIT, payload);

      stopTimer();
      openModalResult(
        state.timedOut ? "Tiempo finalizado. Evaluación enviada." : "Evaluación enviada correctamente.",
        state.timedOut
      );
    } catch (err) {
      const msg = String(err?.message || "");
      const code = String(err?.code || "");
      const looksLikeLimit =
        code.toUpperCase().includes("MAX") ||
        /max/i.test(msg) ||
        /exced/i.test(msg) ||
        /2\s*evalu/i.test(msg) ||
        /año/i.test(msg);

      if (looksLikeLimit) {
        stopTimer();
        openModalResult("Has excedido el máximo permitido: 2 evaluaciones por año.", false);
        return;
      }

      setMsg(examError, msg || "No se pudo enviar la evaluación.");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  }

  // =============================
  // Events - SISTEMA COMPLETO DE ANTIFRAUDE
  // =============================
  const revalidate = () => refreshStartButton();

  [firstName, lastName, cedula, email, phone, github, linkedin, university, career, semester]
    .forEach((el) => el?.addEventListener("input", revalidate));

  acceptPolicy?.addEventListener("change", revalidate);

  cvPicker?.addEventListener("click", () => cvFile?.click());
  cvPicker?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      cvFile?.click();
    }
  });

  cvFile?.addEventListener("change", () => {
    updateCvPickerLabel();
    refreshStartButton();
  });

  roleSelect?.addEventListener("change", async () => {
    const pid = String(roleSelect.value || "").trim();
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });

  btnStart?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!isFormOk()) {
      setMsg(formError, "Completa todos los campos obligatorios (*) y adjunta tu PDF.");
      return;
    }
    openModalInfo();
  });

  btnContinue?.addEventListener("click", () => {
    closeModalInfo();
    beginExam();
  });

  // Cerrar modales
  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });

    // ✅ Cierre modal integridad
  modalIntegrity?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalIntegrity);
  });
  btnIntegrityOk?.addEventListener("click", closeModalIntegrity);

  modalResult?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalResult);
  });

  btnCloseResult?.addEventListener("click", closeModalResult);

  btnPrev?.addEventListener("click", () => { /* oculto */ });

  btnNext?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();

    if (!isValidAnswer(state.answers[currentIndex])) {
      setMsg(examError, "Responde de forma completa antes de continuar.");
      return;
    }

    if (currentIndex < state.questions.length - 1) {
      currentIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit?.addEventListener("click", async () => {
    if (!state.examStarted) return;
    await finishExam(false);
  });

  // 🔴 ANTIFRAUDE: Eventos globales
  window.addEventListener("focus", () => handleFocusGain());
  window.addEventListener("blur", () => handleFocusLoss());
  
  document.addEventListener("visibilitychange", () => {
    if (!state.examStarted) return;
    if (document.visibilityState === "hidden") {
      handleFocusLoss();
    } else {
      handleFocusGain();
    }
  });

  // Detección de screenshot
  window.addEventListener("keydown", (e) => {
    if (!state.examStarted) return;
    
    // PrintScreen
    if (e.key === "PrintScreen") {
      e.preventDefault();
      registerScreenshotAttempt();
    }
    
    // Combinaciones comunes de screenshot
    if ((e.ctrlKey && e.shiftKey && e.key === 'S') || 
        (e.ctrlKey && e.altKey && e.key === 'S') ||
        (e.metaKey && e.shiftKey && e.key === '3') || // Mac: Cmd+Shift+3
        (e.metaKey && e.shiftKey && e.key === '4')) { // Mac: Cmd+Shift+4
      e.preventDefault();
      registerScreenshotAttempt();
    }
  });

  // Prevenir menú contextual en toda la página durante el examen
  document.addEventListener("contextmenu", (e) => {
    if (!state.examStarted) return;
    e.preventDefault();
    registerContextMenuAttempt();
  });

  // Detectar intentos de abrir DevTools con F12
  document.addEventListener("keydown", (e) => {
    if (!state.examStarted) return;
          showIntegrityAlertOnce();

    if (e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && e.shiftKey && e.key === 'J') ||
        (e.ctrlKey && e.shiftKey && e.key === 'C') ||
        (e.metaKey && e.altKey && e.key === 'I')) { // Mac: Cmd+Opt+I
      e.preventDefault();
      state.antifraud.devToolsAttempts++;
      const flag = 'dev_tools_keyboard_attempt';
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
  });

  // Detectar redimensionamiento de ventana (posible DevTools)
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  
  window.addEventListener("resize", () => {
    if (!state.examStarted) return;
    
    const widthDiff = Math.abs(window.innerWidth - lastWidth);
    const heightDiff = Math.abs(window.innerHeight - lastHeight);
    
    // Si el cambio es significativo y asimétrico (posible DevTools)
    if ((widthDiff > 100 && heightDiff < 10) || 
        (heightDiff > 100 && widthDiff < 10)) {
      state.antifraud.devToolsAttempts++;
      const flag = 'window_resize_suspicious';
      if (!state.antifraud.flags.includes(flag)) {
        state.antifraud.flags.push(flag);
      }
    }
    
    lastWidth = window.innerWidth;
    lastHeight = window.innerHeight;
  });

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);
  
    btnStart.disabled = true;
    updateCvPickerLabel();
  
    setMsg(serviceInfo, "Cargando cargos...");
    try {
      await loadPositions();
      setMsg(serviceInfo, "");
    } catch (err) {
      setMsg(serviceInfo, "");
      setMsg(formError, "Error cargando cargos: " + err.message);
      roleSelect.innerHTML = `<option value="" selected>Error al cargar</option>`;
    }
  
    refreshStartButton();
  });
  
})();
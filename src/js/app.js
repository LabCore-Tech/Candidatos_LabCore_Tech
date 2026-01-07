/* LabCore - Evaluación de ingreso (front)
   - Sistema COMPLETO de tracking antifraude MEJORADO
   - BLOQUEO TOTAL en dispositivos móviles
   - Bloqueo de selección de texto
   - Contador de salidas del examen
   - Bloqueo de ayuda de IA al seleccionar
   - Control mejorado de screenshots
   - Solo escritura manual (no pegar)
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
    
    // 🔴 SISTEMA COMPLETO DE ANTIFRAUDE MEJORADO
    antifraud: {
      // Tiempos globales
      startTime: null,
      endTime: null,
      totalOutOfFocusTime: 0,
      lastFocusLossTime: null,
      
      // Detalles por pregunta
      questionsDetail: {}, // {qId: {times, focusEvents, actions, flags}}
      
      // Acciones globales
      totalTabChanges: 0,
      totalCopyActions: 0,
      totalPasteActions: 0,
      totalCutActions: 0,
      totalSelectActions: 0, // NUEVO: Contador de selecciones
      totalScreenshotAttempts: 0, // NUEVO: Contador de screenshots
      screenshotTimestamps: [], // NUEVO: Tiempos de screenshots
      contextMenuAttempts: 0,
      devToolsAttempts: 0,
      focusLossCount: 0, // NUEVO: Contador de veces que sale
      
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
        tabSwitchPattern: false,
        screenshotPattern: false,
        mobilePattern: false
      },
      
      // Snapshots de respuestas (para detectar pegado)
      answerSnapshots: [],
      
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
        doNotTrack: navigator.doNotTrack || 'unspecified',
        isMobile: false, // NUEVO
        isTouchDevice: false // NUEVO
      }
    }
  };

  let currentIndex = 0;
  let strikes = { count: 0, reasons: [] }; // Sistema de strikes

  // =============================
  // 🚨 FUNCIONES DE BLOQUEO MEJORADAS
  // =============================

  // 1. DETECTAR Y BLOQUEAR DISPOSITIVOS MÓVILES
  function detectAndBlockMobile() {
    const userAgent = navigator.userAgent.toLowerCase();
    const isMobile = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|mobile/i.test(userAgent);
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Detectar características de móvil
    const screenRatio = window.screen.width / window.screen.height;
    const isPortrait = window.innerHeight > window.innerWidth;
    const hasSmallScreen = window.innerWidth < 768 || window.innerHeight < 500;
    
    state.antifraud.browserInfo.isMobile = isMobile || isTouchDevice || hasSmallScreen;
    state.antifraud.browserInfo.isTouchDevice = isTouchDevice;
    state.antifraud.browserInfo.screenRatio = screenRatio;
    state.antifraud.browserInfo.isPortrait = isPortrait;
    
    // Si es móvil, bloquear inicio del examen
    if (isMobile || isTouchDevice) {
      state.antifraud.patterns.mobilePattern = true;
      state.antifraud.flags.push('mobile_device_detected');
      
      // Mostrar mensaje de bloqueo
      if (modalInfo) {
        modalInfo.innerHTML = `
          <div class="modal">
            <div class="modal__content">
              <div class="modal__icon modal__icon--danger">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                  <path fill-rule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12.75 9a.75.75 0 00-1.5 0v4.5a.75.75 0 001.5 0V9zm-1.5 7.5a.75.75 0 001.5 0 .75.75 0 00-1.5 0z" clip-rule="evenodd" />
                </svg>
              </div>
              <h2 class="modal__title">🚫 DISPOSITIVO NO PERMITIDO</h2>
              <p class="modal__text">
                Esta evaluación debe realizarse <strong>exclusivamente en computadora</strong>.<br><br>
                <strong>Razones:</strong><br>
                • Uso de celular detectado<br>
                • Pantalla táctil detectada<br>
                • Dispositivo móvil no compatible<br><br>
                Por favor, usa una computadora para realizar la evaluación.
              </p>
              <div class="modal__actions">
                <button class="button button--secondary" onclick="window.location.href='${REDIRECT_URL}'">
                  Salir
                </button>
              </div>
            </div>
          </div>
        `;
        show(modalInfo);
      }
      return false;
    }
    return true;
  }

  // 2. BLOQUEAR SELECCIÓN DE TEXTO (para evitar ayuda de IA)
  function blockTextSelection() {
    // Bloquear selección en todo el documento durante el examen
    const style = document.createElement('style');
    style.id = 'no-selection-style';
    style.textContent = `
      .no-selection {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
      }
      .textarea-selectable {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
      }
    `;
    document.head.appendChild(style);
    
    // Aplicar a todo el body excepto textareas
    document.addEventListener('selectionchange', (e) => {
      if (!state.examStarted) return;
      
      const selection = window.getSelection();
      if (selection && selection.toString().length > 0) {
        // Si se selecciona texto fuera del textarea
        const activeElement = document.activeElement;
        const isTextarea = activeElement && (
          activeElement.tagName === 'TEXTAREA' || 
          activeElement.tagName === 'INPUT' && 
          (activeElement.type === 'text' || activeElement.type === 'search')
        );
        
        if (!isTextarea) {
          selection.removeAllRanges();
          addStrike('Selección de texto detectada');
          
          // Bloquear menú contextual de selección
          setTimeout(() => {
            if (document.activeElement) {
              document.activeElement.blur();
            }
          }, 10);
        }
      }
    });
    
    // Prevenir drag para seleccionar
    document.addEventListener('dragstart', (e) => {
      if (state.examStarted && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
      }
    });
    
    // Aplicar clase no-selection al iniciar examen
    const applyNoSelection = () => {
      document.body.classList.add('no-selection');
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => ta.classList.add('textarea-selectable'));
    };
    
    const removeNoSelection = () => {
      document.body.classList.remove('no-selection');
      const textareas = document.querySelectorAll('textarea');
      textareas.forEach(ta => ta.classList.remove('textarea-selectable'));
    };
    
    return { applyNoSelection, removeNoSelection };
  }

  // 3. SISTEMA DE STRIKES (3 strikes y se invalida)
  function addStrike(reason) {
    strikes.count++;
    strikes.reasons.push({ 
      reason, 
      timestamp: Date.now(),
      questionId: state.antifraud.currentQuestionId 
    });
    
    // Registrar en antifraud
    state.antifraud.flags.push(`strike_${strikes.count}: ${reason}`);
    
    // Mostrar advertencia
    const strikeMsg = `⚠️ Comportamiento no permitido (${strikes.count}/3): ${reason}`;
    setMsg(examError, strikeMsg);
    
    // Si llega a 3 strikes, terminar examen
    if (strikes.count >= 3) {
      const reasonsText = strikes.reasons.map(r => `• ${r.reason}`).join('\n');
      openModalResult(
        `❌ EXAMEN INVALIDADO\n\nSe detectaron múltiples comportamientos no permitidos:\n${reasonsText}\n\nEl examen ha sido terminado.`,
        true
      );
      stopTimer();
      state.examStarted = false;
      return true;
    }
    
    // Limpiar mensaje después de 5 segundos
    setTimeout(() => {
      if (state.examStarted && strikes.count < 3) {
        setMsg(examError, '');
      }
    }, 5000);
    
    return false;
  }

  // 4. BLOQUEAR COPY/PASTE TOTAL (MEJORADO PARA MÓVIL)
  function blockAllCopyPaste() {
    // Bloquear eventos de copiar
    document.addEventListener('copy', (e) => {
      if (state.examStarted) {
        e.preventDefault();
        e.clipboardData.setData('text/plain', '⚠️ COPY BLOQUEADO - Esta acción ha sido registrada');
        state.antifraud.totalCopyActions++;
        addStrike('Intento de copiar contenido');
      }
    });

    // Bloquear pegar COMPLETAMENTE
    document.addEventListener('paste', (e) => {
      if (state.examStarted) {
        e.preventDefault();
        state.antifraud.totalPasteActions++;
        
        // Bloquear en textarea también
        const activeEl = document.activeElement;
        if (activeEl && activeEl.tagName === 'TEXTAREA') {
          // Insertar texto bloqueado
          const start = activeEl.selectionStart;
          const end = activeEl.selectionEnd;
          const text = activeEl.value;
          activeEl.value = text.substring(0, start) + '[PEGADO BLOQUEADO]' + text.substring(end);
          activeEl.selectionStart = activeEl.selectionEnd = start + 18;
        }
        
        addStrike('Intento de pegar contenido');
      }
    });

    // Bloquear cortar
    document.addEventListener('cut', (e) => {
      if (state.examStarted) {
        e.preventDefault();
        state.antifraud.totalCutActions++;
        addStrike('Intento de cortar contenido');
      }
    });

    // Bloquear arrastrar y soltar (drag & drop)
    document.addEventListener('drop', (e) => {
      if (state.examStarted) {
        e.preventDefault();
        addStrike('Intento de arrastrar y soltar contenido');
      }
    });

    document.addEventListener('dragover', (e) => {
      if (state.examStarted) {
        e.preventDefault();
      }
    });
  }

  // 5. DETECCIÓN MEJORADA DE SCREENSHOTS
  function setupScreenshotDetection() {
    // Detectar tecla PrintScreen
    document.addEventListener('keydown', (e) => {
      if (!state.examStarted) return;
      
      // PrintScreen
      if (e.key === 'PrintScreen') {
        e.preventDefault();
        registerScreenshotAttempt();
        return;
      }
      
      // Combinaciones de screenshot
      const isScreenshotCombo = 
        (e.ctrlKey && e.shiftKey && e.key === 'S') ||
        (e.ctrlKey && e.altKey && e.key === 'S') ||
        (e.metaKey && e.shiftKey && e.key === '3') || // Mac: Cmd+Shift+3
        (e.metaKey && e.shiftKey && e.key === '4') || // Mac: Cmd+Shift+4
        (e.key === 'F12'); // Algunos dispositivos usan F12 para screenshot
      
      if (isScreenshotCombo) {
        e.preventDefault();
        registerScreenshotAttempt();
      }
    });
    
    // Detectar cambios en el viewport (screenshots en móvil)
    let lastViewport = {
      width: window.innerWidth,
      height: window.innerHeight,
      orientation: window.screen.orientation?.type || 'landscape'
    };
    
    setInterval(() => {
      if (!state.examStarted) return;
      
      const currentViewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        orientation: window.screen.orientation?.type || 'landscape'
      };
      
      // Cambio brusco de orientación (móvil girando para screenshot)
      if (lastViewport.orientation !== currentViewport.orientation) {
        registerScreenshotAttempt();
      }
      
      // Cambio brusco de tamaño (posible screenshot tool)
      const widthDiff = Math.abs(currentViewport.width - lastViewport.width);
      const heightDiff = Math.abs(currentViewport.height - lastViewport.height);
      
      if ((widthDiff > 100 && heightDiff < 10) || (heightDiff > 100 && widthDiff < 10)) {
        registerScreenshotAttempt();
      }
      
      lastViewport = currentViewport;
    }, 1000);
  }

  function registerScreenshotAttempt() {
    if (!state.examStarted) return;
    
    state.antifraud.totalScreenshotAttempts++;
    const timestamp = Date.now();
    state.antifraud.screenshotTimestamps.push(timestamp);
    
    // Si hay muchos screenshots en poco tiempo
    if (state.antifraud.screenshotTimestamps.length > 2) {
      const first = state.antifraud.screenshotTimestamps[0];
      const last = state.antifraud.screenshotTimestamps[state.antifraud.screenshotTimestamps.length - 1];
      const timeSpan = last - first;
      
      if (timeSpan < 30000) { // 3 screenshots en menos de 30 segundos
        state.antifraud.patterns.screenshotPattern = true;
        addStrike('Patrón de screenshots detectado');
      }
    }
    
    // Guardar por pregunta
    const questionId = state.antifraud.currentQuestionId;
    if (questionId) {
      const questionData = state.antifraud.questionsDetail[questionId];
      if (questionData) {
        questionData.actions.screenshotAttempts++;
        
        const flag = `screenshot_attempt_${questionId}`;
        if (!questionData.flags.includes(flag)) {
          questionData.flags.push(flag);
        }
      }
    }
    
    const flag = `screenshot_${timestamp}`;
    if (!state.antifraud.flags.includes(flag)) {
      state.antifraud.flags.push(flag);
    }
    
    // Mostrar alerta
    setMsg(examError, '⚠️ Intento de screenshot detectado. Esta acción ha sido registrada.');
    setTimeout(() => {
      if (state.examStarted) setMsg(examError, '');
    }, 5000);
  }

  // 6. CONTADOR DE SALIDAS DEL EXAMEN (FOCUS/BLUR)
  function setupFocusTracking() {
    let lastFocusTime = Date.now();
    let focusEvents = [];
    
    window.addEventListener('blur', () => {
      if (!state.examStarted) return;
      
      const now = Date.now();
      state.antifraud.focusLossCount++;
      state.antifraud.lastFocusLossTime = now;
      state.antifraud.totalTabChanges++;
      
      // Registrar evento
      focusEvents.push({
        type: 'blur',
        timestamp: now,
        timeSinceLast: now - lastFocusTime
      });
      
      // Si hay muchos blurs rápidos
      if (focusEvents.length > 3) {
        const recentEvents = focusEvents.slice(-4);
        const timeSpan = recentEvents[3].timestamp - recentEvents[0].timestamp;
        
        if (timeSpan < 10000) { // 4 blurs en menos de 10 segundos
          addStrike('Demasiados cambios de ventana/pestaña');
        }
      }
      
      // Manejar pérdida de foco para tracking de pregunta
      handleFocusLoss();
    });
    
    window.addEventListener('focus', () => {
      if (!state.examStarted) return;
      
      const now = Date.now();
      lastFocusTime = now;
      
      // Calcular tiempo fuera
      if (state.antifraud.lastFocusLossTime) {
        const timeOut = Math.round((now - state.antifraud.lastFocusLossTime) / 1000);
        state.antifraud.totalOutOfFocusTime += timeOut;
        
        // Si estuvo fuera mucho tiempo
        if (timeOut > 30) {
          addStrike(`Estuvo ${timeOut} segundos fuera de la ventana`);
        }
      }
      
      // Registrar evento
      focusEvents.push({
        type: 'focus',
        timestamp: now,
        questionId: state.antifraud.currentQuestionId
      });
      
      handleFocusGain();
    });
    
    // Tracking de visibility change (para pestañas)
    document.addEventListener('visibilitychange', () => {
      if (!state.examStarted) return;
      
      if (document.visibilityState === 'hidden') {
        const now = Date.now();
        state.antifraud.focusLossCount++;
        state.antifraud.totalTabChanges++;
        
        focusEvents.push({
          type: 'tab_hidden',
          timestamp: now
        });
        
        handleFocusLoss();
      } else {
        handleFocusGain();
      }
    });
  }

  // 7. DETECCIÓN DE ESCRITURA RÁPIDA (PARA DETECTAR PEGADO)
  function setupWritingDetection() {
    let lastKeyTime = null;
    let keyCount = 0;
    let lastAnswerLength = 0;
    let lastAnswerTime = Date.now();
    
    // Monitorear textarea
    const monitorTextarea = () => {
      const textarea = questionHost?.querySelector('#qAnswer');
      if (!textarea) return;
      
      // Tomar snapshot cada 2 segundos
      setInterval(() => {
        if (!state.examStarted || !textarea) return;
        
        const now = Date.now();
        const currentLength = textarea.value.length;
        const lengthDiff = currentLength - lastAnswerLength;
        const timeDiff = now - lastAnswerTime;
        
        // Guardar snapshot
        state.antifraud.answerSnapshots.push({
          timestamp: now,
          questionId: state.antifraud.currentQuestionId,
          length: currentLength,
          lengthDiff: lengthDiff,
          timeDiff: timeDiff,
          sample: textarea.value.substring(0, 100) // Muestra de texto
        });
        
        // 🔴 DETECTAR ESCRITURA ANORMALMENTE RÁPIDA
        // Si agregó más de 50 caracteres en menos de 2 segundos
        if (lengthDiff > 50 && timeDiff < 2000) {
          addStrike('Escritura anormalmente rápida detectada (posible pegado)');
          
          // Marcar en datos de antifraude
          state.antifraud.flags.push(`rapid_writing_${now}`);
          if (state.antifraud.currentQuestionId) {
            const qData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
            if (qData) {
              qData.flags.push(`rapid_writing_${now}`);
            }
          }
        }
        
        lastAnswerLength = currentLength;
        lastAnswerTime = now;
        
        // Limitar snapshots a los últimos 100
        if (state.antifraud.answerSnapshots.length > 100) {
          state.antifraud.answerSnapshots.shift();
        }
      }, 2000);
      
      // Detectar eventos de teclado
      textarea.addEventListener('keydown', (e) => {
        if (!state.examStarted) return;
        
        const now = Date.now();
        keyCount++;
        
        // Si es la primera tecla después de un tiempo
        if (!lastKeyTime) {
          lastKeyTime = now;
        } else {
          const timeBetweenKeys = now - lastKeyTime;
          lastKeyTime = now;
          
          // 🔴 DETECTAR TECLEO DEMASIADO RÁPIDO (<50ms entre teclas)
          if (timeBetweenKeys < 50 && keyCount > 10) {
            addStrike('Tecleo anormalmente rápido detectado');
          }
        }
      });
      
      // Reiniciar contador después de pausa
      textarea.addEventListener('blur', () => {
        lastKeyTime = null;
        keyCount = 0;
      });
    };
    
    // Iniciar monitoreo cuando se renderiza pregunta
    const originalRenderQuestion = renderQuestion;
    renderQuestion = function() {
      originalRenderQuestion();
      setTimeout(monitorTextarea, 100);
    };
  }

  // =============================
  // Utils (mantenidas)
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
  // ANTIFRAUDE: Sistema de Tiempos por Pregunta (mantenido)
  // =============================
  function startQuestionTracking(questionId) {
    const now = getTimestamp();
    
    if (state.antifraud.currentQuestionId) {
      endQuestionTracking(state.antifraud.currentQuestionId);
    }
    
    state.antifraud.currentQuestionId = questionId;
    state.antifraud.questionStartTime = now;
    state.antifraud.questionFocusStartTime = now;
    state.antifraud.questionOutOfFocusTime = 0;
    state.antifraud.questionOutOfFocusEvents = [];
    
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
          contextMenuAttempts: 0,
          selectActions: 0
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
      state.antifraud.questionsDetail[questionId].times.start = now;
    }
  }

  function endQuestionTracking(questionId) {
    const now = getTimestamp();
    const questionData = state.antifraud.questionsDetail[questionId];
    
    if (!questionData) return;
    
    const totalDuration = Math.round((now - questionData.times.start) / 1000);
    const outOfFocusDuration = state.antifraud.questionOutOfFocusTime;
    const focusedDuration = totalDuration - outOfFocusDuration;
    
    questionData.times.end = now;
    questionData.times.totalDuration = totalDuration;
    questionData.times.outOfFocusDuration = outOfFocusDuration;
    questionData.times.focusedDuration = focusedDuration;
    questionData.times.outOfFocusEvents = [...state.antifraud.questionOutOfFocusEvents];
    
    // Flags (mantenidos)
    if (totalDuration < 15) {
      const flag = `quick_answer_${questionId}`;
      if (!questionData.flags.includes(flag)) questionData.flags.push(flag);
      if (!state.antifraud.flags.includes(flag)) state.antifraud.flags.push(flag);
    }
    
    if (outOfFocusDuration > totalDuration * 0.3) {
      const flag = `excessive_out_of_focus_${questionId}`;
      if (!questionData.flags.includes(flag)) questionData.flags.push(flag);
      if (!state.antifraud.flags.includes(flag)) state.antifraud.flags.push(flag);
    }
    
    if (totalDuration > 180) {
      const flag = `slow_answer_${questionId}`;
      if (!questionData.flags.includes(flag)) questionData.flags.push(flag);
    }
    
    state.antifraud.questionOutOfFocusTime = 0;
    state.antifraud.questionOutOfFocusEvents = [];
  }

  function handleFocusLoss() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    const now = getTimestamp();
    state.antifraud.lastFocusLossTime = now;
    
    const focusEvent = {
      type: 'focus_loss',
      timestamp: now,
      questionId: state.antifraud.currentQuestionId
    };
    
    const questionData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
    if (questionData) {
      questionData.focusEvents.push(focusEvent);
      questionData.actions.tabChanges++;
    }
  }

  function handleFocusGain() {
    if (!state.examStarted || !state.antifraud.currentQuestionId) return;
    
    const now = getTimestamp();
    
    if (state.antifraud.lastFocusLossTime) {
      const timeOut = Math.round((now - state.antifraud.lastFocusLossTime) / 1000);
      state.antifraud.totalOutOfFocusTime += timeOut;
      state.antifraud.questionOutOfFocusTime += timeOut;
      
      const focusEvent = {
        type: 'focus_gain',
        timestamp: now,
        timeOut: timeOut,
        questionId: state.antifraud.currentQuestionId
      };
      
      const questionData = state.antifraud.questionsDetail[state.antifraud.currentQuestionId];
      if (questionData) {
        questionData.focusEvents.push(focusEvent);
        
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
  // ANTIFRAUDE: Preparar Datos para Envío (MEJORADO)
  // =============================
  function prepareAntifraudData() {
    const now = getTimestamp();
    const totalExamTime = state.antifraud.startTime ? 
      Math.round((now - state.antifraud.startTime) / 1000) : 0;
    
    // Calcular métricas
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
        select_actions: qData.actions.selectActions,
        flags: qData.flags
      };
    });
    
    // Porcentajes
    const percentageOutOfFocus = totalExamTime > 0 ? 
      Math.round((state.antifraud.totalOutOfFocusTime / totalExamTime) * 100) : 0;
    
    const avgTimePerQuestion = state.questions.length > 0 ? 
      Math.round(totalQuestionsTime / state.questions.length) : 0;
    
    // 🔴 FLAGS MEJORADOS
    if (totalExamTime < 300 && state.questions.length >= 8) {
      state.antifraud.flags.push('exam_completed_too_fast');
    }
    
    if (percentageOutOfFocus > 20) {
      state.antifraud.flags.push('high_out_of_focus_percentage');
    }
    
    const totalCopyPaste = state.antifraud.totalCopyActions + state.antifraud.totalPasteActions;
    if (totalCopyPaste > 10) {
      state.antifraud.flags.push('excessive_copy_paste_total');
    }
    
    if (state.antifraud.totalTabChanges > 5) {
      state.antifraud.flags.push('excessive_tab_changes');
    }
    
    if (state.antifraud.totalScreenshotAttempts > 0) {
      state.antifraud.flags.push(`screenshot_attempts_${state.antifraud.totalScreenshotAttempts}`);
    }
    
    if (state.antifraud.focusLossCount > 10) {
      state.antifraud.flags.push(`excessive_focus_loss_${state.antifraud.focusLossCount}`);
    }
    
    // Agregar strikes a los flags
    if (strikes.count > 0) {
      state.antifraud.flags.push(`strikes_${strikes.count}`);
      strikes.reasons.forEach((strike, i) => {
        state.antifraud.flags.push(`strike_${i+1}_${strike.reason.substring(0, 50)}`);
      });
    }
    
    return {
      basics: {
        lang: navigator.language || 'unknown',
        user_agent: navigator.userAgent.substring(0, 500),
        timed_out: state.timedOut,
        remaining_seconds: state.remaining,
        total_questions: state.questions.length,
        exam_duration_seconds: totalExamTime,
        strikes_count: strikes.count,
        mobile_detected: state.antifraud.browserInfo.isMobile
      },
      
      browser_info: state.antifraud.browserInfo,
      
      times: {
        start_time: state.antifraud.startTime ? new Date(state.antifraud.startTime).toISOString() : null,
        end_time: new Date(now).toISOString(),
        total_exam_seconds: totalExamTime,
        total_out_of_focus_seconds: state.antifraud.totalOutOfFocusTime,
        percentage_out_of_focus: percentageOutOfFocus,
        average_time_per_question: avgTimePerQuestion,
        focus_loss_count: state.antifraud.focusLossCount,
        time_per_question_summary: questionsSummary
      },
      
      actions: {
        total_tab_changes: state.antifraud.totalTabChanges,
        total_copy_actions: state.antifraud.totalCopyActions,
        total_paste_actions: state.antifraud.totalPasteActions,
        total_cut_actions: state.antifraud.totalCutActions,
        total_select_actions: state.antifraud.totalSelectActions,
        screenshot_attempts: state.antifraud.totalScreenshotAttempts,
        screenshot_timestamps: state.antifraud.screenshotTimestamps,
        context_menu_attempts: state.antifraud.contextMenuAttempts,
        dev_tools_attempts: state.antifraud.devToolsAttempts,
        total_copy_paste_actions: totalCopyPaste
      },
      
      questions_detail: state.antifraud.questionsDetail,
      
      answer_snapshots: state.antifraud.answerSnapshots.slice(-20), // Últimos 20 snapshots
      
      patterns: state.antifraud.patterns,
      
      strikes: {
        count: strikes.count,
        reasons: strikes.reasons
      },
      
      flags: state.antifraud.flags,
      
      metadata: {
        submission_timestamp: new Date().toISOString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        client_timestamp: now,
        exam_version: '2.0', // Versión mejorada
        security_level: 'high'
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
  // Normalización evaluación (mantenida)
  // =============================
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
  // CV picker (mantenido)
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
  // Validation (mantenida)
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
    if (!github?.value.trim()) return false;

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
  // Load positions + preload eval (mantenido)
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
  // Exam UI (mantenido con mejoras)
  // =============================
  function ensureQuestionUI() {
    if (!questionHost) return;
    if (questionHost.querySelector("#qText") && questionHost.querySelector("#qAnswer")) return;

    questionHost.innerHTML = `
      <div class="question">
        <div id="qText" class="question__text"></div>
        <textarea id="qAnswer" class="input textarea" rows="6"></textarea>
        <div class="answer-warning hidden" id="answerWarning">
          ⚠️ Solo se permite escritura manual. Pegar contenido está bloqueado.
        </div>
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
    const answerWarning = questionHost.querySelector("#answerWarning");

    const prompt = String(q.prompt || q.text || q.question || "").trim();
    qTextEl2.textContent = `${currentIndex + 1} de ${state.questions.length}. ${prompt}`;

    qAnswerEl2.value = state.answers[currentIndex] || "";
    qAnswerEl2.placeholder = "Escribe tu respuesta aquí (solo escritura manual)...";
    
    // Mostrar advertencia sobre pegado bloqueado
    if (answerWarning && state.antifraud.totalPasteActions > 0) {
      show(answerWarning);
      answerWarning.textContent = `⚠️ Pegar está bloqueado. Se han detectado ${state.antifraud.totalPasteActions} intentos de pegar.`;
    }
    
    // 🔴 ANTIFRAUDE: Iniciar tracking de nueva pregunta
    const questionId = q.id || `Q${currentIndex + 1}`;
    startQuestionTracking(questionId);
    
    // Configurar eventos del textarea
    qAnswerEl2.onpaste = (e) => {
      e.preventDefault();
      state.antifraud.totalPasteActions++;
      addStrike('Intento de pegar en respuesta');
      
      // Mostrar feedback visual
      qAnswerEl2.style.borderColor = '#dc2626';
      qAnswerEl2.style.boxShadow = '0 0 0 3px rgba(220, 38, 38, 0.1)';
      setTimeout(() => {
        qAnswerEl2.style.borderColor = '';
        qAnswerEl2.style.boxShadow = '';
      }, 1000);
    };
    
    qAnswerEl2.oncopy = (e) => {
      e.preventDefault();
      state.antifraud.totalCopyActions++;
      addStrike('Intento de copiar respuesta');
    };
    
    qAnswerEl2.oncut = (e) => {
      e.preventDefault();
      state.antifraud.totalCutActions++;
      addStrike('Intento de cortar respuesta');
    };
    
    // Prevenir menú contextual
    qAnswerEl2.oncontextmenu = (e) => {
      e.preventDefault();
      state.antifraud.contextMenuAttempts++;
      addStrike('Intento de abrir menú contextual');
    };
    
    // Detectar selección de texto (para ayuda de IA)
    qAnswerEl2.onselect = (e) => {
      state.antifraud.totalSelectActions++;
      
      // Si selecciona mucho texto rápidamente
      if (qAnswerEl2.selectionEnd - qAnswerEl2.selectionStart > 100) {
        addStrike('Selección extensa de texto detectada');
      }
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
    // 🚨 BLOQUEAR DISPOSITIVOS MÓVILES
    if (!detectAndBlockMobile()) {
      return;
    }

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

    // 🔴 ANTIFRAUDE: Inicializar sistema COMPLETO
    state.antifraud.startTime = Date.now();
    state.antifraud.endTime = null;
    state.antifraud.totalOutOfFocusTime = 0;
    state.antifraud.totalTabChanges = 0;
    state.antifraud.totalCopyActions = 0;
    state.antifraud.totalPasteActions = 0;
    state.antifraud.totalCutActions = 0;
    state.antifraud.totalSelectActions = 0;
    state.antifraud.totalScreenshotAttempts = 0;
    state.antifraud.screenshotTimestamps = [];
    state.antifraud.contextMenuAttempts = 0;
    state.antifraud.devToolsAttempts = 0;
    state.antifraud.focusLossCount = 0;
    state.antifraud.questionsDetail = {};
    state.antifraud.flags = [];
    state.antifraud.answerSnapshots = [];
    state.antifraud.patterns = {
      rapidSequenceAnswers: 0,
      copyPastePattern: false,
      tabSwitchPattern: false,
      screenshotPattern: false,
      mobilePattern: false
    };

    // Reiniciar strikes
    strikes = { count: 0, reasons: [] };

    currentIndex = 0;
    state.examStarted = true;

    // 🔴 APLICAR BLOQUEO DE SELECCIÓN
    const { applyNoSelection } = blockTextSelection();
    applyNoSelection();

    // 🔴 CONFIGURAR DETECCIONES
    setupScreenshotDetection();
    setupFocusTracking();
    setupWritingDetection();

    // 🔴 Detectar DevTools periódicamente
    setInterval(() => {
      if (!state.examStarted) return;
      
      // Detectar consola abierta
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
      
      if (window.outerWidth - window.innerWidth > widthThreshold || 
          window.outerHeight - window.innerHeight > widthThreshold) {
        state.antifraud.devToolsAttempts++;
        const flag = 'dev_tools_open';
        if (!state.antifraud.flags.includes(flag)) {
          state.antifraud.flags.push(flag);
        }
      }
    }, 30000);

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  // =============================
  // Modal Functions (mantenidas)
  // =============================
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
            <svg xmlns="http://www.w3.org2000/svg" viewBox="0 0 24 24" fill="currentColor">
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
    // 🔴 ANTIFRAUDE: Finalizar tracking
    if (state.antifraud.currentQuestionId) {
      endQuestionTracking(state.antifraud.currentQuestionId);
    }
    
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

      // 🔴 ANTIFRAUDE: Preparar datos COMPLETOS MEJORADOS
      const antifraudData = prepareAntifraudData();

      const payload = {
        candidate: {
          positionId: pid,
          roleId: pid,
          role: pid,

          first_name: firstName.value.trim(),
          last_name: lastName.value.trim(),
          cedula: cedula.value.trim(),

          email: email.value.trim(),
          phone: phone.value.trim(),
          github: github.value.trim(),
          linkedin: (linkedin?.value || "").trim(),

          university: university.value.trim(),
          career: career.value.trim(),
          semester: semester.value.trim(),
        },
        meta: antifraudData.basics,
        questions: state.questions.map((q, i) => ({
          id: q.id || q.qid || `Q${i + 1}`,
          moduleId: q.moduleId || q.module || "",
          moduleName: q.moduleName || "",
          prompt: q.prompt || q.text || q.question || "",
          answer: normalizeText(state.answers[i] || ""),
        })),
        cv: {
          name: file.name || "cv.pdf",
          mime: file.type || "application/pdf",
          base64: cvB64,
        },
        antifraud: antifraudData,
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
  // Events - SISTEMA COMPLETO MEJORADO
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

  // 🔴 CONFIGURAR EVENTOS GLOBALES ANTIFRAUDE
  document.addEventListener('DOMContentLoaded', () => {
    // Configurar bloqueo de copy/paste
    blockAllCopyPaste();
    
    // Detectar móviles inmediatamente
    detectAndBlockMobile();
  });

  // Eventos de teclado para bloquear atajos
  document.addEventListener("keydown", (e) => {
    if (!state.examStarted) return;
    
    // Bloquear Ctrl+F / Cmd+F (búsqueda)
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault();
      setMsg(examError, '⚠️ La búsqueda en página está deshabilitada.');
      setTimeout(() => setMsg(examError, ''), 3000);
    }
    
    // Bloquear Ctrl+S / Cmd+S (guardar)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      setMsg(examError, '⚠️ Guardar página está deshabilitado.');
      setTimeout(() => setMsg(examError, ''), 3000);
    }
    
    // Bloquear Ctrl+P / Cmd+P (imprimir)
    if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
      e.preventDefault();
      setMsg(examError, '⚠️ Imprimir está deshabilitado.');
      setTimeout(() => setMsg(examError, ''), 3000);
    }
    
    // Bloquear F12 y atajos de DevTools
    if (e.key === 'F12' || 
        (e.ctrlKey && e.shiftKey && e.key === 'I') ||
        (e.ctrlKey && e.shiftKey && e.key === 'J') ||
        (e.ctrlKey && e.shiftKey && e.key === 'C') ||
        (e.metaKey && e.altKey && e.key === 'I')) {
      e.preventDefault();
      state.antifraud.devToolsAttempts++;
      addStrike('Intento de abrir herramientas de desarrollo');
    }
  });

  // Bloquear menú contextual en toda la página
  document.addEventListener("contextmenu", (e) => {
    if (!state.examStarted) return;
    e.preventDefault();
    state.antifraud.contextMenuAttempts++;
    addStrike('Intento de abrir menú contextual');
  });

  // =============================
  // Init MEJORADO
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
/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - Botón "Iniciar prueba" deshabilitado hasta que el formulario esté OK + evaluación OK
   - Step 1: Datos del postulante
   - Step 2: Solo evaluación (pregunta + respuesta)
*/

// 🔐 API KEY pública para evaluación (se puede sobreescribir por <meta name="PUBLIC_EVAL_API_KEY" ...>)
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
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`; // ?position_id=xxx
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  // Si existe meta, también se puede tomar de ahí
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
  const btnPrev = $("btnPrev");     // se mantiene en DOM (hidden por HTML)
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  // Modal info
  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  // Modal resultado
  const modalResult = $("modalResult");
  const mrMsg = $("mrMsg");

  // =============================
  // State
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

    incidents: {
      total: 0,
      byQuestion: {}
    }
  };

  let currentIndex = 0;

  // =============================
  // Utils UI
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

  // =============================
  // Incidents (NO se muestran al candidato)
  // =============================
  function ensureIncidentSlot(index) {
    if (!state.incidents.byQuestion[index]) {
      state.incidents.byQuestion[index] = {
        copy: 0,
        paste: 0,
        cut: 0,
        blur: 0,
        screenshot: 0
      };
    }
  }

  function registerIncident(type) {
    state.incidents.total++;
    ensureIncidentSlot(currentIndex);
    if (state.incidents.byQuestion[currentIndex][type] !== undefined) {
      state.incidents.byQuestion[currentIndex][type]++;
    }
    // contador oculto en UI
    const el = document.getElementById("incidents");
    if (el) el.textContent = String(state.incidents.total);
  }

  // =============================
  // HTTP + Retry + Warmup (Render sleep)
  // =============================
  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-Api-Key"] = PUBLIC_KEY;
    return h;
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function withRetry(fn, tries = 12) {
    let lastErr = null;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const wait = i === 0 ? 600 : Math.min(12000, 900 * Math.pow(1.55, i));
        await sleep(wait);
      }
    }
    throw lastErr || new Error("No se pudo completar la operación.");
  }

  async function warmUpService() {
    // Dispara requests "opacos" (no-cors) para despertar Render sin bloquear por CORS
    try {
      await fetch(API_BASE, { method: "GET", mode: "no-cors", cache: "no-store" });
    } catch (_) {}
    try {
      await fetch(ENDPOINT_POSITIONS, { method: "GET", mode: "no-cors", cache: "no-store" });
    } catch (_) {}
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
  // Normalización evaluación + selección aleatoria (8 módulos)
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

      // ✅ 8 módulos: escoger 1 pregunta por módulo (aleatorio)
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

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
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

    qAnswerEl2.onpaste = (e) => { e.preventDefault(); registerIncident("paste"); };
    qAnswerEl2.oncopy  = (e) => { e.preventDefault(); registerIncident("copy"); };
    qAnswerEl2.oncut   = (e) => { e.preventDefault(); registerIncident("cut"); };

    const prompt = String(q.prompt || q.text || q.question || "").trim();
    qTextEl2.textContent = `${currentIndex + 1} de ${state.questions.length}. ${prompt}`;

    qAnswerEl2.value = state.answers[currentIndex] || "";
    qAnswerEl2.placeholder = "Escribe tu respuesta aquí...";
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

    currentIndex = 0;
    state.examStarted = true;

    goToExamStep();
    renderQuestion();
    startTimer();
  }

  function openModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("hidden", "is-hidden");
    modalInfo.classList.add("open");
  }

  function closeModalInfo() {
    if (!modalInfo) return;
    modalInfo.classList.remove("open");
    modalInfo.classList.add("hidden");
  }

  function openModalResult(msg) {
    if (mrMsg) mrMsg.textContent = msg || "";
    if (!modalResult) return;
    modalResult.classList.remove("hidden", "is-hidden");
    modalResult.classList.add("open");
  }

  function closeModalResult() {
    if (!modalResult) return;
    modalResult.classList.remove("open");
    modalResult.classList.add("hidden");
  }

  async function finishExam(force = false) {
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
        meta: {
          user_agent: navigator.userAgent,
          lang: navigator.language,
          timed_out: !!state.timedOut,
          remaining_seconds: Number(state.remaining || 0),
        },
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
        incidents: {
          total: state.incidents.total,
          detail: state.incidents.byQuestion
        },
      };

      await postJson(ENDPOINT_SUBMIT, payload);

      stopTimer();
      openModalResult(state.timedOut ? "Tiempo finalizado. Evaluación enviada." : "Evaluación enviada.");
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
        openModalResult("Has excedido el máximo permitido: 2 evaluaciones por año.");
        return;
      }

      setMsg(examError, msg || "No se pudo enviar la evaluación.");
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.textContent = originalText;
    }
  }

  // =============================
  // Events
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

  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });

  modalResult?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalResult);
  });

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

  ["copy", "cut", "paste"].forEach((evt) => {
    document.addEventListener(evt, (e) => {
      if (!state.examStarted) return;
      e.preventDefault();
      registerIncident(evt);
    });
  });

  window.addEventListener("blur", () => {
    if (!state.examStarted) return;
    registerIncident("blur");
  });

  document.addEventListener("visibilitychange", () => {
    if (!state.examStarted) return;
    if (document.visibilityState === "hidden") registerIncident("blur");
  });

  window.addEventListener("keydown", (e) => {
    if (!state.examStarted) return;
    if (e.key === "PrintScreen") registerIncident("screenshot");
  });

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    btnStart.disabled = true;
    updateCvPickerLabel();

    setMsg(serviceInfo, "Activando servicio...");
    await warmUpService();

    try {
      await withRetry(async () => {
        await loadPositions();
        const optionsCount = roleSelect?.querySelectorAll("option")?.length || 0;
        if (optionsCount <= 1) throw new Error("Cargos aún no disponibles");
      }, 14);

      setMsg(serviceInfo, "");
    } catch (_) {
      setMsg(serviceInfo, "");
      setMsg(formError, "El servicio está iniciando. Espera unos segundos y recarga la página.");
      roleSelect.innerHTML = `<option value="" selected>Error al cargar</option>`;
    }

    refreshStartButton();
  });

  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible") {
      await warmUpService();
    }
  });
})();
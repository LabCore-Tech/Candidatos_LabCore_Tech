/* LabCore - Evaluación de ingreso (front)
   - Carga cargos (positions)
   - Precarga evaluación (questions) por cargo
   - Habilita "Iniciar prueba" SOLO cuando el formulario es válido + hay preguntas
   - Step 1: Datos del postulante
   - Step 2: Solo pregunta + textarea de respuesta (responsive)
*/

// 🔐 API KEY pública para evaluación (Front)
window.PUBLIC_EVAL_API_KEY =
  "pt_eval_c21c285a5edf133c981b961910f2c26140712e5a6efbda98";

(() => {
  // =============================
  // Config
  // =============================
  const API_BASE = "https://protrack-49um.onrender.com";

  const ENDPOINT_POSITIONS = `${API_BASE}/api/gh/public/positions`;
  const ENDPOINT_EVAL = `${API_BASE}/api/gh/public/eval`; // ?position_id=xxx
  const ENDPOINT_SUBMIT = `${API_BASE}/api/gh/public/submit`;

  const metaKey =
    document
      .querySelector('meta[name="PUBLIC_EVAL_API_KEY"]')
      ?.getAttribute("content") || "";

  const PUBLIC_KEY = window.PUBLIC_EVAL_API_KEY || metaKey || "";

  // =============================
  // DOM
  // =============================
  const $ = (id) => document.getElementById(id);

  const form = $("candidateForm");

  const firstName = $("firstName");
  const lastName = $("lastName");
  const cedula = $("cedula");

  const email = $("email");
  const phone = $("phone");
  const github = $("github");
  const linkedin = $("linkedin");

  const university = $("university");
  const career = $("career");
  const semester = $("semester");
  const roleSelect = $("role");

  const cvFile = $("cvFile");
  const cvPicker = $("cvPicker");

  const acceptPolicy = $("acceptPolicy");

  const btnStart = $("btnStart");
  const formError = $("formError");
  const uiMsg = $("uiMsg");

  const examCard = $("examCard");
  const timerEl = $("timer");
  let qTextEl = $("qText");
  let qAnswerEl = $("qAnswer");
  const questionHost = $("questionHost");

  const btnPrev = $("btnPrev");
  const btnNext = $("btnNext");
  const btnSubmit = $("btnSubmit");

  const examError = $("examError");

  // Modales
  const modalInfo = $("modalInfo");
  const btnContinue = $("btnContinue");

  const modalDone = $("modalDone");
  const modalDoneClose = $("modalDoneClose");
  const btnDoneOk = $("btnDoneOk");

  // =============================
  // State
  // =============================
  const state = {
    positions: [],
    evalByPosition: new Map(), // position_id -> normalized eval
    activePositionId: "",
    questions: [],
    answers: [],
    durationSeconds: 10 * 60,
    remaining: 10 * 60,
    timerHandle: null,
    examStarted: false,
    currentIndex: 0,
  };

  // =============================
  // Utils
  // =============================
  function setMsg(el, msg) {
    if (!el) return;
    el.textContent = msg || "";
    el.style.display = msg ? "block" : "none";
  }

  function show(el) {
    if (!el) return;
    el.classList.remove("is-hidden");
    el.classList.remove("hidden");
  }

  function hide(el) {
    if (!el) return;
    el.classList.add("is-hidden");
    el.classList.add("hidden");
  }

  function headers() {
    const h = { Accept: "application/json" };
    if (PUBLIC_KEY) h["X-API-Key"] = PUBLIC_KEY; // ✅ clave correcta
    return h;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { method: "GET", headers: headers() });
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!ct.includes("application/json")) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Respuesta no JSON (${res.status}). ${txt.slice(0, 160)}`);
    }

    const data = await res.json();
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
      data = { ok: false, msg: txt?.slice(0, 160) || `HTTP ${res.status}` };
    }

    if (!res.ok || !data || data.ok === false) {
      const msg = data?.msg || data?.message || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.code = data?.code || "";
      throw err;
    }

    return data;
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

  function normalizeEvalResponse(data) {
    if (data?.ok === true) {
      return {
        ok: true,
        position: data.position,
        qb: data.qb,
        questions: Array.isArray(data.questions) ? data.questions : [],
        duration_minutes: 10,
        title: "Evaluación de ingreso",
        raw: data,
      };
    }
    if (data?.eval) {
      return {
        ok: true,
        position: data.position,
        qb: data.qb,
        questions: Array.isArray(data.eval.questions) ? data.eval.questions : [],
        duration_minutes: Number(data.eval.duration_minutes || 10),
        title: String(data.eval.title || "Evaluación de ingreso"),
        raw: data,
      };
    }
    return { ok: false, questions: [], raw: data };
  }

  function formatTime(sec) {
    const s = Math.max(0, sec | 0);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }

  // Si el HTML no trae qText/qAnswer, los creamos dentro de questionHost
  function ensureQuestionUI() {
    if (qTextEl && qAnswerEl) return;
    if (!questionHost) return;

    questionHost.innerHTML = `
      <div class="question">
        <div id="qText" class="question__text"></div>
        <textarea id="qAnswer" class="input textarea" rows="6"></textarea>
      </div>
    `.trim();

    qTextEl = questionHost.querySelector("#qText");
    qAnswerEl = questionHost.querySelector("#qAnswer");
  }

  // =============================
  // Step control
  // =============================
  function goToExamStep() {
    hide(form);
    show(examCard);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =============================
  // CV picker
  // =============================
  function updateCvPickerLabel() {
    if (!cvPicker) return;
    const f = cvFile?.files?.[0];
    const label = f ? f.name : "Haz clic para adjuntar tu PDF";
    // cvPicker es BUTTON
    cvPicker.textContent = label;
  }

  // =============================
  // Validation
  // =============================
  function isFormOk() {
    if (!firstName?.value?.trim()) return false;
    if (!lastName?.value?.trim()) return false;
    if (!cedula?.value?.trim()) return false;

    // ✅ FIX CLAVE: NO es "role.value", es roleSelect.value
    if (!roleSelect?.value) return false;

    if (!email?.value?.trim()) return false;
    if (!phone?.value?.trim()) return false;
    if (!github?.value?.trim()) return false;

    if (!cvFile || cvFile.files.length === 0) return false;

    if (!university?.value?.trim()) return false;
    if (!acceptPolicy?.checked) return false;

    return true;
  }

  function refreshStartButton() {
    if (!btnStart) return;
    show(btnStart); // visible siempre
    btnStart.disabled = !isFormOk();
  }

  // =============================
  // Data load
  // =============================
  async function loadPositions() {
    setMsg(uiMsg, "Cargando cargos...");
    try {
      const data = await fetchJson(ENDPOINT_POSITIONS);

      // ✅ robusto: soporta {positions} o array directo
      const positions = Array.isArray(data)
        ? data
        : data.positions || data.items || data.data || [];

      state.positions = positions;

      roleSelect.innerHTML = `<option value="" disabled selected>Selecciona un cargo</option>`;

      for (const p of positions) {
        const id = String(p.position_id || p.id || "").trim();
        const name = String(p.position_name || p.name || id);
        if (!id) continue;

        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = name;
        roleSelect.appendChild(opt);
      }

      setMsg(uiMsg, "");
      setMsg(formError, "");
    } catch (err) {
      setMsg(uiMsg, "");
      setMsg(formError, `No se pudieron cargar cargos: ${err.message}`);
    } finally {
      refreshStartButton();
    }
  }

  async function preloadEvalForPosition(positionId) {
    if (!positionId) return;
    if (state.evalByPosition.has(positionId)) return;

    setMsg(uiMsg, "Cargando evaluación...");
    try {
      const url = `${ENDPOINT_EVAL}?position_id=${encodeURIComponent(positionId)}`;
      const data = await fetchJson(url);
      const normalized = normalizeEvalResponse(data);

      state.evalByPosition.set(positionId, normalized);

      if (!normalized.ok) {
        setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      } else if (!normalized.questions?.length) {
        setMsg(formError, "La evaluación existe, pero no tiene preguntas.");
      } else {
        setMsg(formError, "");
      }
    } catch (err) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
    } finally {
      setMsg(uiMsg, "");
      refreshStartButton();
    }
  }

  // =============================
  // Exam
  // =============================
  function stopTimer() {
    if (state.timerHandle) clearInterval(state.timerHandle);
    state.timerHandle = null;
  }

  function startTimer() {
    stopTimer();
    if (timerEl) timerEl.textContent = formatTime(state.remaining);

    state.timerHandle = setInterval(() => {
      state.remaining -= 1;
      if (timerEl) timerEl.textContent = formatTime(state.remaining);
      if (state.remaining <= 0) {
        stopTimer();
        finishExam().catch(() => {});
      }
    }, 1000);
  }

  function saveCurrentAnswer() {
    if (!qAnswerEl) return;
    state.answers[state.currentIndex] = (qAnswerEl.value || "").trim();
  }

  function renderQuestion() {
    ensureQuestionUI();
    const q = state.questions[state.currentIndex];
    if (!q) return;

    const moduleName = q.moduleName || q.module || "";
    const prompt = q.prompt || q.text || q.question || "";

    if (qTextEl) {
      qTextEl.textContent = moduleName
        ? `${state.currentIndex + 1}. ${moduleName}: ${prompt}`
        : `${state.currentIndex + 1}. ${prompt}`;
    }

    if (qAnswerEl) {
      qAnswerEl.value = state.answers[state.currentIndex] || "";
      qAnswerEl.placeholder = "Escribe tu respuesta aquí...";
      qAnswerEl.focus();
    }

    const last = state.currentIndex === state.questions.length - 1;

    if (btnPrev) btnPrev.disabled = state.currentIndex === 0;

    if (btnNext) btnNext.style.display = last ? "none" : "inline-flex";
    if (btnSubmit) btnSubmit.style.display = last ? "inline-flex" : "none";

    setMsg(examError, "");
  }

  async function finishExam() {
    saveCurrentAnswer();

    const empty = state.answers.findIndex((a) => !a || !a.trim());
    if (empty !== -1) {
      state.currentIndex = empty;
      renderQuestion();
      setMsg(examError, `Falta responder la pregunta ${empty + 1}.`);
      return;
    }

    const file = cvFile?.files?.[0];
    if (!file) {
      setMsg(examError, "Falta adjuntar el CV.");
      return;
    }
    if ((file.type || "").toLowerCase() !== "application/pdf") {
      setMsg(examError, "El CV debe ser PDF.");
      return;
    }

    const originalSubmitText = btnSubmit?.textContent || "Enviar evaluación";
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.textContent = "Enviando...";
    }

    try {
      const cvB64 = await fileToBase64NoPrefix(file);
      const pid = roleSelect.value.trim();

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
          linkedin: linkedin ? linkedin.value.trim() : "",

          university: university.value.trim(),
          career: career ? career.value.trim() : "",
          semester: semester ? semester.value.trim() : "",
        },
        meta: {
          user_agent: navigator.userAgent,
          lang: navigator.language,
        },
        questions: state.questions.map((q, i) => ({
          id: q.id || q.qid || `Q${i + 1}`,
          moduleId: q.moduleId || q.module || "",
          moduleName: q.moduleName || "",
          prompt: q.prompt || q.text || q.question || "",
          answer: (state.answers[i] || "").trim(),
        })),
        cv: {
          name: file.name || "cv.pdf",
          mime: file.type || "application/pdf",
          base64: cvB64,
        },
      };

      await postJson(ENDPOINT_SUBMIT, payload);

      openModalDone("Evaluación enviada");
    } catch (err) {
      setMsg(examError, err?.message || "No se pudo enviar la evaluación.");
    } finally {
      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.textContent = originalSubmitText;
      }
    }
  }

  // =============================
  // Modals
  // =============================
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

  function openModalDone(title) {
    if (!modalDone) return;
    const t = $("modalDoneTitle");
    if (t) t.textContent = title || "Listo";
    modalDone.classList.remove("hidden", "is-hidden");
    modalDone.classList.add("open");
  }

  function closeModalDone() {
    if (!modalDone) return;
    modalDone.classList.remove("open");
    modalDone.classList.add("hidden");
  }

  // =============================
  // Events
  // =============================
  const revalidate = () => refreshStartButton();

  [firstName, lastName, cedula, university, career, semester].forEach((el) =>
    el?.addEventListener("input", revalidate)
  );

  [email, phone, github, linkedin].forEach((el) =>
    el?.addEventListener("input", revalidate)
  );

  acceptPolicy?.addEventListener("change", revalidate);

  roleSelect?.addEventListener("change", async () => {
    const pid = roleSelect.value.trim();
    state.activePositionId = pid;
    await preloadEvalForPosition(pid);
    refreshStartButton();
  });

  // CV picker
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

  // Start -> modal
  btnStart?.addEventListener("click", (e) => {
    e.preventDefault();
    openModalInfo();
  });

  btnContinue?.addEventListener("click", () => {
    closeModalInfo();

    const pid = roleSelect.value.trim();
    const evalData = state.evalByPosition.get(pid);

    if (!evalData?.ok || !evalData.questions?.length) {
      setMsg(formError, "No se pudo cargar la evaluación para ese cargo.");
      refreshStartButton();
      return;
    }

    state.examStarted = true;
    state.activePositionId = pid;
    state.questions = evalData.questions;
    state.answers = new Array(state.questions.length).fill("");

    state.durationSeconds = Math.max(1, (evalData.duration_minutes || 10) * 60);
    state.remaining = state.durationSeconds;
    state.currentIndex = 0;

    goToExamStep();
    renderQuestion();
    startTimer();
  });

  modalInfo?.querySelectorAll('[data-close="1"]').forEach((el) => {
    el.addEventListener("click", closeModalInfo);
  });

  // Exam nav
  btnPrev?.addEventListener("click", () => {
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (state.currentIndex > 0) {
      state.currentIndex -= 1;
      renderQuestion();
    }
  });

  btnNext?.addEventListener("click", (e) => {
    e.preventDefault();
    if (!state.examStarted) return;
    saveCurrentAnswer();
    if (state.currentIndex < state.questions.length - 1) {
      state.currentIndex += 1;
      renderQuestion();
    }
  });

  btnSubmit?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!state.examStarted) return;
    await finishExam();
  });

  qAnswerEl?.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      // si existe btnNext lo usa, si no, submit
      if (btnNext && btnNext.style.display !== "none") btnNext.click();
      else btnSubmit?.click();
    }
  });

  modalDoneClose?.addEventListener("click", closeModalDone);
  btnDoneOk?.addEventListener("click", closeModalDone);

  // =============================
  // Init
  // =============================
  document.addEventListener("DOMContentLoaded", async () => {
    hide(examCard);
    show(form);

    show(btnStart);
    btnStart.disabled = true;

    updateCvPickerLabel();

    await loadPositions();
    refreshStartButton();
  });
})();
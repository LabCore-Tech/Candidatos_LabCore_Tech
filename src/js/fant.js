(() => {
  // =============================
  // Render wake (silencioso)
  // =============================
  const RENDER_URL = "https://protrack-49um.onrender.com/"; 
  const DURATION_MS = 5 * 60 * 1000; // 5 minutos
  const INTERVAL_MS = 20 * 1000;     // ping cada 20s

  const start = Date.now();

  function ensurePixel() {
    let img = document.getElementById("fantPixel");
    if (img) return img;

    img = document.createElement("img");
    img.id = "fantPixel";
    img.className = "fant-pixel";
    img.alt = "";
    img.width = 1;
    img.height = 1;
    document.body.appendChild(img);
    return img;
  }

  function ping() {
    const img = ensurePixel();
    const base = RENDER_URL.replace(/\/$/, "");
    // Cache-buster + contador: fuerza request real
    img.src = `${base}/?wake=${Date.now()}`;
  }

  // Inicia apenas carga el DOM
  function startWake() {
    // ping inmediato
    ping();

    const t = setInterval(() => {
      if (Date.now() - start >= DURATION_MS) {
        clearInterval(t);
        return;
      }
      ping();
    }, INTERVAL_MS);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startWake, { once: true });
  } else {
    startWake();
  }
})();

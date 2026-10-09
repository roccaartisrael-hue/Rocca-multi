/*! BOOL AI Enterprise banner. Usage:
 *  <div data-bool-banner></div>
 *  <script src="https://boolai.co.il/bool-banner.js" defer></script>
 *  Optional: data-lang="en|es|he|fr" on the div (default: page language, then browser language).
 */
(function () {
  var URL_ = "https://boolai.co.il";
  var COPY = {
    en: { dir: "ltr", h: "Your Marketing Agency in a Box", b: "Put your business growth on autopilot. AI-crafted posts, automated scheduling, and direct Meta publishing.", c: "Start Free – 3 Free Credits" },
    es: { dir: "ltr", h: "Tu Agencia de Marketing en una App", b: "Pon tus redes sociales en piloto automático. Creación con IA, programación inteligente y publicación directa.", c: "Empieza Gratis – 3 Acciones de Regalo" },
    he: { dir: "rtl", h: "סוכנות שיווק שלמה בתוך אפליקציה אחת", b: "טייס אוטומטי לרשתות החברתיות. יצירת תוכן ב-AI, פרסום בלחיצה ולידים ישירות לעסק.", c: "מתחילים בחינם – 3 פעולות מתנה" },
    fr: { dir: "ltr", h: "Votre Agence Marketing dans une App", b: "Automatisez vos réseaux sociaux grâce à l'IA. Création de contenu, calendrier automatisé et publication en un clic.", c: "Essai Gratuit – 3 Crédits Offerts" }
  };
  var CSS = ".bool-banner{position:relative;display:flex;align-items:center;justify-content:space-between;gap:24px;box-sizing:border-box;width:100%;max-width:1080px;margin:24px auto;padding:28px 32px;border-radius:16px;border:1px solid rgba(255,255,255,.1);background:radial-gradient(120% 140% at 0% 0%,rgba(99,102,241,.35),transparent 55%),linear-gradient(135deg,#0c0c14,#12122a);color:#fafafa;text-decoration:none;overflow:hidden;font-family:Heebo,Inter,system-ui,-apple-system,Segoe UI,sans-serif;transition:transform .25s ease,border-color .25s ease,box-shadow .25s ease}" +
    ".bool-banner:hover{transform:translateY(-3px);border-color:rgba(165,180,252,.55);box-shadow:0 18px 50px -18px rgba(99,102,241,.7)}" +
    ".bool-banner:focus-visible{outline:2px solid #a5b4fc;outline-offset:3px}" +
    ".bool-banner .bb-t{min-width:0;flex:1}" +
    ".bool-banner .bb-k{font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#a5b4fc;margin:0 0 8px}" +
    ".bool-banner .bb-h{font-size:clamp(20px,3.2vw,30px);line-height:1.2;font-weight:700;margin:0 0 8px}" +
    ".bool-banner .bb-b{font-size:clamp(14px,1.8vw,16px);line-height:1.6;color:#c7c9d1;margin:0;max-width:560px}" +
    ".bool-banner .bb-c{flex:0 0 auto;display:inline-flex;align-items:center;gap:8px;background:#fff;color:#1e1b78;font-weight:700;font-size:15px;padding:13px 22px;border-radius:999px;white-space:nowrap}" +
    ".bool-banner .bb-c i{display:inline-block;transition:transform .25s ease;font-style:normal}" +
    ".bool-banner:hover .bb-c i{transform:translateX(4px)}" +
    ".bool-banner[dir=rtl]:hover .bb-c i{transform:translateX(-4px)}" +
    "@media(max-width:640px){.bool-banner{flex-direction:column;align-items:stretch;gap:18px;padding:22px 20px;margin:16px auto}.bool-banner .bb-c{justify-content:center}}" +
    "@media(prefers-reduced-motion:reduce){.bool-banner,.bool-banner .bb-c i{transition:none}.bool-banner:hover{transform:none}}";
  function pick(el) {
    var l = (el.getAttribute("data-lang") || document.documentElement.lang || navigator.language || "en").slice(0, 2).toLowerCase();
    return COPY[l] ? l : "en";
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function mount() {
    if (!document.getElementById("bool-banner-css")) {
      var st = document.createElement("style"); st.id = "bool-banner-css"; st.textContent = CSS; document.head.appendChild(st);
    }
    document.querySelectorAll("[data-bool-banner]").forEach(function (host) {
      var l = pick(host), c = COPY[l], arrow = c.dir === "rtl" ? "←" : "→";
      host.innerHTML = '<a class="bool-banner" dir="' + c.dir + '" lang="' + l + '" href="' + URL_ + '" target="_blank" rel="noopener">' +
        '<span class="bb-t"><p class="bb-k">BOOL AI</p><p class="bb-h">' + esc(c.h) + '</p><p class="bb-b">' + esc(c.b) + '</p></span>' +
        '<span class="bb-c">' + esc(c.c) + ' <i aria-hidden="true">' + arrow + '</i></span></a>';
    });
  }
  window.addEventListener("langchange", mount);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
})();

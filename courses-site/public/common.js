let lang = localStorage.getItem("lang") || "ru";
let theme = localStorage.getItem("theme") || "dark";
window.siteContacts = {};

function t(key) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
  return dict[key] ?? TRANSLATIONS.ru[key] ?? key;
}

function pluralLessons(n) {
  const k = Math.abs(Number(n) || 0) % 100;
  if (k >= 11 && k <= 19) return t("lessonsWord5");
  const m = k % 10;
  if (lang === "ru") {
    if (m === 1) return t("lessonsWord1");
    if (m >= 2 && m <= 4) return t("lessonsWord2");
    return t("lessonsWord5");
  }
  return t("lessonsWord");
}

function courseCover(c) {
  return escapeHtml(c.image_url || "/uploads/course-default.svg");
}

function pluralViews(n) {
  const k = Math.abs(Number(n) || 0) % 100;
  if (k >= 11 && k <= 19) return t("viewsWord5");
  const m = k % 10;
  if (lang === "ru") {
    if (m === 1) return t("viewsWord1");
    if (m >= 2 && m <= 4) return t("viewsWord2");
    return t("viewsWord5");
  }
  return t("viewsWord");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function nl2br(s) {
  return escapeHtml(s).replace(/\n/g, "<br>");
}

function applyI18n() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-ph]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  renderNav();
}

function setLang(l) {
  lang = l;
  localStorage.setItem("lang", l);
  applyI18n();
}

function setTheme(th) {
  theme = th;
  document.documentElement.dataset.theme = th;
  localStorage.setItem("theme", th);
  renderNav();
}

function initTheme() {
  document.documentElement.dataset.theme = theme;
}

async function fetchMe() {
  try {
    const res = await fetch("/api/me");
    const data = await res.json();
    return data.user;
  } catch { return null; }
}

function getPageName() {
  return (window.location.pathname.split("/").pop() || "index.html");
}

function sectionLinks() {
  const cur = getPageName();
  const links = [
    ["index.html", "home"],
    ["catalog.html", "sectionCourses"],
    ["products.html", "products"],
    ["services.html", "services"],
    ["consultation.html", "consultation"],
    ["reviews.html", "reviews"],
  ];
  return links.map(([href, key]) =>
    `<a class="nav-btn${cur === href ? " active" : ""}" href="${href}" data-i18n="${key}">${t(key)}</a>`
  ).join("");
}

function renderNav() {
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const themeBtn = `<button class="icon-btn" id="theme-btn" title="${theme === "dark" ? t("themeLight") : t("themeDark")}">${theme === "dark" ? "☀" : "🌙"}</button>`;
  const langBtn = `<button class="icon-btn" id="lang-btn" title="Language">${lang === "ru" ? "🇬🇧" : "🇷🇺"}</button>`;
  const sLinks = sectionLinks();
  const cartLink = `<a class="nav-btn cart-link" href="cart.html" data-i18n-title="cart">🛒<span class="cart-badge" id="cart-badge"></span></a>`;
  fetchMe().then(user => {
    if (user) {
      const adminLink = user.role === "admin" ? `<a class="nav-btn" href="admin.html" data-i18n="admin">${t("admin")}</a>` : "";
      nav.innerHTML = `
        ${sLinks}
        ${cartLink}
        ${themeBtn}
        ${langBtn}
        ${adminLink}
        <a class="nav-btn" href="profile.html" data-i18n="myCourses">${t("myCourses")}</a>
        <span class="nav-user">${user.avatar ? `<img class="nav-avatar" src="${escapeHtml(user.avatar)}" alt="">` : "👤"}<span class="nav-user-name">${escapeHtml(user.name)}</span></span>
        <a class="nav-btn" href="#" id="logout-btn" data-i18n="logout">${t("logout")}</a>`;
      document.getElementById("logout-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "index.html";
      });
    } else {
      nav.innerHTML = `
        ${sLinks}
        ${cartLink}
        ${themeBtn}
        ${langBtn}
        <a class="nav-btn" href="register.html" data-i18n="registration">${t("registration")}</a>
        <a class="nav-btn" href="login.html" data-i18n="login">${t("login")}</a>`;
    }
    wireNavButtons();
    wireNavToggle();
    renderCartBadge();
  });
}

function wireNavToggle() {
  const toggle = document.getElementById("nav-toggle");
  const nav = document.getElementById("nav-links");
  if (!toggle || !nav) return;
  if (!toggle.dataset.toggleWired) {
    toggle.dataset.toggleWired = "1";
    toggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("open");
      toggle.classList.toggle("active", isOpen);
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
  }
  nav.classList.remove("open");
  toggle.classList.remove("active");
  toggle.setAttribute("aria-expanded", "false");
  nav.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    nav.classList.remove("open");
    toggle.classList.remove("active");
    toggle.setAttribute("aria-expanded", "false");
  }));
}

function wireNavButtons() {
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) themeBtn.addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));
  const langBtn = document.getElementById("lang-btn");
  if (langBtn) langBtn.addEventListener("click", () => setLang(lang === "ru" ? "en" : "ru"));
}

function renderPagination(container, current, total, onGo) {
  container.innerHTML = "";
  if (total <= 1) return;
  const mk = (label, page, opts = {}) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.disabled = !!opts.disabled;
    if (opts.active) b.classList.add("active");
    b.addEventListener("click", () => onGo(page));
    container.appendChild(b);
  };
  mk("‹", current - 1, { disabled: current <= 1 });
  let pages = [];
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || Math.abs(p - current) <= 1) pages.push(p);
    else if (pages[pages.length - 1] !== "…") pages.push("…");
  }
  pages.forEach(p => {
    if (p === "…") { const s = document.createElement("span"); s.textContent = "…"; s.style.color = "var(--text-faint)"; container.appendChild(s); }
    else mk(String(p), p, { active: p === current });
  });
  mk("›", current + 1, { disabled: current >= total });
}

function pageFromUrl() {
  const p = Number(new URLSearchParams(location.search).get("page"));
  return Number.isInteger(p) && p > 0 ? p : 1;
}

// Хлебные крошки: parts = [{text, href}, ...], последний элемент — текущая страница
function breadcrumbs(parts) {
  return `<nav class="breadcrumbs" aria-label="Breadcrumb">${parts.map((p, i) => {
    const isLast = i === parts.length - 1;
    const body = isLast
      ? `<span class="crumb-current">${escapeHtml(p.text)}</span>`
      : `<a class="crumb-link" href="${escapeHtml(p.href)}">${escapeHtml(p.text)}</a>`;
    return `${body}${isLast ? "" : '<span class="crumb-sep">›</span>'}`;
  }).join("")}</nav>`;
}

// Корзина товаров (localStorage)
function getCart() {
  try { return JSON.parse(localStorage.getItem("cart") || "[]"); } catch { return []; }
}
function saveCart(cart) {
  localStorage.setItem("cart", JSON.stringify(cart));
  renderCartBadge();
}
function addToCart(id, qty) {
  const cart = getCart();
  const line = cart.find(i => i.id === id);
  if (line) line.qty = Math.min(99, (Number(line.qty) || 1) + (Number(qty) || 1));
  else cart.push({ id, qty: Math.min(99, Number(qty) || 1) });
  saveCart(cart);
}
function setCartQty(id, qty) {
  const cart = getCart();
  const line = cart.find(i => i.id === id);
  if (!line) return;
  if (Number(qty) > 0) line.qty = Math.min(99, Number(qty));
  saveCart(cart.filter(i => i.qty > 0));
}
function removeFromCart(id) {
  saveCart(getCart().filter(i => i.id !== id));
}
function cartCount() {
  return getCart().reduce((s, i) => s + (Number(i.qty) || 0), 0);
}
function renderCartBadge() {
  const el = document.getElementById("cart-badge");
  if (!el) return;
  const n = cartCount();
  el.textContent = n;
  el.style.display = n ? "flex" : "none";
}

function fmtPrice(price) {
  const n = Number(price) || 0;
  return n === 0 ? t("free") : n.toLocaleString(lang === "ru" ? "ru-RU" : "en-US") + " ₽";
}

function showError(el, msg) {
  const err = document.getElementById("form-error");
  if (err) { err.textContent = msg; err.classList.add("show"); }
  if (el) el.disabled = false;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, options);
  let data = {};
  try { data = await res.json(); } catch { data = {}; }
  if (!res.ok) throw new Error(translateError(data.error) || `HTTP ${res.status}`);
  return data;
}

function translateError(msg) {
  const map = {
    "Заполните все поля": t("fillAll"),
    "Пароль минимум 6 символов": t("passShort"),
    "Введите корректный номер телефона": t("phoneInvalid"),
    "Email уже зарегистрирован": t("emailExists"),
    "Неверный email или пароль": t("wrongCreds"),
    "Требуется оплата": t("payFail"),
    "Требуется вход": t("login"),
    "Доступ только для администратора": t("accessDenied"),
    "Требуется подтверждение оплаты по SMS": t("smsRequired"),
    "Заполните данные оплаты": t("smsFillPay"),
    "Курс бесплатный, оплата не требуется": t("smsCourseFree"),
    "Бесплатно, оплата не требуется": t("smsCourseFree"),
    "Сначала запросите SMS-код": t("smsFirstRequest"),
    "Код истёк. Запросите новый.": t("smsExpired"),
    "Неверный SMS-код": t("smsWrong"),
    "Корзина пуста": t("cartEmpty"),
    "Товар не найден": t("productNotFound"),
    "Нельзя удалить самого себя": t("delSelfBlocked"),
    "Нельзя удалить последнего администратора": t("delLastAdmin"),
    "Пользователь не найден": t("userNotFound"),
    "Сначала оплатите и запишитесь на курс": t("payFirstEnroll"),
    "Курс не найден": t("courseNotFound"),
    "Преподаватель не найден": t("instructorNotFound"),
    "Урок не найден": t("lessonNotFound"),
    "Курс не завершён": t("courseNotCompleted"),
    "Доступ запрещён": t("accessForbidden"),
    "Оплатите курс, чтобы смотреть видео": t("payToWatch"),
    "Недопустимый тип файла": t("badFileType"),
    "Файл не найден": t("fileNotFound"),
    "Файл не загружен": t("fileNotUploaded"),
    "Запись не найдена": t("itemNotFound"),
    "Запись на эту позицию недоступна": t("bookNotAvailable"),
    "Заполните имя и телефон": t("fillNamePhone"),
  };
  return map[msg] || msg;
}

// ===== Общее модальное окно оплаты (QR + SMS) для товаров, услуг, консультаций и заказов =====
function openPayModal({ itemType, itemId, title, price, onSuccess }) {
  const close = () => overlay.remove();
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal">
      <h3>${t("payTitle")}</h3>
      <div class="pay-body">
        <div class="pay-summary">
          <div class="ps-row"><span class="ps-label">${t("payItem")}</span><span>${escapeHtml(title || "")}</span></div>
          <div class="ps-row"><span class="ps-label">${t("payAmount")}</span></div>
          <div class="ps-amount">${fmtPrice(price)}</div>
        </div>
        <div class="pay-status"><div class="ps-icon">⏳</div><div class="ps-text">${t("payQrGenerating")}</div></div>
      </div>
    </div>`;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  const body = overlay.querySelector(".pay-body");

  const payRequest = () => apiFetch("/api/payment/sms-send", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ itemType, itemId, payment: { method: "qr" } }),
  });

  async function startQr() {
    try {
      const res = await payRequest();
      body.innerHTML = `
        <div class="pay-summary">
          <div class="ps-row"><span class="ps-label">${t("payItem")}</span><span>${escapeHtml(title || "")}</span></div>
          <div class="ps-row"><span class="ps-label">${t("payAmount")}</span></div>
          <div class="ps-amount">${fmtPrice(price)}</div>
        </div>
        <div class="qr-box">
          <img class="qr-img" src="${res.qrImage}" alt="QR">
          <div class="qr-text">${t("payQrText")}</div>
        </div>
        <button class="btn btn-primary" id="qr-paid-btn" style="width:100%">${t("payQrPaid")}</button>
        <div class="secure-note">${t("paySecure")}</div>
      `;
      body.querySelector("#qr-paid-btn").addEventListener("click", () => showSms(res.demoCode));
    } catch (err) {
      body.innerHTML = `<div class="pay-status"><div class="ps-icon">❌</div><div class="ps-text">${escapeHtml(err.message)}</div></div>`;
      setTimeout(close, 2000);
    }
  }

  function showSms(demoCode) {
    body.innerHTML = `
      <div class="pay-summary">
        <div class="ps-row"><span class="ps-label">${t("payItem")}</span><span>${escapeHtml(title || "")}</span></div>
        <div class="ps-row"><span class="ps-label">${t("payAmount")}</span></div>
        <div class="ps-amount">${fmtPrice(price)}</div>
      </div>
      <div class="sms-notice">${t("smsSent")}</div>
      <div class="demo-code-box">${t("smsDemoCode")}: <b>${demoCode}</b></div>
      <div class="form-group full">
        <label>${t("smsCodeLabel")}</label>
        <input id="sms-code" inputmode="numeric" maxlength="6" placeholder="••••••" autocomplete="one-time-code">
      </div>
      <button class="btn btn-primary" id="sms-btn" style="width:100%">${t("smsConfirmBtn")}</button>
      <button class="btn btn-outline" id="sms-resend" style="width:100%;margin-top:8px">${t("smsResend")}</button>
    `;
    const input = body.querySelector("#sms-code");
    input.focus();
    wireInputGuards();
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(0, 6);
      if (input.value.length === 6) body.querySelector("#sms-btn").click();
    });
    body.querySelector("#sms-btn").addEventListener("click", () => confirmSms(input.value));
    body.querySelector("#sms-resend").addEventListener("click", async () => {
      try {
        const res = await payRequest();
        body.querySelector(".demo-code-box b").textContent = res.demoCode;
        alert(t("smsResent"));
      } catch (err) { alert(err.message); }
    });
  }

  async function confirmSms(code) {
    if (!/^\d{6}$/.test(code)) { alert(t("smsCodeInvalid")); return; }
    body.innerHTML = `<div class="pay-status"><div class="ps-icon">⏳</div><div class="ps-text">${t("payProcessing")}</div></div>`;
    try {
      await apiFetch("/api/payment/sms-confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemType, itemId, code }),
      });
      body.innerHTML = `<div class="pay-status"><div class="ps-icon">✅</div><div class="ps-text">${t("paySuccess")}</div></div>`;
      setTimeout(() => {
        close();
        if (onSuccess) onSuccess();
      }, 1200);
    } catch (err) {
      body.innerHTML = `<div class="pay-status"><div class="ps-icon">❌</div><div class="ps-text">${escapeHtml(err.message)}</div></div>`;
      setTimeout(close, 2000);
    }
  }

  startQr();
  return overlay;
}

function injectFooter() {
  if (document.getElementById("site-footer")) return;
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.id = "site-footer";
  const year = new Date().getFullYear();
  const c = window.siteContacts || {};
  const email = c.contact_email || "support@courses.ru";
  const phone = c.contact_phone || "+7 999 000-00-00";
  const phoneDigits = phone.replace(/\D/g, "");
  const tg = messengerUrl("contact_telegram", c.contact_telegram);
  const wa = messengerUrl("contact_whatsapp", c.contact_whatsapp);
  const vk = messengerUrl("contact_vk", c.contact_vk);
  let socialLinks = "";
  if (tg) socialLinks += `<a href="${escapeHtml(tg)}" target="_blank" rel="noopener">✈ Telegram</a>`;
  if (wa) socialLinks += `<a href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>`;
  if (vk) socialLinks += `<a href="${escapeHtml(vk)}" target="_blank" rel="noopener">VK ВКонтакте</a>`;
  footer.innerHTML = `
    <div class="footer-grid">
      <div>
        <div class="footer-brand">🎓 ${t("siteName")}</div>
        <p class="footer-about">${t("footerAbout")}</p>
      </div>
      <div class="footer-col">
        <h4>${t("footerQuick")}</h4>
        <a href="index.html">${t("home")}</a>
        <a href="catalog.html">${t("sectionCourses")}</a>
        <a href="products.html">${t("products")}</a>
        <a href="services.html">${t("services")}</a>
        <a href="reviews.html">${t("reviews")}</a>
      </div>
      <div class="footer-col">
        <h4>${t("footerContacts")}</h4>
        <a href="consultation.html">${t("consultation")}</a>
        <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>
        <a href="tel:${phoneDigits.startsWith("7") ? "" : "+"}${phoneDigits}">${escapeHtml(phone)}</a>
        ${socialLinks ? `<div class="footer-socials">${socialLinks}</div>` : ""}
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} ${t("siteName")}</span>
      <span>${t("rightsReserved")}</span>
    </div>`;
  document.body.appendChild(footer);
}

// ===== Валидация и маски полей ввода =====
function guardDigits(el, max) {
  el.maxLength = max;
  el.addEventListener("input", () => {
    const d = el.value.replace(/\D/g, "").slice(0, max);
    if (el.value !== d) el.value = d;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/\d/.test(e.key)) e.preventDefault();
  });
}

function guardPhone(el) {
  guardDigits(el, 11);
}

function guardName(el) {
  el.maxLength = 50;
  el.addEventListener("input", () => {
    const v = el.value.replace(/[^A-Za-zА-Яа-яЁё\s\-'.]/g, "");
    if (el.value !== v) el.value = v;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[A-Za-zА-Яа-яЁё\s\-'.]$/.test(e.key)) e.preventDefault();
  });
}

function guardEmail(el) {
  el.maxLength = 190;
  el.addEventListener("input", () => {
    const v = el.value.replace(/[^A-Za-z0-9@._%+\-]/g, "");
    if (el.value !== v) el.value = v;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key.length > 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!/^[A-Za-z0-9@._%+\-]$/.test(e.key)) e.preventDefault();
  });
}

function wireInputGuards() {
  document.querySelectorAll("input, textarea").forEach(el => {
    const id = (el.id || "").toLowerCase();
    const type = el.type || "";
    if (type === "hidden" || type === "checkbox" || type === "radio" || type === "file" || type === "number") return;
    if (el.dataset.guarded) return;
    el.dataset.guarded = "1";

    if (type === "tel" || id === "phone" || id === "i-ph" || id === "i-wa" || id === "book-phone" || id === "consult-phone" || id === "order-phone" || id === "u-phone") {
      guardPhone(el);
    } else if (type === "password") {
      el.maxLength = 64;
    } else if (type === "email" || id === "email" || id === "u-email" || id === "i-em") {
      guardEmail(el);
    } else if (id === "code" || id === "sms-code" || /code$/.test(id) || el.inputMode === "numeric") {
      guardDigits(el, 6);
    } else if (/cvv/i.test(id)) {
      guardDigits(el, 3);
    } else if (/expiry|exp-/i.test(id)) {
      guardDigits(el, 4);
    } else if (/card/i.test(id)) {
      guardDigits(el, 16);
    } else if (/name|author|role/.test(id) && type === "text") {
      guardName(el);
    } else if (type === "date" || type === "time") {
      return;
    } else if (el.tagName === "TEXTAREA") {
      if (!el.maxLength) el.maxLength = 1000;
    } else if (type === "text" || type === "url") {
      if (!el.maxLength) el.maxLength = id === "order-address" ? 300 : 500;
    }
  });
}

function initInputObserver() {
  if (window.__inputObserverStarted) return;
  window.__inputObserverStarted = true;
  const mo = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type !== "childList") continue;
      let dirty = false;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1) continue;
        if ((n.matches && n.matches("input, textarea")) || (n.querySelectorAll && n.querySelectorAll("input, textarea").length)) { dirty = true; break; }
      }
      if (dirty) wireInputGuards();
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
}

async function loadSiteConfig() {
  try {
    const res = await fetch("/api/site-config");
    window.siteContacts = await res.json();
  } catch { window.siteContacts = {}; }
}

function messengerUrl(key, value) {
  if (!value) return null;
  const v = String(value).trim();
  if (/^https?:\/\//i.test(v)) return v;
  if (key === "contact_telegram") return "https://t.me/" + v.replace(/^@/, "");
  if (key === "contact_whatsapp") {
    const digits = v.replace(/\D/g, "");
    return "https://wa.me/" + digits;
  }
  if (key === "contact_vk") return "https://vk.com/" + v.replace(/^https?:\/\/vk\.com\//i, "");
  return null;
}

function openContactModal() {
  try {
    const c = window.siteContacts || {};
    const tg = messengerUrl("contact_telegram", c.contact_telegram);
    const wa = messengerUrl("contact_whatsapp", c.contact_whatsapp);
    const vk = messengerUrl("contact_vk", c.contact_vk);
    const phone = (c.contact_phone || "").trim();
    const email = (c.contact_email || "").trim();
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    let buttons = "";
    if (tg) buttons += `<a class="messenger-btn messenger-tg" href="${escapeHtml(tg)}" target="_blank" rel="noopener">✈ Telegram</a>`;
    if (wa) buttons += `<a class="messenger-btn messenger-wa" href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>`;
    if (vk) buttons += `<a class="messenger-btn messenger-vk" href="${escapeHtml(vk)}" target="_blank" rel="noopener">VK ВКонтакте</a>`;
    let contactLine = "";
    if (phone) contactLine += `<a class="contact-phone" href="tel:${phone.replace(/\D/g, "").startsWith("7") ? "" : "+7"}${phone.replace(/\D/g, "")}">☎ ${t("callUs")}: ${escapeHtml(phone)}</a>`;
    if (email) contactLine += `<a class="contact-phone" href="mailto:${escapeHtml(email)}" style="margin-top:8px">✉ ${escapeHtml(email)}</a>`;
    if (!buttons && !contactLine) {
      contactLine = `<p style="color:var(--text-dim)">${t("consultAsk")}</p>`;
    }
    overlay.innerHTML = `
      <div class="modal contact-modal">
        <h3>${t("writeDirectly")}</h3>
        <p class="contact-subtitle">${t("chooseMessenger")}</p>
        <div class="messenger-grid">${buttons}</div>
        ${contactLine}
        <button class="btn btn-outline btn-sm" style="margin-top:18px" onclick="this.closest('.modal-overlay').remove()">${t("close")}</button>
      </div>`;
    overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
  } catch (err) {
    console.error("openContactModal error:", err);
    alert("Modal error: " + err.message);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  wireInputGuards();
  initInputObserver();
  loadSiteConfig().then(() => injectFooter());
});

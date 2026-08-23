let lang = localStorage.getItem("lang") || "ru";
let theme = localStorage.getItem("theme") || "dark";
document.documentElement.dataset.theme = theme;
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
  if (lang === "ru" && k >= 11 && k <= 19) return t("viewsWord5");
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
    ["consultation.html", "consultation"],
    ["services.html", "services"],
    ["catalog.html", "sectionCourses"],
    ["index.html", "home"],
    ["products.html", "products"],
    ["https://vk.ru/album-210909831_283688982", "reviews", true],
  ];
  return links.map(([href, key, ext]) =>
    `<a class="nav-btn${cur === href ? " active" : ""}" href="${href}"${ext ? ' target="_blank" rel="noopener"' : ""} data-i18n="${key}">${t(key)}</a>`
  ).join("");
}

function renderNav() {
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const themeBtn = `<button class="icon-btn" id="theme-btn" title="${theme === "dark" ? t("themeLight") : t("themeDark")}">${theme === "dark" ? "☀" : "🌙"}</button>`;
  const langBtn = `<button class="icon-btn" id="lang-btn" title="Language">${lang === "ru" ? "🇬🇧" : "🇷🇺"}</button>`;
  const sLinks = sectionLinks();
  fetchMe().then(user => {
    if (user) {
      const adminLink = user.role === "admin" ? `<a class="nav-btn" href="admin.html" data-i18n="admin">${t("admin")}</a>` : "";
      nav.innerHTML = `
        ${sLinks}
        <button class="icon-btn nav-bell" id="nav-bell" title="${t("notifications")}">🔔<span class="bell-badge" id="bell-badge" style="display:none">0</span></button>
        <button class="icon-btn" id="nav-msg-btn" title="${t("messages")}" style="font-size:18px">💬<span class="bell-badge" id="msg-badge" style="display:none">0</span></button>
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
      const bellBtn = document.getElementById("nav-bell");
      if (bellBtn) bellBtn.addEventListener("click", (e) => { e.stopPropagation(); openNotifications(); });
      const msgBtn = document.getElementById("nav-msg-btn");
      if (msgBtn) msgBtn.addEventListener("click", (e) => { e.stopPropagation(); openMessages(); });
      loadNotifications();
    } else {
      nav.innerHTML = `
        ${sLinks}
        ${themeBtn}
        ${langBtn}
        <a class="nav-btn" href="register.html" data-i18n="registration">${t("registration")}</a>
        <a class="nav-btn" href="login.html" data-i18n="login">${t("login")}</a>`;
    }
    wireNavButtons();
    wireNavToggle();
  });
}

async function loadNotifications() {
  try {
    const data = await apiFetch("/api/notifications/unread-count");
    const badge = document.getElementById("bell-badge");
    if (badge) {
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? "99+" : data.count;
        badge.style.display = "";
      } else {
        badge.style.display = "none";
      }
    }
  } catch {}
}

function openNotifications() {
  let existing = document.getElementById("notif-panel");
  if (existing) { existing.remove(); return; }
  const panel = document.createElement("div");
  panel.id = "notif-panel";
  panel.className = "notif-panel";
  panel.innerHTML = `<div class="notif-header"><h4>${t("notifications")}</h4><button class="notif-mark-all" id="notif-mark-all">${t("markAllRead")}</button></div><div class="notif-list" id="notif-list"><div class="loading">${t("loading")}</div></div>`;
  document.body.appendChild(panel);
  
  const bell = document.getElementById("nav-bell");
  if (bell) {
    const rect = bell.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + "px";
    panel.style.right = (window.innerWidth - rect.right) + "px";
  }
  
  document.addEventListener("click", function closeNotif(e) {
    if (!panel.contains(e.target) && e.target.id !== "nav-bell" && !e.target.closest("#nav-bell")) {
      panel.remove();
      document.removeEventListener("click", closeNotif);
    }
  });
  
  loadNotifList();
  
  document.getElementById("notif-mark-all").addEventListener("click", async () => {
    await apiFetch("/api/notifications/read", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ all: true }) });
    loadNotifList();
    loadNotifications();
  });
}

async function loadNotifList() {
  const list = document.getElementById("notif-list");
  if (!list) return;
  try {
    const data = await apiFetch("/api/notifications");
    if (!data.length) { list.innerHTML = `<div class="notif-empty">${t("noNotifications")}</div>`; return; }
    list.innerHTML = data.map(n => `
      <div class="notif-item ${n.is_read ? "" : "unread"}" data-id="${n.id}">
        ${n.link ? `<a href="${escapeHtml(n.link)}" class="notif-content">` : `<div class="notif-content">`}
          <div class="notif-title">${escapeHtml(n.title)}</div>
          <div class="notif-body">${escapeHtml(n.body || "")}</div>
          <div class="notif-time">${new Date(n.created_at).toLocaleString("ru")}</div>
        ${n.link ? `</a>` : `</div>`}
      </div>
    `).join("");
    
    list.querySelectorAll(".notif-item").forEach(el => {
      el.addEventListener("click", async () => {
        const id = Number(el.dataset.id);
        await apiFetch("/api/notifications/read", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ ids: [id] }) });
        el.classList.remove("unread");
        loadNotifications();
      });
    });
  } catch (err) {
    list.innerHTML = `<div class="notif-empty">${err.message}</div>`;
  }
}

function openMessages() {
  let existing = document.getElementById("messages-panel");
  if (existing) { existing.remove(); return; }
  const panel = document.createElement("div");
  panel.id = "messages-panel";
  panel.className = "notif-panel";
  panel.style.width = "400px";
  panel.innerHTML = `<div class="notif-header"><h4>${t("messages")}</h4><button class="notif-mark-all" id="msg-close-btn">&times;</button></div><div class="notif-list" id="msg-conv-list"><div class="loading">${t("loading")}</div></div>`;
  document.body.appendChild(panel);

  const msgBtn = document.getElementById("nav-msg-btn");
  if (msgBtn) {
    const rect = msgBtn.getBoundingClientRect();
    panel.style.top = (rect.bottom + 8) + "px";
    panel.style.right = (window.innerWidth - rect.right) + "px";
  }

  document.getElementById("msg-close-btn").addEventListener("click", () => panel.remove());
  document.addEventListener("click", function closeMsg(e) {
    if (!panel.contains(e.target) && e.target.id !== "nav-msg-btn" && !e.target.closest("#nav-msg-btn")) {
      panel.remove();
      document.removeEventListener("click", closeMsg);
    }
  });

  loadConversations();
}

async function loadConversations() {
  const list = document.getElementById("msg-conv-list");
  if (!list) return;
  try {
    const data = await apiFetch("/api/messages/conversations");
    if (!data.length) { list.innerHTML = `<div class="notif-empty">${t("noMessages")}</div>`; return; }
    list.innerHTML = data.map(c => `
      <div class="notif-item ${c.unread > 0 ? "unread" : ""}" data-uid="${c.user_id}">
        <div class="notif-content">
          <div class="notif-title">${escapeHtml(c.name)} ${c.unread > 0 ? `<span class="bell-badge" style="display:inline-flex;position:static;margin-left:4px">${c.unread}</span>` : ""}</div>
          <div class="notif-body">${escapeHtml(c.last_message || "")}</div>
        </div>
      </div>
    `).join("");
    list.querySelectorAll(".notif-item").forEach(el => {
      el.addEventListener("click", () => openChat(Number(el.dataset.uid), el.querySelector(".notif-title").textContent));
    });
  } catch (err) {
    list.innerHTML = `<div class="notif-empty">${err.message}</div>`;
  }
}

function openChat(userId, userName) {
  const oldConv = document.getElementById("messages-panel");
  if (oldConv) oldConv.remove();
  let existing = document.getElementById("chat-panel");
  if (existing) existing.remove();
  const panel = document.createElement("div");
  panel.id = "chat-panel";
  panel.className = "notif-panel chat-panel";
  panel.style.width = "400px";
  panel.style.height = "500px";
  panel.style.top = "60px";
  panel.style.right = "20px";
  panel.style.zIndex = "700";
  panel.innerHTML = `
    <div class="notif-header">
      <h4>${escapeHtml(userName)}</h4>
      <button class="notif-mark-all" id="chat-back">← ${t("messages")}</button>
    </div>
    <div class="chat-messages" id="chat-messages"><div class="loading">${t("loading")}</div></div>
    <div class="chat-input">
      <input type="text" id="chat-text" placeholder="${t("sendMessage")}" autocomplete="off">
      <button class="btn btn-primary btn-sm" id="chat-send">→</button>
    </div>`;
  document.body.appendChild(panel);

  document.getElementById("chat-back").addEventListener("click", () => { panel.remove(); openMessages(); });
  document.getElementById("chat-send").addEventListener("click", () => sendChatMessage(userId));
  document.getElementById("chat-text").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChatMessage(userId); });

  loadChatMessages(userId);
  apiFetch("/api/messages/read", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ from_user_id: userId }) }).catch(() => {});
  loadNotifications();
}

async function loadChatMessages(userId) {
  const container = document.getElementById("chat-messages");
  if (!container) return;
  try {
    const data = await apiFetch("/api/messages/" + userId);
    if (!data.length) { container.innerHTML = `<div class="notif-empty">${t("noMessages")}</div>`; return; }
    const meId = (await fetchMe())?.id;
    container.innerHTML = data.map(m => `
      <div class="chat-msg ${m.from_user_id === meId ? "mine" : "theirs"}">
        <div class="chat-msg-text">${escapeHtml(m.text)}</div>
        <div class="chat-msg-time">${new Date(m.created_at).toLocaleTimeString("ru", {hour:"2-digit", minute:"2-digit"})}</div>
      </div>
    `).join("");
    container.scrollTop = container.scrollHeight;
  } catch (err) {
    container.innerHTML = `<div class="notif-empty">${err.message}</div>`;
  }
}

async function sendChatMessage(userId) {
  const input = document.getElementById("chat-text");
  if (!input) return;
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    await apiFetch("/api/messages", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({ to_user_id: userId, text }) });
    loadChatMessages(userId);
  } catch (err) {
    alert(err.message);
  }
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
  let messengerLinks = "";
  if (tg) messengerLinks += `<a class="messenger-btn messenger-tg" href="${escapeHtml(tg)}" target="_blank" rel="noopener">✈ Telegram</a>`;
  if (wa) messengerLinks += `<a class="messenger-btn messenger-wa" href="${escapeHtml(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>`;
  if (vk) messengerLinks += `<a class="messenger-btn messenger-vk" href="${escapeHtml(vk)}" target="_blank" rel="noopener">VK ВКонтакте</a>`;
  footer.innerHTML = `
    <div class="footer-grid">
      <div>
        <div class="footer-brand">MAGIC🌞SUN ELLEN</div>
        <p class="footer-about">Платформа для изучения эзотерических курсов, приобретения товаров, услуг и консультаций</p>
      </div>
      <div class="footer-col">
        <h4>${t("footerQuick")}</h4>
        <a href="index.html">${t("home")}</a>
        <a href="catalog.html">${t("sectionCourses")}</a>
        <a href="products.html">${t("products")}</a>
        <a href="services.html">${t("services")}</a>
      </div>
      <div class="footer-col footer-messenger-col">
        <h4>${t("footerContacts")}</h4>
        ${messengerLinks || ""}
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} MAGIC🌞SUN ELLEN</span>
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

let lastUnreadMsgCount = 0;
async function pollMessages() {
  try {
    const data = await apiFetch("/api/messages/conversations");
    const totalUnread = data.reduce((s, c) => s + (c.unread || 0), 0);
    const msgBadge = document.getElementById("msg-badge");
    if (msgBadge) {
      if (totalUnread > 0) {
        msgBadge.textContent = totalUnread > 99 ? "99+" : totalUnread;
        msgBadge.style.display = "";
      } else {
        msgBadge.style.display = "none";
      }
    }
    if (totalUnread > lastUnreadMsgCount && lastUnreadMsgCount >= 0) {
      playNotifSound();
      showToast(t("newMessage"));
    }
    lastUnreadMsgCount = totalUnread;
  } catch {}
}

function playNotifSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

function showToast(msg) {
  let existing = document.getElementById("global-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.id = "global-toast";
  toast.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);background:var(--accent);color:#fff;padding:12px 24px;border-radius:10px;z-index:9999;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,.3);animation:fadeIn .3s";
  toast.textContent = msg;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  wireInputGuards();
  initInputObserver();
  loadSiteConfig().then(() => injectFooter());
  setInterval(pollMessages, 15000);
  pollMessages();
});

let lang = localStorage.getItem("lang") || "ru";
let theme = localStorage.getItem("theme") || "dark";

function t(key) {
  const dict = TRANSLATIONS[lang] || TRANSLATIONS.ru;
  return dict[key] ?? TRANSLATIONS.ru[key] ?? key;
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

function renderNav() {
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const themeBtn = `<button class="icon-btn" id="theme-btn" title="${theme === "dark" ? t("themeLight") : t("themeDark")}">${theme === "dark" ? "☀" : "🌙"}</button>`;
  const langBtn = `<button class="icon-btn" id="lang-btn" title="Language">${lang === "ru" ? "🇬🇧" : "🇷🇺"}</button>`;
  fetchMe().then(user => {
    if (user) {
      const adminLink = user.role === "admin" ? `<a class="nav-btn" href="admin.html" data-i18n="admin">${t("admin")}</a>` : "";
      nav.innerHTML = `
        ${themeBtn}
        ${langBtn}
        ${adminLink}
        <a class="nav-btn" href="profile.html" data-i18n="myCourses">${t("myCourses")}</a>
        <span class="nav-user">👤 ${user.name}</span>
        <a class="nav-btn" href="#" id="logout-btn" data-i18n="logout">${t("logout")}</a>`;
      document.getElementById("logout-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "index.html";
      });
    } else {
      nav.innerHTML = `
        ${themeBtn}
        ${langBtn}
        <a class="nav-btn" href="register.html" data-i18n="registration">${t("registration")}</a>
        <a class="nav-btn" href="login.html" data-i18n="login">${t("login")}</a>`;
    }
    wireNavButtons();
  });
}

function wireNavButtons() {
  const themeBtn = document.getElementById("theme-btn");
  if (themeBtn) themeBtn.addEventListener("click", () => setTheme(theme === "dark" ? "light" : "dark"));
  const langBtn = document.getElementById("lang-btn");
  if (langBtn) langBtn.addEventListener("click", () => setLang(lang === "ru" ? "en" : "ru"));
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
  const data = await res.json();
  if (!res.ok) throw new Error(translateError(data.error) || "Error");
  return data;
}

function translateError(msg) {
  const map = {
    "Заполните все поля": t("fillAll"),
    "Пароль минимум 6 символов": t("passShort"),
    "Email уже зарегистрирован": t("emailExists"),
    "Неверный email или пароль": t("wrongCreds"),
    "Требуется оплата": t("payFail"),
    "Требуется вход": t("login"),
    "Доступ только для администратора": t("accessDenied"),
    "Требуется подтверждение оплаты по SMS": t("smsRequired"),
    "Заполните данные оплаты": t("smsFillPay"),
    "Курс бесплатный, оплата не требуется": t("smsCourseFree"),
    "Сначала запросите SMS-код": t("smsFirstRequest"),
    "Код истёк. Запросите новый.": t("smsExpired"),
    "Неверный SMS-код": t("smsWrong"),
    "Нельзя удалить самого себя": t("delSelfBlocked"),
    "Нельзя удалить последнего администратора": t("delLastAdmin"),
    "Пользователь не найден": t("userNotFound"),
    "Сначала оплатите и запишитесь на курс": t("payFirstEnroll"),
  };
  return map[msg] || msg;
}

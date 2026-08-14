let lang = localStorage.getItem("lang") || "ru";
let theme = localStorage.getItem("theme") || "dark";

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
  fetchMe().then(user => {
    if (user) {
      const adminLink = user.role === "admin" ? `<a class="nav-btn" href="admin.html" data-i18n="admin">${t("admin")}</a>` : "";
      nav.innerHTML = `
        ${sLinks}
        ${themeBtn}
        ${langBtn}
        ${adminLink}
        <a class="nav-btn" href="profile.html" data-i18n="myCourses">${t("myCourses")}</a>
        <span class="nav-user">👤 ${escapeHtml(user.name)}</span>
        <a class="nav-btn" href="#" id="logout-btn" data-i18n="logout">${t("logout")}</a>`;
      document.getElementById("logout-btn").addEventListener("click", async (e) => {
        e.preventDefault();
        await fetch("/api/logout", { method: "POST" });
        window.location.href = "index.html";
      });
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
  };
  return map[msg] || msg;
}

function injectFooter() {
  if (document.getElementById("site-footer")) return;
  const footer = document.createElement("footer");
  footer.className = "site-footer";
  footer.id = "site-footer";
  const year = new Date().getFullYear();
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
        <a href="mailto:support@courses.ru">support@courses.ru</a>
        <a href="tel:+79990000000">+7 999 000-00-00</a>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© ${year} ${t("siteName")}</span>
      <span>${t("rightsReserved")}</span>
    </div>`;
  document.body.appendChild(footer);
}

document.addEventListener("DOMContentLoaded", () => {
  applyI18n();
  injectFooter();
});

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");
const https = require("https");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const PDFDocument = require("pdfkit");
const QRCode = require("qrcode");
const { pool, initSchema } = require("./db");
const seedData = require("./seed-data.json");

const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Базовые заголовки безопасности для всех ответов
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; media-src 'self' blob: https:; font-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com https://drive.google.com https://docs.google.com https://yadi.sk https://disk.yandex.ru https://disk.yandex.com https://player.vimeo.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});
// Защитные заголовки для загруженных файлов (до статической раздачи)
app.use("/uploads", (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: process.env.SESSION_SECRET || "courses_secret_key_2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24,
  },
}));

// ---- Помощники безопасности ----

// Не раскрываем внутренние детали ошибок (SQL-тексты и т.п.) клиенту
function serverError(res, err) {
  console.error("[500]", err);
  res.status(500).json({ error: "Внутренняя ошибка сервера" });
}

// Защита от фиксации сессии: новый ID сессии при входе/регистрации
function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(err => (err ? reject(err) : resolve()));
  });
}

// Простой in-memory rate limiter (без внешних зависимостей):
// защищает от перебора паролей/SMS-кодов и спама в заявках/заказах
const rateBuckets = new Map();
function rateLimit({ windowMs = 15 * 60 * 1000, max = 100, keyFn } = {}) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : req.ip;
    const now = Date.now();
    let bucket = rateBuckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      rateBuckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: "Слишком много запросов. Попробуйте позже." });
    }
    if (rateBuckets.size > 5000) rateBuckets.clear();
    next();
  };
}

// Ожидающие SMS-подтверждения оплаты хранятся в таблице sms_codes (переживают рестарт сервера)

// Загрузка файлов (видео / изображения / аудио).
// Файлы хранятся вне public/ и отдаются только через защищённый /api/media
// (видео и аудио — только записанным на курс пользователям).
const UPLOAD_DIR = path.join(__dirname, "data", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".bin";
      const name = Date.now() + "-" + Math.round(Math.random() * 1e6) + ext;
      cb(null, name);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    // SVG отклоняется: в SVG можно встроить скрипт (риск хранимого XSS)
    if (file.mimetype === "image/svg+xml" || /\.svg$/i.test(file.originalname)) {
      return cb(new Error("Недопустимый тип файла"), false);
    }
    const ok = /^(image\/|video\/|audio\/)/.test(file.mimetype) ||
      /\.(mp4|webm|ogg|mov|mkv|avi|jpg|jpeg|png|gif|webp|mp3|wav|m4a|aac)$/i.test(file.originalname);
    cb(ok ? null : new Error("Недопустимый тип файла"), ok);
  },
});

app.post("/api/upload", requireAdmin, (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    res.json({ url: "/api/media/" + req.file.filename, name: req.file.originalname });
  });
});

// Загрузка аватара пользователя: только изображения, до 5 МБ.
// Имя файла помечается префиксом "avatar-" — по нему безопасно чистить старые файлы.
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || ".png";
      cb(null, "avatar-" + Date.now() + "-" + Math.round(Math.random() * 1e6) + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = /^image\/(png|jpeg|webp|gif)$/.test(file.mimetype) &&
      /\.(png|jpe?g|webp|gif)$/i.test(file.originalname);
    cb(ok ? null : new Error("Недопустимый тип файла"), ok);
  },
});

function avatarFilename(url) {
  if (typeof url !== "string" || !url.startsWith("/api/media/")) return null;
  const name = path.basename(url);
  // Удаляем только файлы, созданные загрузкой аватара (avatar-<ts>-<rand>.<ext>),
  // чтобы не задеть сидовый дефолтный аватар avatar-user.svg
  if (!/^avatar-\d+-\d+\./.test(name)) return null;
  return name;
}

function removeAvatarFile(url) {
  const name = avatarFilename(url);
  if (!name) return;
  const full = path.join(UPLOAD_DIR, name);
  if (full.startsWith(UPLOAD_DIR) && fs.existsSync(full)) {
    fs.unlink(full, () => {});
  }
}

app.post("/api/avatar", requireAuth, (req, res) => {
  avatarUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });
    const url = "/api/media/" + req.file.filename;
    try {
      const oldUrl = req.session.user.avatar || "";
      await pool.query("UPDATE users SET avatar = ? WHERE id = ?", [url, req.session.user.id]);
      req.session.user.avatar = url;
      removeAvatarFile(oldUrl);
      res.json({ avatar: url });
    } catch (e) {
      removeAvatarFile(url);
      serverError(res, e);
    }
  });
});

app.delete("/api/avatar", requireAuth, async (req, res) => {
  try {
    const oldUrl = req.session.user.avatar || "";
    await pool.query("UPDATE users SET avatar = '' WHERE id = ?", [req.session.user.id]);
    req.session.user.avatar = "";
    removeAvatarFile(oldUrl);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

const PROTECTED_MEDIA_RE = /\.(mp4|webm|mov|mkv|avi|m4v|ogv|mp3|wav|m4a|aac|oga|flac|ogg)$/i;

// Защищённая раздача файлов: видео и аудио доступны только авторизованным
// пользователям, записанным на курс, который ссылается на файл (или админу).
// Изображения (обложки, галереи, иллюстрации уроков) отдаются публично.
app.get("/api/media/:file", async (req, res) => {
  try {
    const file = path.basename(String(req.params.file || ""));
    if (!file || file === "." || file === ".." || file.includes("\\")) {
      return res.status(400).json({ error: "Некорректный файл" });
    }
    const full = path.join(UPLOAD_DIR, file);
    if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) {
      return res.status(404).json({ error: "Файл не найден" });
    }
    if (PROTECTED_MEDIA_RE.test(file)) {
      if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
      if (req.session.user.role !== "admin") {
        const [rows] = await pool.query(
          `SELECT l.course_id AS cid FROM lessons l WHERE l.video_url LIKE ?
           UNION
           SELECT cm.course_id AS cid FROM course_media cm WHERE cm.type IN ('video','audio') AND cm.url LIKE ?`,
          [`%${file}%`, `%${file}%`]
        );
        if (!rows.length) return res.status(403).json({ error: "Доступ запрещён" });
        const ids = rows.map(r => r.cid);
        const [enr] = await pool.query(
          "SELECT 1 FROM enrollments WHERE user_id = ? AND course_id IN (?) LIMIT 1",
          [req.session.user.id, ids]
        );
        if (!enr.length) return res.status(403).json({ error: "Оплатите курс, чтобы смотреть видео" });
      }
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.sendFile(full);
  } catch (err) { serverError(res, err); }
});

// Совместимость: старые ссылки /uploads/<файл> перенаправляются на защищённую раздачу.
app.get("/uploads/:file", (req, res) => {
  res.redirect("/api/media/" + encodeURIComponent(path.basename(req.params.file)));
});

// Прокси для Google Drive видео: браузер получает прямой <video> поток,
// обходя ограничения Google на iframe-встраивание.
app.get("/api/proxy/gdrive", async (req, res) => {
  try {
    const id = String(req.query.id || "").trim();
    if (!id || !/^[\w-]{10,}$/.test(id)) {
      return res.status(400).json({ error: "Invalid Google Drive file ID" });
    }
    const fetchGDrive = (location, depth = 0) => new Promise((resolve, reject) => {
      if (depth > 5) return reject(new Error("Too many redirects"));
      https.get(location, resp => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          fetchGDrive(resp.headers.location, depth + 1).then(resolve, reject);
        } else {
          resolve(resp);
        }
      }).on("error", reject);
    });
    const upstream = await fetchGDrive(`https://drive.google.com/uc?export=view&id=${id}`);
    if (upstream.statusCode !== 200) {
      upstream.resume();
      return res.status(502).json({ error: "Google Drive returned " + upstream.statusCode });
    }
    res.setHeader("Content-Type", upstream.headers["content-type"] || "video/mp4");
    if (upstream.headers["content-length"]) {
      res.setHeader("Content-Length", upstream.headers["content-length"]);
    }
    res.setHeader("Accept-Ranges", "bytes");
    upstream.pipe(res);
  } catch (err) { serverError(res, err); }
});

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Требуется вход" });
  if (req.session.user.role !== "admin") return res.status(403).json({ error: "Доступ только для администратора" });
  next();
}

function getMediaType(url) {
  const clean = (url || "").split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/.test(clean)) return "video";
  if (/\.(mp3|wav|m4a|aac|oga|flac|ogg)$/.test(clean)) return "audio";
  if (/(youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)/.test(url || "")) return "video";
  if (/drive\.google\.com\/(?:file\/d\/|open\?id=)/.test(url || "")) return "video";
  if (/(?:yadi\.sk|disk\.yandex\.\w+)\/[di]\//.test(url || "")) return "video";
  if (/vimeo\.com\/\d+/.test(url || "")) return "video";
  return "image";
}

// Соцсети преподавателя хранятся как JSON-строка в БД: { telegram, instagram, vk, youtube, whatsapp, email, phone }
function parseSocials(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw) || {}; } catch { return {}; }
}

function socialsToDb(obj) {
  const clean = {};
  for (const k of ["telegram", "instagram", "vk", "youtube", "whatsapp", "email", "phone"]) {
    const v = String(obj?.[k] || "").trim();
    if (v) clean[k] = v;
  }
  return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

// Из строки БД (courses.instructor / instructors.*) собирает компактный объект профиля
function instructorInfoRow(row) {
  if (!row || !row.instructor_id) return null;
  return {
    id: row.instructor_id,
    name: row.inst_name || row.instructor || "",
    avatar: row.inst_avatar || "",
    specialty: row.inst_specialty || "",
  };
}

function escapeHtmlFile(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function absUrl(url, base) {
  if (!url) return "";
  if (/^https?:\/\//.test(url)) return url;
  return base + (url.startsWith("/") ? url : "/" + url);
}

function mediaHtml(url, base) {
  if (!url) return "";
  const abs = escapeHtmlFile(absUrl(url, base));
  const ext = url.split("?")[0].toLowerCase();
  if (/\.(mp3|wav|m4a|aac|oga|flac|ogg)$/.test(ext)) {
    return `<div class="block"><audio controls src="${abs}"></audio></div>`;
  }
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]+)/);
  if (yt) {
    return `<div class="block"><iframe width="100%" height="380" src="https://www.youtube.com/embed/${yt[1]}" frameborder="0" allowfullscreen></iframe></div>`;
  }
  const gdrive = url.match(/drive\.google\.com\/(?:file\/d\/|open\?id=)([\w-]+)/);
  if (gdrive) {
    return `<div class="block"><iframe width="100%" height="380" src="https://drive.google.com/file/d/${gdrive[1]}/preview" frameborder="0" allowfullscreen></iframe></div>`;
  }
  const ydisk = url.match(/(?:yadi\.sk|disk\.yandex\.\w+)\/[di]\/([\w-]+)/);
  if (ydisk) {
    return `<div class="block"><iframe width="100%" height="380" src="https://yadi.sk/d/${ydisk[1]}/preview" frameborder="0" allowfullscreen></iframe></div>`;
  }
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) {
    return `<div class="block"><iframe width="100%" height="380" src="https://player.vimeo.com/video/${vimeo[1]}" frameborder="0" allowfullscreen></iframe></div>`;
  }
  return `<div class="block"><video controls src="${abs}"></video></div>`;
}

function buildLessonHtml(lesson, quiz, base, opts) {
  const print = opts && opts.print;
  const content = escapeHtmlFile(lesson.content).split(/\n/).map(p => `<p>${p || "&nbsp;"}</p>`).join("");
  const quizHtml = quiz.length ? `
    <h2>Тест к уроку</h2>
    ${quiz.map((q, i) => `
      <div class="question">
        <p><b>${i + 1}. ${escapeHtmlFile(q.q)}</b></p>
        ${q.options.map((o, j) => `
          <div class="option${j === q.correct ? " correct" : ""}">${j === q.correct ? "✔ " : "• "}${escapeHtmlFile(o)}${j === q.correct ? " — <i>правильный ответ</i>" : ""}</div>`).join("")}
      </div>`).join("")}` : "";
  const img = lesson.image_url ? `<div class="block"><img src="${escapeHtmlFile(absUrl(lesson.image_url, base))}" alt=""></div>` : "";
  // Видео и аудио при печати не включаются: их можно смотреть только на сайте.
  const media = !print && lesson.video_url ? mediaHtml(lesson.video_url, base) : "";
  const printBar = print ? `
    <div class="print-bar">
      <button onclick="window.print()">🖨 Печать / Print</button>
    </div>
    <script>window.addEventListener('load', function(){ setTimeout(function(){ window.print(); }, 400); });<\/script>` : "";
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<title>${escapeHtmlFile(lesson.title)}</title>
<style>
  body { font-family: 'Segoe UI', Arial, sans-serif; max-width: 780px; margin: 0 auto; padding: 28px; color: #1b2634; line-height: 1.7; }
  h1 { color: #1479c9; }
  .meta { color: #7d8da0; font-size: 14px; margin-bottom: 20px; }
  p { margin: 0 0 12px; }
  .block { margin: 16px 0; }
  .block img, .block video { max-width: 100%; border-radius: 10px; }
  .block audio { width: 100%; }
  .question { border: 1px solid #dce4ee; border-radius: 10px; padding: 14px; margin-bottom: 12px; }
  .option { padding: 4px 8px; }
  .option.correct { color: #2e7d32; font-weight: 700; }
  .print-bar { position: fixed; top: 12px; right: 12px; }
  .print-bar button { padding: 10px 16px; border: 0; border-radius: 8px; background: #1479c9; color: #fff; cursor: pointer; font-size: 14px; }
  .download-note { border-top: 1px solid #dce4ee; margin-top: 24px; padding-top: 12px; color: #7d8da0; font-size: 13px; }
  @media print { .print-bar { display: none; } }
</style>
</head>
<body>
  ${printBar}
  <div class="meta">${escapeHtmlFile(lesson.course_title)} · Урок ${lesson.position + 1} · ⏱ ${lesson.duration_min || 0} мин</div>
  <h1>${escapeHtmlFile(lesson.title)}</h1>
  ${img}
  ${media}
  ${content}
  ${quizHtml}
  <div class="download-note">Печатная версия урока с платформы «Курсы»</div>
</body>
</html>`;
}

function parseQuiz(raw) {
  if (!raw) return [];
  let parsed = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter(q => q && q.q && Array.isArray(q.options) && q.options.length >= 2)
    .map(q => {
      const options = q.options.slice(0, 6).map(o => String(o));
      const rawCorrect = Number(q.correct);
      const correct = Number.isFinite(rawCorrect) && rawCorrect >= 0 ? Math.min(Math.floor(rawCorrect), options.length - 1) : -1;
      return { q: String(q.q), options, correct };
    });
}

app.get("/api/me", async (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  try {
    const [rows] = await pool.query(
      "SELECT id, name, email, phone, role, avatar FROM users WHERE id = ?",
      [req.session.user.id]
    );
    if (!rows.length) return res.json({ user: null });
    const user = {
      id: rows[0].id, name: rows[0].name, email: rows[0].email,
      phone: rows[0].phone || "", role: rows[0].role, avatar: rows[0].avatar || "",
    };
    req.session.user = user;
    res.json({ user });
  } catch (err) { serverError(res, err); }
});

app.post("/api/register",
  rateLimit({ max: 5, keyFn: req => "reg:" + req.ip + ":" + String((req.body && req.body.email) || "").trim().toLowerCase() }),
  async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Заполните все поля" });
  if (password.length < 6) return res.status(400).json({ error: "Пароль минимум 6 символов" });
  try {
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length) return res.status(409).json({ error: "Email уже зарегистрирован" });
    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
      [name, email, hash]
    );
    const user = { id: result.insertId, name, email, phone: "", role: "user", avatar: "" };
    await regenerateSession(req);
    req.session.user = user;
    res.json({ user });
  } catch (err) { serverError(res, err); }
});

app.post("/api/login",
  rateLimit({ max: 10, keyFn: req => "login:" + req.ip + ":" + String((req.body && req.body.email) || "").trim().toLowerCase() }),
  async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Заполните все поля" });
  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!rows.length) return res.status(401).json({ error: "Неверный email или пароль" });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });
    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, phone: rows[0].phone || "", role: rows[0].role, avatar: rows[0].avatar || "" };
    await regenerateSession(req);
    req.session.user = user;
    res.json({ user });
  } catch (err) { serverError(res, err); }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// Восстановление пароля: шаг 1 — запрос SMS-кода на привязанный телефон
app.post("/api/reset/send",
  rateLimit({ max: 5, keyFn: req => "rsend:" + req.ip + ":" + String((req.body && req.body.email) || "").trim().toLowerCase() }),
  async (req, res) => {
  const { email } = req.body || {};
  const emailClean = String(email || "").trim().toLowerCase();
  if (!emailClean) return res.status(400).json({ error: "Заполните все поля" });
  try {
    const [rows] = await pool.query("SELECT id FROM users WHERE LOWER(email) = ?", [emailClean]);
    if (!rows.length) return res.status(404).json({ error: "Пользователь не найден" });
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    // Помечаем сессию как изменённую, чтобы express-session сохранил её и
    // req.session.id остался стабильным для шага подтверждения (saveUninitialized:false)
    req.session._resetFlow = Date.now();
    await pool.query("DELETE FROM sms_codes WHERE expires_at_ms < ?", [Date.now()]);
    await pool.query("DELETE FROM sms_codes WHERE session_id = ?", [req.session.id]);
    // course_id хранит id пользователя, method='reset' отделяет коды восстановления от оплат
    await pool.query(
      "INSERT INTO sms_codes (session_id, code, course_id, price, method, card_last4, expires_at_ms) VALUES (?, ?, ?, 0, 'reset', NULL, ?)",
      [req.session.id, code, rows[0].id, expiresAtMs]
    );
    res.json({ demoCode: code });
  } catch (err) { serverError(res, err); }
});

// Восстановление пароля: шаг 2 — проверка кода и установка нового пароля
app.post("/api/reset/confirm",
  rateLimit({ windowMs: 60 * 60 * 1000, max: 10, keyFn: req => "rconf:" + req.ip + ":" + String((req.body && req.body.email) || "").trim().toLowerCase() }),
  async (req, res) => {
  const { email, code, newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: "Пароль минимум 6 символов" });
  const emailClean = String(email || "").trim().toLowerCase();
  try {
    const [users] = await pool.query("SELECT id FROM users WHERE LOWER(email) = ?", [emailClean]);
    if (!users.length) return res.status(404).json({ error: "Пользователь не найден" });
    const [codes] = await pool.query(
      "SELECT * FROM sms_codes WHERE session_id = ? AND method = 'reset' AND course_id = ?",
      [req.session.id, users[0].id]
    );
    const entry = codes[0];
    if (!entry) return res.status(400).json({ error: "Сначала запросите SMS-код" });
    if (Date.now() > Number(entry.expires_at_ms)) {
      await pool.query("DELETE FROM sms_codes WHERE id = ?", [entry.id]);
      return res.status(400).json({ error: "Код истёк. Запросите новый." });
    }
    if (String(entry.code) !== String(code || "").replace(/\D/g, "")) {
      return res.status(400).json({ error: "Неверный SMS-код" });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = ? WHERE id = ?", [hash, users[0].id]);
    await pool.query("DELETE FROM sms_codes WHERE id = ?", [entry.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.get("/api/categories", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM categories ORDER BY name");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/courses", async (req, res) => {
  try {
    const categoryId = req.query.category ? Number(req.query.category) : null;
    const sel = `SELECT c.*, cat.name AS category_name,
           i.id AS instructor_id, i.name AS inst_name, i.avatar AS inst_avatar, i.specialty AS inst_specialty,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
         FROM courses c
         LEFT JOIN categories cat ON c.category_id = cat.id
         LEFT JOIN instructors i ON i.id = c.instructor_id`;
    const q = categoryId
      ? `${sel} WHERE c.category_id = ? ORDER BY c.created_at DESC`
      : `${sel} ORDER BY c.created_at DESC`;
    const [rows] = categoryId ? await pool.query(q, [categoryId]) : await pool.query(q);
    for (const row of rows) row.instructor_info = instructorInfoRow(row);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/courses/:id", async (req, res) => {
  try {
    const [courses] = await pool.query(
      `SELECT c.*, cat.name AS category_name,
         i.id AS instructor_id, i.name AS inst_name, i.avatar AS inst_avatar, i.specialty AS inst_specialty
       FROM courses c
       LEFT JOIN categories cat ON c.category_id = cat.id
       LEFT JOIN instructors i ON i.id = c.instructor_id
       WHERE c.id = ?`,
      [req.params.id]
    );
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const course = courses[0];
    await pool.query("UPDATE courses SET views = views + 1 WHERE id = ?", [course.id]);
    course.views = Number(course.views || 0) + 1;
    const [lessons] = await pool.query(
      "SELECT id, title, content, duration_min, position, video_url, image_url, quiz FROM lessons WHERE course_id = ? ORDER BY position, id",
      [course.id]
    );
    const [reviews] = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.name FROM reviews r
       JOIN users u ON r.user_id = u.id WHERE r.course_id = ? ORDER BY r.created_at DESC`,
      [course.id]
    );
    const [media] = await pool.query(
      "SELECT id, type, url FROM course_media WHERE course_id = ? ORDER BY position, id",
      [course.id]
    );
    let enrolled = false;
    let progress = 0;
    if (req.session.user) {
      const [enr] = await pool.query(
        "SELECT progress FROM enrollments WHERE user_id = ? AND course_id = ?",
        [req.session.user.id, course.id]
      );
      if (enr.length) { enrolled = true; progress = enr[0].progress; }
    }
    const isAdmin = req.session.user && req.session.user.role === "admin";
    const showContent = enrolled || isAdmin;
    const parsedLessons = lessons.map(l => showContent
      ? { ...l, quiz: parseQuiz(l.quiz) }
      : { id: l.id, title: l.title, position: l.position, duration_min: l.duration_min });
    course.instructor_info = instructorInfoRow(course);
    res.json({ ...course, lessons: parsedLessons, reviews, media, enrolled, progress, isAdmin });
  } catch (err) { serverError(res, err); }
});

// Публичные профили преподавателей (авторов курсов)
app.get("/api/instructors", async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.id, i.name, i.specialty, i.bio, i.experience, i.avatar, i.socials, i.created_at,
         (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = i.id) AS courses_count,
         (SELECT COUNT(*) FROM reviews r JOIN courses c ON c.id = r.course_id WHERE c.instructor_id = i.id) AS reviews_count
       FROM instructors i ORDER BY i.name`
    );
    for (const row of rows) row.socials = parseSocials(row.socials);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/instructors/:id", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM instructors WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Преподаватель не найден" });
    const instructor = rows[0];
    instructor.socials = parseSocials(instructor.socials);
    const [courses] = await pool.query(
      `SELECT c.id, c.title, c.description, c.price, c.image_url, c.created_at, cat.name AS category_name,
         (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
       FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id
       WHERE c.instructor_id = ? ORDER BY c.created_at DESC`,
      [instructor.id]
    );
    for (const c of courses) {
      c.instructor_info = { id: instructor.id, name: instructor.name, avatar: instructor.avatar, specialty: instructor.specialty };
    }
    const [reviews] = await pool.query(
      `SELECT r.rating, r.comment, r.created_at, u.name AS user_name, c.title AS course_title
       FROM reviews r
       JOIN users u ON u.id = r.user_id
       JOIN courses c ON c.id = r.course_id
       WHERE c.instructor_id = ? ORDER BY r.created_at DESC`,
      [instructor.id]
    );
    const avg = reviews.length
      ? (reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length).toFixed(1)
      : null;
    res.json({ ...instructor, courses, reviews, avg_rating: avg });
  } catch (err) { serverError(res, err); }
});

// Разделы главной страницы: товары, услуги, консультации, отзывы
app.get("/api/products", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM products ORDER BY category, name");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/services", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM services ORDER BY name");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/consultations", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM consultations ORDER BY price");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/site-reviews", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM site_reviews ORDER BY created_at DESC LIMIT 50");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// ============ НАСТРОЙКИ САЙТА (мессенджеры, телефон) ============

app.get("/api/site-config", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT cfg_key, cfg_value FROM site_config");
    const cfg = {};
    for (const r of rows) cfg[r.cfg_key] = r.cfg_value;
    res.json(cfg);
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/site-config", requireAdmin, async (req, res) => {
  try {
    const data = req.body || {};
    const allowed = ["contact_telegram", "contact_whatsapp", "contact_vk", "contact_phone", "contact_email"];
    for (const key of allowed) {
      if (key in data) {
        await pool.query(
          "INSERT INTO site_config (cfg_key, cfg_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value)",
          [key, String(data[key] || "").trim()]
        );
      }
    }
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/consultations/request",
  rateLimit({ max: 30, keyFn: req => "cons:" + (req.session.user ? req.session.user.id : req.ip) }),
  requireAuth, async (req, res) => {
  const { name, phone, consultationId } = req.body || {};
  const userName = String(name || "").trim() || (req.session.user && req.session.user.name) || "";
  if (!userName || !phone) return res.status(400).json({ error: "Заполните имя и телефон" });
  try {
    const [rows] = await pool.query("SELECT title FROM consultations WHERE id = ?", [consultationId || 0]);
    const subject = rows.length ? rows[0].title : "Консультация";
    await pool.query(
      "INSERT INTO consultation_requests (name, phone, subject) VALUES (?, ?, ?)",
      [userName, String(phone).replace(/\D/g, ""), subject]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Детальные страницы разделов: товары, услуги, консультации
const ITEM_TYPES = { product: "products", service: "services", consultation: "consultations" };

// Типы оплачиваемых покупок: курсы, товары, услуги, консультации (через записи), заказы из корзины
const PAY_TYPES = { course: "courses", product: "products", service: "bookings", consultation: "bookings", order: "orders" };
const PAY_TITLE_COL = { course: "title", product: "name" };

function safeJson(s, fallback) {
  try { return JSON.parse(s); } catch { return fallback; }
}

// Возвращает { title, price } для оплачиваемой записи или null.
// Для услуг/консультаций itemId — это id записи (booking), для заказов — id заказа (только своего).
async function resolvePayable(itemType, itemId, userId) {
  const type = String(itemType || "").trim();
  if (type === "service" || type === "consultation") {
    const [rows] = await pool.query(
      "SELECT id, title, price FROM bookings WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      [Number(itemId), Number(userId)]
    );
    if (!rows.length) return null;
    return { title: rows[0].title, price: Number(rows[0].price) || 0 };
  }
  if (type === "order") {
    const [rows] = await pool.query(
      "SELECT id, total, items FROM orders WHERE id = ? AND user_id = ?",
      [Number(itemId), Number(userId)]
    );
    if (!rows.length) return null;
    const count = safeJson(rows[0].items, []).length;
    return { title: `Заказ №${rows[0].id}${count ? ` (${count} поз.)` : ""}`, price: Number(rows[0].total) || 0 };
  }
  const table = PAY_TYPES[type];
  const titleCol = PAY_TITLE_COL[type];
  if (!table || !titleCol) return null;
  const [rows] = await pool.query(`SELECT ${titleCol} AS title, price FROM ${table} WHERE id = ?`, [Number(itemId)]);
  if (!rows.length) return null;
  return { title: rows[0].title, price: Number(rows[0].price) || 0 };
}

// Нормализация запроса на оплату: поддерживается и старый формат {courseId, payment},
// и новый {itemType, itemId, payment}. Возвращает { type, id } или null.
function parsePayTarget(body) {
  const bodyObj = body || {};
  const type = String(bodyObj.itemType || (bodyObj.courseId ? "course" : "") || "").trim();
  const rawId = bodyObj.itemId != null ? bodyObj.itemId : bodyObj.courseId;
  const id = Number(rawId);
  if (!type || !Number.isFinite(id) || id <= 0) return null;
  return { type, id };
}

app.get("/api/items/:type/:id", async (req, res) => {
  const table = ITEM_TYPES[req.params.type];
  if (!table) return res.status(400).json({ error: "Неверный тип записи" });
  try {
    const [rows] = await pool.query(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
    const item = rows[0];
    const [images] = await pool.query(
      "SELECT url FROM item_images WHERE item_type = ? AND item_id = ? ORDER BY position, id",
      [req.params.type, item.id]
    );
    const [reviews] = await pool.query(
      "SELECT id, author, rating, comment, created_at FROM item_reviews WHERE item_type = ? AND item_id = ? ORDER BY created_at DESC",
      [req.params.type, item.id]
    );
    const avg = reviews.length
      ? (reviews.reduce((s, r) => s + Number(r.rating), 0) / reviews.length).toFixed(1)
      : null;
    let instructor_info = null;
    if (item.instructor_id) {
      const [inst] = await pool.query(
        "SELECT id, name, specialty, bio, experience, avatar, socials FROM instructors WHERE id = ?",
        [item.instructor_id]
      );
      if (inst.length) {
        instructor_info = { ...inst[0], socials: parseSocials(inst[0].socials) };
      }
    }
    item.images = images.length ? images.map(i => i.url) : (item.image_url ? [item.image_url] : []);
    res.json({ ...item, reviews, avg_rating: avg, instructor_info, item_type: req.params.type });
  } catch (err) { serverError(res, err); }
});

app.post("/api/items/:type/:id/review", requireAuth, async (req, res) => {
  const table = ITEM_TYPES[req.params.type];
  if (!table) return res.status(400).json({ error: "Неверный тип записи" });
  const { rating, comment } = req.body || {};
  const commentText = String(comment || "").trim();
  if (!commentText) return res.status(400).json({ error: "Заполните отзыв" });
  const r = Math.min(5, Math.max(1, parseInt(rating, 10) || 5));
  try {
    const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
    await pool.query(
      "INSERT INTO item_reviews (item_type, item_id, user_id, author, rating, comment) VALUES (?, ?, ?, ?, ?, ?)",
      [req.params.type, req.params.id, req.session.user.id, req.session.user.name, r, commentText]
    );
    res.json({ success: true });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") return res.status(400).json({ error: "Отзыв уже оставлен" });
    serverError(res, err);
  }
});

app.post("/api/courses/:id/enroll", requireAuth, async (req, res) => {
  try {
    const [courses] = await pool.query("SELECT price, title FROM courses WHERE id = ?", [req.params.id]);
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const price = Number(courses[0].price) || 0;

    if (price > 0) {
      return res.status(400).json({ error: "Требуется подтверждение оплаты по SMS" });
    }

    await pool.query(
      "INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)",
      [req.session.user.id, req.params.id]
    );
    await pool.query(
      "INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'purchase', 'Курс куплен', ?, ?)",
      [req.session.user.id, `Вы записаны на курс: ${courses[0].title}`, `course.html?id=${req.params.id}`]
    );
    res.json({ success: true, paid: false });
  } catch (err) { serverError(res, err); }
});

// Шаг 1: запрос SMS-кода для оплаты. Возвращает демо-QR-код (сканируется банковским
// приложением или камерой) — данные карты на сайт не вводятся.
// Поддерживаются все типы покупок: course / product / service / consultation / order.
app.post("/api/payment/sms-send",
  rateLimit({ max: 30, keyFn: req => "sms_send:" + (req.session.user ? req.session.user.id : req.ip) }),
  requireAuth, async (req, res) => {
  const { payment } = req.body || {};
  const target = parsePayTarget(req.body);
  if (!target || !payment || !payment.method) return res.status(400).json({ error: "Заполните данные оплаты" });
  try {
    const info = await resolvePayable(target.type, target.id, req.session.user.id);
    if (!info) return res.status(404).json({ error: "Запись не найдена" });
    const price = info.price;
    if (price <= 0) return res.status(400).json({ error: "Бесплатно, оплата не требуется" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    await pool.query("DELETE FROM sms_codes WHERE expires_at_ms < ?", [Date.now()]);
    await pool.query("DELETE FROM sms_codes WHERE session_id = ?", [req.session.id]);
    await pool.query(
      "INSERT INTO sms_codes (session_id, code, course_id, item_type, price, method, card_last4, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.session.id, code, target.id, target.type, price, payment.method || "qr", null, expiresAtMs]
    );
    // Демо: QR-код кодирует платёжную ссылку. В реальном проекте здесь платёжный
    // шлюз (СБП/ЮKassa), а код приходит на телефон клиента реальным SMS.
    const qrData = `https://sbp.demo/pay/${target.type}/${target.id}?sum=${price}&title=${encodeURIComponent(info.title)}`;
    const qrImage = await QRCode.toDataURL(qrData, { width: 260, margin: 1, errorCorrectionLevel: "M" });
    res.json({ demoCode: code, qrData, qrImage });
  } catch (err) { serverError(res, err); }
});

// Шаг 2: подтверждение SMS-кода и завершение оплаты.
// В зависимости от типа покупки: запись на курс (enrollment), запись на услугу/консультацию,
// оплата заказа из корзины или покупка товара напрямую.
app.post("/api/payment/sms-confirm",
  rateLimit({ max: 15, keyFn: req => "sms_confirm:" + (req.session.user ? req.session.user.id : req.ip) }),
  requireAuth, async (req, res) => {
  const { code } = req.body || {};
  const target = parsePayTarget(req.body);
  if (!target) return res.status(400).json({ error: "Сначала запросите SMS-код" });
  let entry;
  try {
    const [rows] = await pool.query(
      "SELECT * FROM sms_codes WHERE session_id = ? AND item_type = ? AND course_id = ?",
      [req.session.id, target.type, target.id]
    );
    entry = rows[0];
  } catch (err) { return serverError(res, err); }
  if (!entry) return res.status(400).json({ error: "Сначала запросите SMS-код" });
  if (Date.now() > Number(entry.expires_at_ms)) {
    await pool.query("DELETE FROM sms_codes WHERE id = ?", [entry.id]);
    return res.status(400).json({ error: "Код истёк. Запросите новый." });
  }
  if (String(entry.code) !== String(code || "").replace(/\D/g, "")) {
    return res.status(400).json({ error: "Неверный SMS-код" });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const info = await resolvePayable(entry.item_type, entry.course_id, req.session.user.id);
    await conn.query(
      "INSERT INTO payments (user_id, course_id, item_type, item_title, amount, status, method, card_last4) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)",
      [req.session.user.id, entry.course_id, entry.item_type, info ? info.title : "Покупка", entry.price, entry.method, entry.card_last4]
    );
    if (entry.item_type === "course") {
      await conn.query(
        "INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)",
        [req.session.user.id, entry.course_id]
      );
    } else if (entry.item_type === "service" || entry.item_type === "consultation") {
      await conn.query(
        "UPDATE bookings SET status = 'paid', method = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL) AND status = 'new'",
        [entry.method, entry.course_id, req.session.user.id]
      );
    } else if (entry.item_type === "product") {
      // Прямая покупка товара со страницы товара: фиксируем её и как заказ
      const lines = [{ id: Number(entry.course_id), name: info ? info.title : "Товар", price: Number(entry.price), qty: 1, sum: Number(entry.price) }];
      await conn.query(
        "INSERT INTO orders (user_id, name, phone, address, comment, total, items, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'paid')",
        [req.session.user.id, req.session.user.name || "Покупатель", req.session.user.phone || "", "", "Оплачено через сайт", entry.price, JSON.stringify(lines)]
      );
    } else if (entry.item_type === "order") {
      await conn.query(
        "UPDATE orders SET status = 'paid' WHERE id = ? AND user_id = ?",
        [entry.course_id, req.session.user.id]
      );
    }
    await conn.query("DELETE FROM sms_codes WHERE id = ?", [entry.id]);
    await conn.commit();
    if (entry.item_type === "course") {
      try {
        await pool.query(
          "INSERT INTO notifications (user_id, type, title, body, link) VALUES (?, 'purchase', 'Курс куплен', ?, ?)",
          [req.session.user.id, `Вы записаны на курс: ${info ? info.title : "Курс"}`, `course.html?id=${entry.course_id}`]
        );
      } catch (e) { console.error("Failed to create notification:", e.message); }
    }
    res.json({ success: true, paid: true });
  } catch (err) {
    await conn.rollback();
    serverError(res, err);
  } finally { conn.release(); }
});

app.get("/api/admin/payments", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.amount, p.method, p.card_last4, p.created_at, p.item_type, p.item_title,
         u.id AS user_id, u.name AS user_name, u.email AS user_email
       FROM payments p
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/payments/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM payments WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Мои платежи (история оплат пользователя: курсы, товары, услуги, консультации)
app.get("/api/my/payments", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.amount, p.method, p.card_last4, p.created_at, p.item_type, p.item_title, p.course_id AS item_id
       FROM payments p
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

// Мои покупки: оплаченные заказы товаров и записи на услуги/консультации
app.get("/api/my/purchases", requireAuth, async (req, res) => {
  try {
    const [orders] = await pool.query(
      `SELECT id, total, items, status, created_at FROM orders
       WHERE user_id = ? AND status = 'paid' ORDER BY created_at DESC`,
      [req.session.user.id]
    );
    const [bookings] = await pool.query(
      `SELECT id, item_type, item_id, title, price, method, status, booking_date, booking_time, note, created_at
       FROM bookings WHERE user_id = ? AND status = 'paid' ORDER BY created_at DESC`,
      [req.session.user.id]
    );
    res.json({
      orders: orders.map(o => ({ ...o, items: safeJson(o.items, []) })),
      bookings,
    });
  } catch (err) { serverError(res, err); }
});

// Запись на услугу или консультацию (создаёт бронь со статусом 'new', оплата — через SMS)
app.post("/api/items/:type/:id/book",
  rateLimit({ max: 30, keyFn: req => "book:" + (req.session.user ? req.session.user.id : req.ip) }),
  async (req, res) => {
  const { type, id } = req.params;
  if (type !== "service" && type !== "consultation") {
    return res.status(400).json({ error: "Запись на эту позицию недоступна" });
  }
  const { date, time, comment, name: guestName, phone: guestPhone } = req.body || {};
  const userId = req.session.user ? req.session.user.id : null;
  const gName = String(guestName || "").trim() || (req.session.user ? req.session.user.name : "");
  const gPhone = String(guestPhone || "").trim() || (req.session.user ? req.session.user.phone : "");
  try {
    const table = ITEM_TYPES[type];
    const [rows] = await pool.query(
      type === "consultation" ? "SELECT id, title, price FROM consultations WHERE id = ?"
                              : "SELECT id, name, price FROM services WHERE id = ?",
      [Number(id)]
    );
    if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
    const row = rows[0];
    const title = type === "consultation" ? row.title : row.name;
    const [result] = await pool.query(
      "INSERT INTO bookings (user_id, item_type, item_id, title, guest_name, guest_phone, price, status, booking_date, booking_time, note) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?)",
      [userId, type, Number(id), title, gName, gPhone, Number(row.price) || 0, String(date || "").trim(), String(time || "").trim(), String(comment || "").trim()]
    );
    res.json({ success: true, bookingId: result.insertId });
  } catch (err) { serverError(res, err); }
});

app.post("/api/courses/:id/progress", requireAuth, async (req, res) => {
  const { lessonId } = req.body;
  try {
    const [enr] = await pool.query(
      "SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?",
      [req.session.user.id, req.params.id]
    );
    if (!enr.length) return res.status(403).json({ error: "Сначала оплатите и запишитесь на курс" });
    const [lessons] = await pool.query("SELECT COUNT(*) AS total FROM lessons WHERE course_id = ?", [req.params.id]);
    const [pos] = await pool.query("SELECT position FROM lessons WHERE id = ? AND course_id = ?", [lessonId, req.params.id]);
    if (!pos.length) return res.status(404).json({ error: "Урок не найден" });
    const total = lessons[0].total || 1;
    const progress = Math.min(100, Math.round(((pos[0].position + 1) / total) * 100));
    await pool.query(
      "UPDATE enrollments SET progress = GREATEST(progress, ?) WHERE user_id = ? AND course_id = ?",
      [progress, req.session.user.id, req.params.id]
    );
    res.json({ progress });
  } catch (err) { serverError(res, err); }
});

app.post("/api/courses/:id/review", requireAuth, async (req, res) => {
  const { rating, comment } = req.body;
  try {
    const [enr] = await pool.query(
      "SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?",
      [req.session.user.id, req.params.id]
    );
    if (!enr.length) return res.status(403).json({ error: "Сначала оплатите и запишитесь на курс" });
    await pool.query(
      `INSERT INTO reviews (user_id, course_id, rating, comment) VALUES (?, ?, ?, ?)
       AS new
       ON DUPLICATE KEY UPDATE rating = new.rating, comment = new.comment`,
      [req.session.user.id, req.params.id, Math.max(1, Math.min(5, Number(rating) || 5)), comment || ""]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.get("/api/my", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.price, c.instructor, c.image_url, e.progress, e.enrolled_at,
         i.id AS instructor_id, i.name AS inst_name, i.avatar AS inst_avatar, i.specialty AS inst_specialty
       FROM enrollments e JOIN courses c ON e.course_id = c.id
       LEFT JOIN instructors i ON i.id = c.instructor_id
       WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`,
      [req.session.user.id]
    );
    for (const row of rows) row.instructor_info = instructorInfoRow(row);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

const CERT_FONT = "C:/Windows/Fonts/arial.ttf";

function makeCertificatePDF(userName, courseTitle) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 0 });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const W = doc.page.width;
      const H = doc.page.height;
      const gold = "#b8860b";
      const dark = "#1b2634";

      doc.rect(18, 18, W - 36, H - 36).lineWidth(2).strokeColor(gold).stroke();
      doc.rect(24, 24, W - 48, H - 48).lineWidth(0.8).strokeColor(gold).stroke();

      doc.registerFont("Main", CERT_FONT);
      doc.font("Main").fontSize(34).fillColor(gold).text("СЕРТИФИКАТ", 0, 70, { align: "center", width: W });
      doc.font("Main").fontSize(15).fillColor(dark).text("об успешном завершении курса", 0, 128, { align: "center", width: W });

      doc.moveTo(90, 175).lineTo(W - 90, 175).lineWidth(1).strokeColor(gold).stroke();

      doc.font("Main").fontSize(16).fillColor(dark).text("Настоящим подтверждается, что", 0, 205, { align: "center", width: W });

      doc.font("Main").fontSize(40).fillColor("#0d1520").text(userName, 0, 250, { align: "center", width: W });
      doc.moveTo(150, 315).lineTo(W - 150, 315).lineWidth(0.8).strokeColor("#9aa7b8").stroke();

      doc.font("Main").fontSize(17).fillColor(dark).text("успешно завершил(а) курс", 0, 340, { align: "center", width: W });
      doc.font("Main").fontSize(24).fillColor(gold).text(courseTitle, 0, 375, { align: "center", width: W });

      const dateStr = new Date().toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
      doc.font("Main").fontSize(13).fillColor("#5c6b7d").text(dateStr, 0, 440, { align: "center", width: W });

      doc.font("Main").fontSize(12).fillColor("#7d8da0").text("Платформа онлайн-курсов «Курсы»", 0, 500, { align: "center", width: W });

      doc.end();
    } catch (err) { reject(err); }
  });
}

app.get("/api/certificate/:courseId", requireAuth, async (req, res) => {
  try {
    const [enr] = await pool.query(
      "SELECT progress FROM enrollments WHERE user_id = ? AND course_id = ?",
      [req.session.user.id, req.params.courseId]
    );
    if (!enr.length) return res.status(403).json({ error: "Сначала оплатите и запишитесь на курс" });
    if (Number(enr[0].progress) < 100) return res.status(403).json({ error: "Курс не завершён" });
    const [courses] = await pool.query("SELECT title FROM courses WHERE id = ?", [req.params.courseId]);
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const [users] = await pool.query("SELECT name FROM users WHERE id = ?", [req.session.user.id]);
    const pdf = await makeCertificatePDF(users[0].name, courses[0].title);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="certificate-${req.params.courseId}.pdf"`);
    res.send(pdf);
  } catch (err) { serverError(res, err); }
});

// ============ УВЕДОМЛЕНИЯ ============
app.get("/api/notifications/unread-count", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND is_read = 0",
      [req.session.user.id]
    );
    res.json({ count: rows[0].count });
  } catch (err) { serverError(res, err); }
});

app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT id, type, title, body, link, is_read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post("/api/notifications/read", requireAuth, async (req, res) => {
  const { ids, all } = req.body || {};
  try {
    if (all) {
      await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0", [req.session.user.id]);
    } else if (Array.isArray(ids) && ids.length) {
      await pool.query("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN (?)", [req.session.user.id, ids]);
    }
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============ СООБЩЕНИЯ ============
app.get("/api/messages/conversations", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id AS user_id, u.name, u.avatar,
        (SELECT text FROM messages WHERE (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) AS last_text,
        (SELECT created_at FROM messages WHERE (from_user_id = u.id AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = u.id) ORDER BY created_at DESC LIMIT 1) AS last_at,
        (SELECT COUNT(*) FROM messages WHERE from_user_id = u.id AND to_user_id = ? AND is_read = 0) AS unread
       FROM users u
       WHERE u.id IN (SELECT from_user_id FROM messages WHERE to_user_id = ? UNION SELECT to_user_id FROM messages WHERE from_user_id = ?)
       ORDER BY last_at DESC`,
      [req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id, req.session.user.id]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.get("/api/messages/:userId", requireAuth, async (req, res) => {
  const otherId = Number(req.params.userId);
  if (!otherId) return res.status(400).json({ error: "Неверный пользователь" });
  try {
    const [rows] = await pool.query(
      `SELECT id, from_user_id, to_user_id, text, is_read, created_at FROM messages
       WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
       ORDER BY created_at ASC`,
      [req.session.user.id, otherId, otherId, req.session.user.id]
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post("/api/messages", requireAuth, async (req, res) => {
  const { to_user_id, text } = req.body || {};
  const msgText = String(text || "").trim();
  if (!to_user_id || !msgText) return res.status(400).json({ error: "Укажите получателя и текст" });
  if (Number(to_user_id) === req.session.user.id) return res.status(400).json({ error: "Нельзя писать себе" });
  try {
    const [u] = await pool.query("SELECT id FROM users WHERE id = ?", [to_user_id]);
    if (!u.length) return res.status(404).json({ error: "Пользователь не найден" });
    await pool.query(
      "INSERT INTO messages (from_user_id, to_user_id, text) VALUES (?, ?, ?)",
      [req.session.user.id, to_user_id, msgText]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/messages/read", requireAuth, async (req, res) => {
  const { from_user_id } = req.body || {};
  if (!from_user_id) return res.status(400).json({ error: "Укажите отправителя" });
  try {
    await pool.query(
      "UPDATE messages SET is_read = 1 WHERE from_user_id = ? AND to_user_id = ? AND is_read = 0",
      [from_user_id, req.session.user.id]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.get("/api/admin/users", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.created_at,
        (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id) AS courses_count
       FROM users u ORDER BY u.id`
    );
    const [enr] = await pool.query(
      `SELECT e.user_id, c.id, c.title
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       ORDER BY c.title`
    );
    const byUser = {};
    for (const row of enr) {
      (byUser[row.user_id] = byUser[row.user_id] || []).push({ id: row.id, title: row.title });
    }
    for (const u of rows) u.courses = byUser[u.id] || [];
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/users", requireAdmin, async (req, res) => {
  const { name, email, password, role, phone } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: "Заполните все поля" });
  if (String(password).length < 6) return res.status(400).json({ error: "Пароль минимум 6 символов" });
  try {
    const [existing] = await pool.query("SELECT id FROM users WHERE email = ?", [String(email).trim()]);
    if (existing.length) return res.status(409).json({ error: "Email уже зарегистрирован" });
    const hash = await bcrypt.hash(String(password), 10);
    const [result] = await pool.query(
      "INSERT INTO users (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [String(name).trim(), String(email).trim(), String(phone || "").replace(/\D/g, ""), hash, role === "admin" ? "admin" : "user"]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/users/:id/courses/:courseId", requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query(
      "DELETE FROM enrollments WHERE user_id = ? AND course_id = ?",
      [req.params.id, req.params.courseId]
    );
    if (!r.affectedRows) return res.status(404).json({ error: "Запись не найдена" });
    await pool.query("DELETE FROM reviews WHERE user_id = ? AND course_id = ?", [req.params.id, req.params.courseId]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Ручное зачисление пользователя на курс без оплаты (например, при личной оплате).
app.post("/api/admin/users/:id/courses", requireAdmin, async (req, res) => {
  const courseId = req.body && req.body.courseId;
  if (!courseId) return res.status(400).json({ error: "Укажите курс" });
  try {
    const [users] = await pool.query("SELECT id FROM users WHERE id = ?", [req.params.id]);
    if (!users.length) return res.status(404).json({ error: "Пользователь не найден" });
    const [courses] = await pool.query("SELECT id FROM courses WHERE id = ?", [courseId]);
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    await pool.query(
      "INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)",
      [req.params.id, Number(courseId)]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/users/:id/role", requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "Некорректная роль" });
  try {
    const [rows] = await pool.query("SELECT role FROM users WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Пользователь не найден" });
    if (Number(req.params.id) === req.session.user.id && role !== "admin") {
      return res.status(400).json({ error: "Нельзя понизить самого себя" });
    }
    if (rows[0].role === "admin" && role !== "admin") {
      const [admins] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
      if (Number(admins[0].c) <= 1) return res.status(400).json({ error: "Нельзя понизить последнего администратора" });
    }
    await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.session.user.id) {
    return res.status(400).json({ error: "Нельзя удалить самого себя" });
  }
  try {
    const [rows] = await pool.query("SELECT role FROM users WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Пользователь не найден" });
    if (rows[0].role === "admin") {
      const [admins] = await pool.query("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'");
      if (Number(admins[0].c) <= 1) return res.status(400).json({ error: "Нельзя удалить последнего администратора" });
    }
    await pool.query("DELETE FROM users WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/categories", requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Название обязательно" });
  try {
    await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", [name, description || ""]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/categories/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/courses", requireAdmin, async (req, res) => {
  const { title, description, price, category_id, instructor, instructor_id, image_url } = req.body;
  if (!title) return res.status(400).json({ error: "Название обязательно" });
  try {
    const [result] = await pool.query(
      "INSERT INTO courses (title, description, price, category_id, instructor, instructor_id, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [title, description || "", price || 0, category_id || null, instructor || "", instructor_id || null, image_url || ""]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { serverError(res, err); }
});

app.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  const { title, description, price, category_id, instructor, instructor_id, image_url } = req.body;
  if (!title) return res.status(400).json({ error: "Название обязательно" });
  try {
    await pool.query(
      "UPDATE courses SET title = ?, description = ?, price = ?, category_id = ?, instructor = ?, instructor_id = ?, image_url = ? WHERE id = ?",
      [title, description || "", price || 0, category_id || null, instructor || "", instructor_id || null, image_url || "", req.params.id]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// Управление профилями преподавателей
app.get("/api/admin/instructors", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT i.*,
         (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = i.id) AS courses_count
       FROM instructors i ORDER BY i.name`
    );
    for (const row of rows) row.socials = parseSocials(row.socials);
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/instructors", requireAdmin, async (req, res) => {
  const { name, specialty, bio, experience, avatar, socials } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Имя преподавателя обязательно" });
  try {
    const [result] = await pool.query(
      "INSERT INTO instructors (name, specialty, bio, experience, avatar, socials) VALUES (?, ?, ?, ?, ?, ?)",
      [String(name).trim(), specialty || "", bio || "", experience || "", avatar || "", socialsToDb(socials)]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { serverError(res, err); }
});

app.put("/api/admin/instructors/:id", requireAdmin, async (req, res) => {
  const { name, specialty, bio, experience, avatar, socials } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: "Имя преподавателя обязательно" });
  try {
    const [rows] = await pool.query("SELECT id FROM instructors WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Преподаватель не найден" });
    await pool.query(
      "UPDATE instructors SET name = ?, specialty = ?, bio = ?, experience = ?, avatar = ?, socials = ? WHERE id = ?",
      [String(name).trim(), specialty || "", bio || "", experience || "", avatar || "", socialsToDb(socials), req.params.id]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/instructors/:id", requireAdmin, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT id FROM instructors WHERE id = ?", [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Преподаватель не найден" });
    await pool.query("UPDATE courses SET instructor_id = NULL WHERE instructor_id = ?", [req.params.id]);
    await pool.query("DELETE FROM instructors WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============ АДМИН: ТОВАРЫ / УСЛУГИ / КОНСУЛЬТАЦИИ ============
function registerItemAdmin(type, table) {
  const nameCol = type === "consultation" ? "title" : "name";
  const joinSql = type === "product"
    ? ""
    : " LEFT JOIN instructors i ON i.id = t.instructor_id";

  app.get(`/api/admin/${type}s`, requireAdmin, async (_req, res) => {
    try {
      const [rows] = await pool.query(
        `SELECT t.*${joinSql ? ", i.name AS instructor_name" : ""},
           (SELECT COUNT(*) FROM item_images im WHERE im.item_type = ? AND im.item_id = t.id) AS images_count,
           (SELECT GROUP_CONCAT(CONCAT_WS('|', im.id, im.url) SEPARATOR ';;') FROM item_images im WHERE im.item_type = ? AND im.item_id = t.id ORDER BY im.position, im.id) AS images_str
         FROM ${table} t${joinSql} ORDER BY t.id DESC`,
        [type, type]
      );
      for (const row of rows) row.images = parseItemImages(row.images_str);
      res.json(rows);
    } catch (err) { serverError(res, err); }
  });

  app.post(`/api/admin/${type}s`, requireAdmin, async (req, res) => {
    const { name, title, description, price, category, in_stock, image_url, video_url, duration_min, icon, instructor_id, expert } = req.body || {};
    const value = String(name || title || "").trim();
    if (!value) return res.status(400).json({ error: "Укажите название" });
    const insId = instructor_id ? Number(instructor_id) : null;
    try {
      let result;
      if (type === "product") {
        [result] = await pool.query(
          "INSERT INTO products (name, description, price, category, in_stock, image_url, video_url) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [value, description || "", Number(price) || 0, category || "", in_stock ? 1 : 0, image_url || "", video_url || ""]
        );
      } else if (type === "service") {
        [result] = await pool.query(
          "INSERT INTO services (name, description, price, duration_min, icon, image_url, instructor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [value, description || "", Number(price) || 0, Number(duration_min) || 0, icon || "💆", image_url || "", insId]
        );
      } else {
        [result] = await pool.query(
          "INSERT INTO consultations (title, description, price, duration_min, expert, image_url, instructor_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [value, description || "", Number(price) || 0, Number(duration_min) || 0, expert || "", image_url || "", insId]
        );
      }
      res.json({ success: true, id: result.insertId });
    } catch (err) { serverError(res, err); }
  });

  app.put(`/api/admin/${type}s/:id`, requireAdmin, async (req, res) => {
    const { name, title, description, price, category, in_stock, image_url, video_url, duration_min, icon, instructor_id, expert } = req.body || {};
    const value = String(name || title || "").trim();
    if (!value) return res.status(400).json({ error: "Укажите название" });
    const insId = instructor_id ? Number(instructor_id) : null;
    try {
      const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
      if (type === "product") {
        await pool.query(
          "UPDATE products SET name = ?, description = ?, price = ?, category = ?, in_stock = ?, image_url = ?, video_url = ? WHERE id = ?",
          [value, description || "", Number(price) || 0, category || "", in_stock ? 1 : 0, image_url || "", video_url || "", req.params.id]
        );
      } else if (type === "service") {
        await pool.query(
          "UPDATE services SET name = ?, description = ?, price = ?, duration_min = ?, icon = ?, image_url = ?, instructor_id = ? WHERE id = ?",
          [value, description || "", Number(price) || 0, Number(duration_min) || 0, icon || "💆", image_url || "", insId, req.params.id]
        );
      } else {
        await pool.query(
          "UPDATE consultations SET title = ?, description = ?, price = ?, duration_min = ?, expert = ?, image_url = ?, instructor_id = ? WHERE id = ?",
          [value, description || "", Number(price) || 0, Number(duration_min) || 0, expert || "", image_url || "", insId, req.params.id]
        );
      }
      res.json({ success: true });
    } catch (err) { serverError(res, err); }
  });

  app.delete(`/api/admin/${type}s/:id`, requireAdmin, async (req, res) => {
    try {
      const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
      await pool.query("DELETE FROM item_images WHERE item_type = ? AND item_id = ?", [type, req.params.id]);
      await pool.query("DELETE FROM item_reviews WHERE item_type = ? AND item_id = ?", [type, req.params.id]);
      await pool.query(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      res.json({ success: true });
    } catch (err) { serverError(res, err); }
  });

  app.post(`/api/admin/${type}s/:id/images`, requireAdmin, async (req, res) => {
    const { url } = req.body || {};
    if (!url || !String(url).trim()) return res.status(400).json({ error: "Укажите ссылку на изображение" });
    try {
      const [rows] = await pool.query(`SELECT id FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: "Запись не найдена" });
      const [mx] = await pool.query(
        "SELECT COALESCE(MAX(position), -1) AS m FROM item_images WHERE item_type = ? AND item_id = ?",
        [type, req.params.id]
      );
      await pool.query(
        "INSERT INTO item_images (item_type, item_id, url, position) VALUES (?, ?, ?, ?)",
        [type, req.params.id, String(url).trim(), Number(mx[0].m) + 1]
      );
      res.json({ success: true });
    } catch (err) { serverError(res, err); }
  });
}

function parseItemImages(str) {
  if (!str) return [];
  return String(str).split(";;").map((part) => {
    const idx = part.indexOf("|");
    if (idx < 0) return null;
    return { id: Number(part.slice(0, idx)), url: part.slice(idx + 1) };
  }).filter(Boolean);
}

app.delete("/api/admin/item-images/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM item_images WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

registerItemAdmin("product", "products");
registerItemAdmin("service", "services");
registerItemAdmin("consultation", "consultations");

// ============ АДМИН: ОТЗЫВЫ САЙТА ============
app.get("/api/admin/site-reviews", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM site_reviews ORDER BY id DESC");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/site-reviews", requireAdmin, async (req, res) => {
  const { author, role, rating, text } = req.body || {};
  if (!author || !String(author).trim()) return res.status(400).json({ error: "Укажите автора" });
  if (!text || !String(text).trim()) return res.status(400).json({ error: "Укажите текст отзыва" });
  try {
    const [result] = await pool.query(
      "INSERT INTO site_reviews (author, role, rating, text) VALUES (?, ?, ?, ?)",
      [String(author).trim(), role || "", Math.min(5, Math.max(1, Number(rating) || 5)), String(text).trim()]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/site-reviews/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM site_reviews WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============ АДМИН: ЗАЯВКИ ============
app.get("/api/admin/requests", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM consultation_requests ORDER BY created_at DESC");
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/requests/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM consultation_requests WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

// ============ АДМИН: ЗАПИСИ НА УСЛУГИ И КОНСУЛЬТАЦИИ ============
app.get("/api/admin/bookings", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT b.id, b.item_type, b.item_id, b.title, b.price, b.method, b.status,
         b.booking_date, b.booking_time, b.note, b.created_at, b.guest_name, b.guest_phone,
         COALESCE(u.name, b.guest_name) AS user_name, COALESCE(u.phone, b.guest_phone) AS user_phone
       FROM bookings b LEFT JOIN users u ON u.id = b.user_id
       ORDER BY b.created_at DESC`
    );
    res.json(rows);
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/bookings/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM bookings WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM courses WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/courses/:id/lessons", requireAdmin, async (req, res) => {
  const { title, content, duration_min, video_url, image_url, quiz } = req.body;
  if (!title) return res.status(400).json({ error: "Название урока обязательно" });
  try {
    const [maxPos] = await pool.query("SELECT MAX(position) AS m FROM lessons WHERE course_id = ?", [req.params.id]);
    const pos = (maxPos[0].m ?? -1) + 1;
    await pool.query(
      "INSERT INTO lessons (course_id, title, content, duration_min, position, video_url, image_url, quiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [req.params.id, title, content || "", duration_min || 0, pos, video_url || "", image_url || "", quiz || null]
    );
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/lessons/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM lessons WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

app.post("/api/admin/courses/:id/media", requireAdmin, async (req, res) => {
  const { url } = req.body || {};
  if (!url) return res.status(400).json({ error: "Укажите ссылку на файл" });
  try {
    const type = getMediaType(url);
    const [maxPos] = await pool.query("SELECT MAX(position) AS m FROM course_media WHERE course_id = ?", [req.params.id]);
    const pos = (maxPos[0].m ?? -1) + 1;
    await pool.query(
      "INSERT INTO course_media (course_id, type, url, position) VALUES (?, ?, ?, ?)",
      [req.params.id, type, url, pos]
    );
    res.json({ success: true, type });
  } catch (err) { serverError(res, err); }
});

app.delete("/api/admin/media/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM course_media WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { serverError(res, err); }
});

async function seed() {
  const [count] = await pool.query("SELECT COUNT(*) AS c FROM courses");
  if (count[0].c > 0) return;
  const [cat1] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Классический массаж", "Базовые техники классического массажа: от поглаживаний до глубоких приёмов."]);
  const [cat2] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Спортивный массаж", "Массаж для спортсменов: разминка, восстановление и профилактика травм."]);
  const [cat3] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Тайский массаж", "Традиционные тайские техники: стрейчинг, давление и энергетические линии."]);
  const [cat4] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Детский массаж", "Безопасные техники массажа для малышей и детей разного возраста."]);

  const base = [
    { c: cat1.insertId, t: "Классический массаж с нуля до профи", d: "Полный курс классического массажа: анатомия, базовые приёмы, техники спины и шеи, построение сеанса.", p: 3490, i: "Ирина Соколова", sp: "Классический и лечебный массаж", exp: "12 лет практики, сертификаты FISIOTERAPIA", bio: "Обучаю классическому массажу с 2014 года. Работала с профессиональными спортсменами и клиентами с хроническими болями в спине. Автор методики «мягкого глубокого прорабатывания».", img: "/uploads/course-classic.svg" },
    { c: cat1.insertId, t: "Лечебный массаж спины и шеи", d: "Как работать с болями в спине и шее: диагностика, глубокие техники, шейно-воротниковая зона.", p: 4990, i: "Сергей Морозов", sp: "Лечебный массаж и реабилитация", exp: "15 лет практики, мед. образование", bio: "Врач-реабилитолог и массажист. Специализируюсь на лечебном массаже позвоночника и реабилитации после травм. Преподаю диагностику осанки и работу с триггерными точками.", img: "/uploads/course-spine.svg" },
    { c: cat2.insertId, t: "Спортивный массаж и восстановление", d: "Разогревающий и восстановительный массаж, работа с крепатурой и травмами у спортсменов.", p: 2990, i: "Алексей Волков", sp: "Спортивный массаж", exp: "10 лет практики, МС по дзюдо", bio: "Мастер спорта по дзюдо, сертифицированный спортивный массажист. Работал с командами по футболу и боксу. Обучаю разминочному, восстановительному массажу и работе при травмах.", img: "/uploads/course-sport.svg" },
    { c: cat3.insertId, t: "Тайский массаж: традиционные техники", d: "Давление большим пальцем, стрейчинг и полная последовательность традиционного сеанса.", p: 5490, i: "Ким Сурайя", sp: "Тайский традиционный массаж", exp: "20 лет практики, обучение в Чиангмае", bio: "Потомственный тайский массажист. Обучалась в школе Wat Pho (Бангкок) и в Чиангмае. Передаёт традиционные техники давления, энергетические линии и стрейчинг.", img: "/uploads/course-thai.svg" },
    { c: cat4.insertId, t: "Детский массаж для родителей", d: "Массаж и гимнастика для малышей: безопасность, базовые приёмы, игровые техники.", p: 2490, i: "Елена Кузнецова", sp: "Детский массаж", exp: "9 лет практики, курс по детскому массажу", bio: "Педиатрический массажист. Научила массажу и гимнастике сотни родителей. Курс построен на безопасных игровых техниках для детей от рождения до 3 лет.", img: "/uploads/course-kids.svg" },
  ];
  for (const b of base) {
    let insId = null;
    const [existing] = await pool.query("SELECT id FROM instructors WHERE name = ?", [b.i]);
    if (existing.length) {
      insId = existing[0].id;
    } else {
      const [ins] = await pool.query(
        "INSERT INTO instructors (name, specialty, bio, experience) VALUES (?, ?, ?, ?)",
        [b.i, b.sp, b.bio, b.exp]
      );
      insId = ins.insertId;
    }
    await pool.query("INSERT INTO courses (category_id, title, description, price, instructor, instructor_id, image_url) VALUES (?, ?, ?, ?, ?, ?, ?)", [b.c, b.t, b.d, b.p, b.i, insId, b.img || ""]);
  }
  const [allCourses] = await pool.query("SELECT id FROM courses ORDER BY id");
  const lessonsByCourse = {};
  for (const l of seedData.lessons) (lessonsByCourse[l.course_id] = lessonsByCourse[l.course_id] || []).push(l);
  const mediaByCourse = {};
  for (const m of seedData.media) (mediaByCourse[m.course_id] = mediaByCourse[m.course_id] || []).push(m);
  for (const course of allCourses) {
    for (const l of (lessonsByCourse[course.id] || []).sort((a, b) => a.position - b.position)) {
      await pool.query(
        "INSERT INTO lessons (course_id, title, content, duration_min, position, video_url, image_url, quiz) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [course.id, l.title, l.content, l.duration_min, l.position, l.video_url, l.image_url, l.quiz || null]
      );
    }
    for (const m of mediaByCourse[course.id] || []) {
      await pool.query(
        "INSERT INTO course_media (course_id, type, url, position) VALUES (?, ?, ?, ?)",
        [course.id, m.type, m.url, m.position]
      );
    }
  }

  const adminHash = await bcrypt.hash("admin123", 10);
  await pool.query(
    "INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'admin') ON DUPLICATE KEY UPDATE role='admin'",
    ["Администратор", "admin@courses.ru", adminHash]
  );
  const userHash = await bcrypt.hash("user123", 10);
  await pool.query(
    "INSERT IGNORE INTO users (name, email, phone, password_hash, role, avatar) VALUES (?, ?, ?, ?, 'user', ?)",
    ["Тестовый пользователь", "user@courses.ru", "79990000001", userHash, "/api/media/avatar-user.svg"]
  );
}

// Профиль тестового пользователя: запись на первый курс + оплата, чтобы личный
// кабинет выглядел заполненным. Безопасно вызывать на каждом старте.
async function seedTestUser() {
  const userHash = await bcrypt.hash("user123", 10);
  await pool.query(
    "INSERT IGNORE INTO users (name, email, phone, password_hash, role, avatar) VALUES (?, ?, ?, ?, 'user', ?)",
    ["Тестовый пользователь", "user@courses.ru", "79990000001", userHash, "/api/media/avatar-user.svg"]
  );
  await pool.query(
    "UPDATE users SET avatar = ?, phone = ? WHERE email = 'user@courses.ru'",
    ["/api/media/avatar-user.svg", "79990000001"]
  );
  const [users] = await pool.query("SELECT id FROM users WHERE email = 'user@courses.ru'");
  if (!users.length) return;
  const uid = users[0].id;
  const [enr] = await pool.query("SELECT 1 FROM enrollments WHERE user_id = ? LIMIT 1", [uid]);
  if (enr.length) return;
  const [courses] = await pool.query("SELECT id, title, price FROM courses ORDER BY id LIMIT 1");
  if (!courses.length) return;
  const c = courses[0];
  await pool.query(
    "INSERT IGNORE INTO enrollments (user_id, course_id, progress) VALUES (?, ?, ?)",
    [uid, c.id, 40]
  );
  await pool.query(
    "INSERT IGNORE INTO payments (user_id, course_id, item_type, item_title, amount, status, method) VALUES (?, ?, 'course', ?, ?, 'completed', 'qr')",
    [uid, c.id, c.title, c.price]
  );
}

// Тестовые данные разделов главной страницы. Заполняет только пустые таблицы,
// поэтому безопасно вызывать на каждом старте (дополняет существующую БД).
async function seedSections() {
  const [p] = await pool.query("SELECT COUNT(*) AS c FROM products");
  if (!p[0].c) {
    const products = [
      ["Масло для массажа «Атлас» 200 мл", "Питательное массажное масло с витамином Е, без запаха. Подходит для классического и спортивного массажа.", 790, "/uploads/product-oil.svg", "Масла и кремы", 1],
      ["Крем для тела «Нежность» 150 мл", "Увлажняющий крем для ежедневного ухода и массажа, быстро впитывается.", 650, "/uploads/product-cream.svg", "Масла и кремы", 1],
      ["Ролл для миофасциального релиза", "Массажный ролл средней жёсткости для самостоятельной проработки мышц и фасций.", 1290, "/uploads/product-roller.svg", "Инструменты", 1],
      ["Коврик для тайского массажа", "Складной коврик с мягким наполнителем для практик на полу.", 2490, "/uploads/product-mat.svg", "Инструменты", 1],
      ["Массажная палочка «Прогрев»", "Удобная палочка для точечного давления на триггерные точки.", 490, "/uploads/product-stick.svg", "Инструменты", 1],
      ["Полотенце банное 100×150", "Мягкое банное полотенце из 100% хлопка для кабинета.", 850, "/uploads/product-towel.svg", "Кабинет", 0],
    ];
    for (const pr of products) {
      await pool.query(
        "INSERT INTO products (name, description, price, image_url, category, in_stock) VALUES (?, ?, ?, ?, ?, ?)",
        pr
      );
    }
    console.log("Раздел «Товары»: добавлено", products.length, "позиций");
  }

  const [s] = await pool.query("SELECT COUNT(*) AS c FROM services");
  if (!s[0].c) {
    const services = [
      ["Классический массаж", "Полный сеанс классического массажа: разогрев, глубокая проработка мышц, расслабление.", 2000, 60, "💆"],
      ["Массаж спины и шеи", "Лечебный массаж шейно-воротниковой зоны: снятие спазма, работа с триггерными точками.", 1500, 45, "🦴"],
      ["Спортивный массаж", "Восстановление после нагрузок: снятие крепатуры, возвращение тонуса мышцам.", 2200, 60, "🏋️"],
      ["Тайский массаж", "Традиционный тайский массаж: стрейчинг, давление вдоль сен-линий, 90 минут релакса.", 3500, 90, "🧘"],
      ["Детский массаж", "Нежный массаж и гимнастика для малышей: снятие колик, укрепление мышц.", 1200, 30, "👶"],
      ["Лимфодренажный массаж", "Мягкая техника для снятия отёков и улучшения лимфотока.", 1800, 50, "🌊"],
    ];
    for (const sv of services) {
      await pool.query(
        "INSERT INTO services (name, description, price, duration_min, icon) VALUES (?, ?, ?, ?, ?)",
        sv
      );
    }
    console.log("Раздел «Услуги»: добавлено", services.length, "позиций");
  }

  const [c] = await pool.query("SELECT COUNT(*) AS c FROM consultations");
  if (!c[0].c) {
    const consultations = [
      ["Разбор осанки и болей в спине", "Онлайн-консультация с врачом-реабилитологом: разберём причины болей и составим план.", 1500, 30, "Сергей Морозов"],
      ["Подбор курса массажа", "Поможем выбрать программу обучения под ваши цели и опыт.", 0, 20, "Ирина Соколова"],
      ["Консультация по детскому массажу", "Индивидуальные рекомендации по массажу и гимнастике для вашего малыша.", 1000, 25, "Елена Кузнецова"],
      ["Техника тайского массажа", "Личный разбор техник давления и стрейчинга для практикующих.", 1800, 40, "Ким Сурайя"],
    ];
    for (const co of consultations) {
      await pool.query(
        "INSERT INTO consultations (title, description, price, duration_min, expert) VALUES (?, ?, ?, ?, ?)",
        co
      );
    }
    console.log("Раздел «Консультации»: добавлено", consultations.length, "позиций");
  }

  const [r] = await pool.query("SELECT COUNT(*) AS c FROM site_reviews");
  if (!r[0].c) {
    const reviews = [
      ["Анна К.", "Выпускница курса «Классический массаж»", 5, "Прошла курс с нуля — теперь принимаю клиентов дома. Очень понятная подача и отличные видеоуроки!"],
      ["Дмитрий П.", "Клиент", 5, "Записался на сеанс спортивного массажа — спина как новая. Рекомендую!"],
      ["Марина В.", "Выпускница курса «Детский массаж»", 5, "Малыш стал спать лучше, колики прошли. Спасибо за курс!"],
      ["Олег С.", "Клиент", 4, "Тайский массаж — это что-то невероятное. Мастер — профессионал своего дела."],
      ["Екатерина Л.", "Выпускница курса «Лечебный массаж»", 5, "Практика с триггерными точками реально работает. Благодарю преподавателей!"],
    ];
    for (const rv of reviews) {
      await pool.query(
        "INSERT INTO site_reviews (author, role, rating, text) VALUES (?, ?, ?, ?)",
        rv
      );
    }
    console.log("Раздел «Отзывы»: добавлено", reviews.length, "отзывов");
  }
}

async function getOrCreateInstructor(profile) {
  const [found] = await pool.query("SELECT id FROM instructors WHERE name = ?", [profile.name]);
  if (found.length) return found[0].id;
  const [ins] = await pool.query(
    "INSERT INTO instructors (name, specialty, bio, experience, avatar) VALUES (?, ?, ?, ?, ?)",
    [profile.name, profile.specialty, profile.bio, profile.experience, profile.avatar]
  );
  return ins.insertId;
}

// Дозаполнение разделов: специалисты, изображения, галереи и отзывы для детальных страниц
async function seedSectionsExtras() {
  // Специалист для услуг
  const therapistProfile = {
    name: "Анна Матвеева",
    specialty: "Массажист-терапевт, стаж 12 лет",
    bio: "Ведущий специалист по классическому, лечебному и лимфодренажному массажу. Проводит обучение мастеров, ведёт приём и контролирует качество сеансов.",
    experience: "12 лет",
    avatar: "/uploads/svetlana.svg",
  };
  const [svcNoInst] = await pool.query("SELECT id FROM services WHERE instructor_id IS NULL");
  if (svcNoInst.length) {
    const therapistId = await getOrCreateInstructor(therapistProfile);
    for (const s of svcNoInst) {
      await pool.query("UPDATE services SET instructor_id = ? WHERE id = ?", [therapistId, s.id]);
    }
  }

  // Профили экспертов для консультаций
  const expertProfiles = {
    "Сергей Морозов": {
      name: "Сергей Морозов", specialty: "Врач-реабилитолог", experience: "10 лет",
      bio: "Врач-реабилитолог, специалист по коррекции осанки и работе с болями в спине. Помогает составить план восстановления и выбрать подходящие техники массажа.",
      avatar: "/uploads/course-spine.svg",
    },
    "Ирина Соколова": {
      name: "Ирина Соколова", specialty: "Методист образовательных программ", experience: "8 лет",
      bio: "Методист и преподаватель школы массажа. Помогает выбрать программу обучения под ваши цели, опыт и удобный график.",
      avatar: "/uploads/course-classic.svg",
    },
    "Елена Кузнецова": {
      name: "Елена Кузнецова", specialty: "Специалист по детскому массажу", experience: "9 лет",
      bio: "Сертифицированный специалист по детскому массажу и гимнастике. Даёт индивидуальные рекомендации для малышей от 0 до 3 лет.",
      avatar: "/uploads/course-kids.svg",
    },
    "Ким Сурайя": {
      name: "Ким Сурайя", specialty: "Тренер по тайскому массажу", experience: "15 лет",
      bio: "Преподаватель традиционного тайского массажа. Проводит разбор техник давления и стрейчинга для практикующих массажистов.",
      avatar: "/uploads/course-thai.svg",
    },
  };
  const [consNoInst] = await pool.query("SELECT id, expert FROM consultations WHERE instructor_id IS NULL AND expert <> ''");
  for (const c of consNoInst) {
    const prof = expertProfiles[c.expert];
    if (!prof) continue;
    const instId = await getOrCreateInstructor(prof);
    await pool.query("UPDATE consultations SET instructor_id = ? WHERE id = ?", [instId, c.id]);
  }

  // Основные изображения для услуг и консультаций
  const svcImg = {
    "Классический массаж": "/uploads/course-classic.svg",
    "Массаж спины и шеи": "/uploads/course-spine.svg",
    "Спортивный массаж": "/uploads/course-sport.svg",
    "Тайский массаж": "/uploads/course-thai.svg",
    "Детский массаж": "/uploads/course-kids.svg",
    "Лимфодренажный массаж": "/uploads/course-limfo.svg",
  };
  const [svcNoImg] = await pool.query("SELECT id, name FROM services WHERE image_url = ''");
  for (const s of svcNoImg) {
    const url = svcImg[s.name] || "/uploads/course-classic.svg";
    await pool.query("UPDATE services SET image_url = ? WHERE id = ?", [url, s.id]);
  }
  const consImg = {
    "Разбор осанки и болей в спине": "/uploads/lesson-anatomy.svg",
    "Подбор курса массажа": "/uploads/lesson-hands.svg",
    "Консультация по детскому массажу": "/uploads/lesson-baby.svg",
    "Техника тайского массажа": "/uploads/lesson-thai.svg",
  };
  const [consNoImg] = await pool.query("SELECT id, title FROM consultations WHERE image_url = ''");
  for (const c of consNoImg) {
    const url = consImg[c.title] || "/uploads/lesson-hands.svg";
    await pool.query("UPDATE consultations SET image_url = ? WHERE id = ?", [url, c.id]);
  }

  // Галереи изображений
  async function ensureGallery(type, table, imgMap, extraMap) {
    const [rows] = await pool.query(`SELECT id, ${type === "product" ? "name" : type === "service" ? "name" : "title"} AS title, image_url FROM ${table}`);
    for (const r of rows) {
      const [has] = await pool.query("SELECT id FROM item_images WHERE item_type = ? AND item_id = ? LIMIT 1", [type, r.id]);
      if (has.length) continue;
      const urls = [r.image_url || imgMap[r.title] || "/uploads/course-default.svg"];
      const extra = extraMap[r.title];
      if (extra) for (const u of extra) if (!urls.includes(u)) urls.push(u);
      for (let i = 0; i < urls.length; i++) {
        await pool.query(
          "INSERT INTO item_images (item_type, item_id, url, position) VALUES (?, ?, ?, ?)",
          [type, r.id, urls[i], i]
        );
      }
    }
  }
  await ensureGallery("product", "products", {}, {});
  await ensureGallery("service", "services", svcImg, {
    "Классический массаж": ["/uploads/lesson-hands.svg"],
    "Массаж спины и шеи": ["/uploads/lesson-neck.svg"],
    "Спортивный массаж": ["/uploads/lesson-sport.svg"],
    "Тайский массаж": ["/uploads/lesson-thai.svg"],
    "Детский массаж": ["/uploads/lesson-baby.svg"],
    "Лимфодренажный массаж": ["/uploads/lesson-pressure.svg"],
  });
  await ensureGallery("consultation", "consultations", consImg, {
    "Разбор осанки и болей в спине": ["/uploads/course-spine.svg"],
    "Подбор курса массажа": ["/uploads/course-classic.svg"],
    "Консультация по детскому массажу": ["/uploads/course-kids.svg"],
    "Техника тайского массажа": ["/uploads/course-thai.svg"],
  });

  // Отзывы для детальных страниц
  const reviewPool = [
    ["Анна К.", 5, "Всё на высшем уровне! Рекомендую."],
    ["Дмитрий П.", 5, "Профессиональный подход, всё чётко и по делу."],
    ["Марина В.", 4, "Отличный результат, обязательно обращусь ещё."],
    ["Олег С.", 5, "Специалист — профессионал своего дела."],
    ["Екатерина Л.", 4, "Хорошая организация и внимательное отношение."],
    ["Игорь Т.", 5, "Превысило ожидания. Спасибо за работу!"],
  ];
  for (const type of Object.keys(ITEM_TYPES)) {
    const table = ITEM_TYPES[type];
    const [rows] = await pool.query(`SELECT id FROM ${table}`);
    for (const r of rows) {
      const [cnt] = await pool.query("SELECT COUNT(*) AS c FROM item_reviews WHERE item_type = ? AND item_id = ?", [type, r.id]);
      if (cnt[0].c) continue;
      const count = 1 + (r.id % 3);
      for (let i = 0; i < count; i++) {
        const rv = reviewPool[(r.id + i) % reviewPool.length];
        await pool.query(
          "INSERT INTO item_reviews (item_type, item_id, author, rating, comment) VALUES (?, ?, ?, ?, ?)",
          [type, r.id, rv[0], rv[1], rv[2]]
        );
      }
    }
  }
}

async function seedSiteConfig() {
  const defaults = {
    contact_telegram: "@massage_school_msk",
    contact_whatsapp: "79035557788",
    contact_vk: "https://vk.com/massage_school",
    contact_phone: "+7 (495) 555-77-88",
    contact_email: "info@massage-school.ru",
  };
  for (const [key, val] of Object.entries(defaults)) {
    await pool.query(
      "INSERT IGNORE INTO site_config (cfg_key, cfg_value) VALUES (?, ?)",
      [key, val]
    );
  }
}

app.listen(PORT, async () => {
  try {
    await initSchema();
    await seed();
    await seedSections();
    await seedSectionsExtras();
    await seedTestUser();
    await seedSiteConfig();
    console.log(`Сайт курсов запущен: http://localhost:${PORT}`);
    console.log("Админ: admin@courses.ru / admin123");
    console.log("Пользователь: user@courses.ru / user123");
  } catch (err) {
    console.error("Ошибка инициализации БД:", err.message);
    if (/Unknown database/i.test(err.message)) {
      console.error("База данных не создана. Выполните: mysql -u root -p < init_db.sql (или запустите start.bat)");
    }
  }
});

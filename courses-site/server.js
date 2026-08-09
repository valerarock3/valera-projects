const express = require("express");
const path = require("path");
const fs = require("fs");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const multer = require("multer");
const { pool, initSchema } = require("./db");

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Защитные заголовки для загруженных файлов (до статической раздачи)
app.use("/uploads", (req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'");
  next();
});
app.use(express.static(path.join(__dirname, "public")));

app.use(session({
  secret: "courses_secret_key_2026",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
}));

// Ожидающие SMS-подтверждения оплаты хранятся в таблице sms_codes (переживают рестарт сервера)

// Загрузка файлов (видео / изображения / аудио)
const UPLOAD_DIR = path.join(__dirname, "public", "uploads");
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
    res.json({ url: "/uploads/" + req.file.filename, name: req.file.originalname });
  });
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
  const ext = (url || "").split("?")[0].toLowerCase();
  if (/\.(mp4|webm|mov|mkv|avi|m4v|ogv)$/.test(ext)) return "video";
  if (/\.(mp3|wav|m4a|aac|oga|flac|ogg)$/.test(ext)) return "audio";
  return "image";
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
  return `<div class="block"><video controls src="${abs}"></video></div>`;
}

function buildLessonHtml(lesson, quiz, base) {
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
  const media = lesson.video_url ? mediaHtml(lesson.video_url, base) : "";
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
  .download-note { border-top: 1px solid #dce4ee; margin-top: 24px; padding-top: 12px; color: #7d8da0; font-size: 13px; }
</style>
</head>
<body>
  <div class="meta">${escapeHtmlFile(lesson.course_title)} · Урок ${lesson.position + 1} · ⏱ ${lesson.duration_min} мин</div>
  <h1>${escapeHtmlFile(lesson.title)}</h1>
  ${img}
  ${media}
  ${content}
  ${quizHtml}
  <div class="download-note">Скачано с платформы «Курсы»</div>
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

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

app.post("/api/register", async (req, res) => {
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
    const user = { id: result.insertId, name, email, role: "user" };
    req.session.user = user;
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Заполните все поля" });
  try {
    const [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (!rows.length) return res.status(401).json({ error: "Неверный email или пароль" });
    const ok = await bcrypt.compare(password, rows[0].password_hash);
    if (!ok) return res.status(401).json({ error: "Неверный email или пароль" });
    const user = { id: rows[0].id, name: rows[0].name, email: rows[0].email, role: rows[0].role };
    req.session.user = user;
    res.json({ user });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

app.get("/api/categories", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM categories ORDER BY name");
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/courses", async (req, res) => {
  try {
    const categoryId = req.query.category ? Number(req.query.category) : null;
    const q = categoryId
      ? `SELECT c.*, cat.name AS category_name,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
         FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id
         WHERE c.category_id = ? ORDER BY c.created_at DESC`
      : `SELECT c.*, cat.name AS category_name,
           (SELECT COUNT(*) FROM lessons l WHERE l.course_id = c.id) AS lessons_count
         FROM courses c LEFT JOIN categories cat ON c.category_id = cat.id
         ORDER BY c.created_at DESC`;
    const [rows] = categoryId
      ? await pool.query(q, [categoryId])
      : await pool.query(q);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/courses/:id", async (req, res) => {
  try {
    const [courses] = await pool.query(
      `SELECT c.*, cat.name AS category_name FROM courses c
       LEFT JOIN categories cat ON c.category_id = cat.id WHERE c.id = ?`,
      [req.params.id]
    );
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const course = courses[0];
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
    res.json({ ...course, lessons: parsedLessons, reviews, media, enrolled, progress });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/courses/:courseId/lessons/:lessonId/download", requireAuth, async (req, res) => {
  try {
    const [enr] = await pool.query(
      "SELECT 1 FROM enrollments WHERE user_id = ? AND course_id = ?",
      [req.session.user.id, req.params.courseId]
    );
    if (!enr.length) {
      return res.status(403).json({ error: "Сначала оплатите и запишитесь на курс" });
    }
    const [rows] = await pool.query(
      `SELECT l.*, c.title AS course_title FROM lessons l
       JOIN courses c ON c.id = l.course_id
       WHERE l.id = ? AND l.course_id = ?`,
      [req.params.lessonId, req.params.courseId]
    );
    if (!rows.length) return res.status(404).json({ error: "Урок не найден" });
    const lesson = rows[0];
    const quiz = parseQuiz(lesson.quiz);
    const base = `${req.protocol}://${req.get("host")}`;
    const html = buildLessonHtml(lesson, quiz, base);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="lesson-${lesson.id}.html"`);
    res.send(html);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/courses/:id/enroll", requireAuth, async (req, res) => {
  try {
    const [courses] = await pool.query("SELECT price FROM courses WHERE id = ?", [req.params.id]);
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const price = Number(courses[0].price) || 0;

    if (price > 0) {
      return res.status(400).json({ error: "Требуется подтверждение оплаты по SMS" });
    }

    await pool.query(
      "INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)",
      [req.session.user.id, req.params.id]
    );
    res.json({ success: true, paid: false });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Шаг 1: запрос SMS-кода для оплаты
app.post("/api/payment/sms-send", requireAuth, async (req, res) => {
  const { courseId, payment } = req.body || {};
  if (!courseId || !payment || !payment.method) return res.status(400).json({ error: "Заполните данные оплаты" });
  try {
    const [courses] = await pool.query("SELECT price FROM courses WHERE id = ?", [courseId]);
    if (!courses.length) return res.status(404).json({ error: "Курс не найден" });
    const price = Number(courses[0].price) || 0;
    if (price <= 0) return res.status(400).json({ error: "Курс бесплатный, оплата не требуется" });

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAtMs = Date.now() + 5 * 60 * 1000;
    await pool.query("DELETE FROM sms_codes WHERE expires_at_ms < ?", [Date.now()]);
    await pool.query("DELETE FROM sms_codes WHERE session_id = ?", [req.session.id]);
    await pool.query(
      "INSERT INTO sms_codes (session_id, code, course_id, price, method, card_last4, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [req.session.id, code, Number(courseId), price, payment.method, payment.cardLast4 || null, expiresAtMs]
    );
    // В реальном проекте здесь отправка SMS на телефон клиента.
    // Для демо код возвращается в ответе и показывается на экране.
    res.json({ demoCode: code });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Шаг 2: подтверждение SMS-кода и завершение оплаты
app.post("/api/payment/sms-confirm", requireAuth, async (req, res) => {
  const { courseId, code } = req.body || {};
  let entry;
  try {
    const [rows] = await pool.query("SELECT * FROM sms_codes WHERE session_id = ?", [req.session.id]);
    entry = rows[0];
  } catch (err) { return res.status(500).json({ error: err.message }); }
  if (!entry || Number(entry.course_id) !== Number(courseId)) {
    return res.status(400).json({ error: "Сначала запросите SMS-код" });
  }
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
    await conn.query(
      "INSERT INTO payments (user_id, course_id, amount, status, method, card_last4) VALUES (?, ?, ?, 'completed', ?, ?)",
      [req.session.user.id, entry.course_id, entry.price, entry.method, entry.card_last4]
    );
    await conn.query(
      "INSERT IGNORE INTO enrollments (user_id, course_id) VALUES (?, ?)",
      [req.session.user.id, entry.course_id]
    );
    await conn.query("DELETE FROM sms_codes WHERE id = ?", [entry.id]);
    await conn.commit();
    res.json({ success: true, paid: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

app.get("/api/admin/payments", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.id, p.amount, p.method, p.card_last4, p.created_at,
         c.title AS course_title, u.name AS user_name
       FROM payments p
       JOIN courses c ON p.course_id = c.id
       JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/payments/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM payments WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/my", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT c.id, c.title, c.price, c.instructor, c.image_url, e.progress, e.enrolled_at
       FROM enrollments e JOIN courses c ON e.course_id = c.id
       WHERE e.user_id = ? ORDER BY e.enrolled_at DESC`,
      [req.session.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/users/:id/role", requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!["user", "admin"].includes(role)) return res.status(400).json({ error: "Некорректная роль" });
  try {
    await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/categories", requireAdmin, async (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: "Название обязательно" });
  try {
    await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", [name, description || ""]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/categories/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM categories WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/admin/courses", requireAdmin, async (req, res) => {
  const { title, description, price, category_id, instructor, image_url } = req.body;
  if (!title) return res.status(400).json({ error: "Название обязательно" });
  try {
    const [result] = await pool.query(
      "INSERT INTO courses (title, description, price, category_id, instructor, image_url) VALUES (?, ?, ?, ?, ?, ?)",
      [title, description || "", price || 0, category_id || null, instructor || "", image_url || ""]
    );
    res.json({ success: true, id: result.insertId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  const { title, description, price, category_id, instructor, image_url } = req.body;
  if (!title) return res.status(400).json({ error: "Название обязательно" });
  try {
    await pool.query(
      "UPDATE courses SET title = ?, description = ?, price = ?, category_id = ?, instructor = ?, image_url = ? WHERE id = ?",
      [title, description || "", price || 0, category_id || null, instructor || "", image_url || "", req.params.id]
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/courses/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM courses WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/lessons/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM lessons WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete("/api/admin/media/:id", requireAdmin, async (req, res) => {
  try {
    await pool.query("DELETE FROM course_media WHERE id = ?", [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function seed() {
  const [count] = await pool.query("SELECT COUNT(*) AS c FROM courses");
  if (count[0].c > 0) return;
  const [cat1] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Программирование", "Языки программирования, веб-разработка и алгоритмы"]);
  const [cat2] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Финансы", "Инвестиции, трейдинг и личные финансы"]);
  const [cat3] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Дизайн", "UI/UX, графика и веб-дизайн"]);
  const [cat4] = await pool.query("INSERT INTO categories (name, description) VALUES (?, ?)", ["Маркетинг", "Digital-маркетинг, SEO и SMM"]);

  const base = [
    { c: cat1.insertId, t: "JavaScript с нуля", d: "Полный курс по JavaScript: от переменных до промисов и асинхронности.", p: 3490, i: "Иван Петров", img: "https://picsum.photos/seed/js/400/220" },
    { c: cat1.insertId, t: "Python для анализа данных", d: "Pandas, NumPy и визуализация данных на практике.", p: 4990, i: "Мария Смирнова", img: "https://picsum.photos/seed/py/400/220" },
    { c: cat2.insertId, t: "Инвестиции для начинающих", d: "Как составить портфель, читать графики и не терять деньги.", p: 2990, i: "Алексей Волков", img: "https://picsum.photos/seed/fin/400/220" },
    { c: cat3.insertId, t: "Основы UI/UX-дизайна", d: "Проектирование интерфейсов: сетки, типографика, прототипы.", p: 5490, i: "Анна Козлова", img: "https://picsum.photos/seed/ui/400/220" },
    { c: cat4.insertId, t: "SMM-маркетинг", d: "Продвижение в соцсетях: стратегия, контент, аналитика.", p: 2490, i: "Дмитрий Орлов", img: "https://picsum.photos/seed/smm/400/220" },
  ];
  for (const b of base) {
    await pool.query("INSERT INTO courses (category_id, title, description, price, instructor, image_url) VALUES (?, ?, ?, ?, ?, ?)", [b.c, b.t, b.d, b.p, b.i, b.img]);
  }
  const [allCourses] = await pool.query("SELECT id FROM courses");
  const lessonTitles = ["Введение", "Основы темы", "Практика", "Продвинутые техники", "Итоговый проект"];
  for (const course of allCourses) {
    for (let i = 0; i < lessonTitles.length; i++) {
      await pool.query(
        "INSERT INTO lessons (course_id, title, content, duration_min, position) VALUES (?, ?, ?, ?, ?)",
        [course.id, lessonTitles[i], `Урок ${i + 1} курса: подробный разбор темы «${lessonTitles[i]}» с практическими примерами.`, 20 + i * 15, i]
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
    "INSERT IGNORE INTO users (name, email, password_hash, role) VALUES (?, ?, ?, 'user')",
    ["Тестовый пользователь", "user@courses.ru", userHash]
  );
}

app.listen(PORT, async () => {
  try {
    await initSchema();
    await seed();
    console.log(`Сайт курсов запущен: http://localhost:${PORT}`);
    console.log("Админ: admin@courses.ru / admin123");
    console.log("Пользователь: user@courses.ru / user123");
  } catch (err) {
    console.error("Ошибка инициализации БД:", err.message);
  }
});

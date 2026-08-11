const mysql = require("mysql2/promise");

const pool = mysql.createPool({
  host: "localhost",
  user: "app",
  password: "app_password",
  database: "courses_db",
  waitForConnections: true,
  connectionLimit: 10,
  charset: "utf8mb4_unicode_ci",
});

async function initSchema() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(190) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        phone VARCHAR(30) NOT NULL DEFAULT '',
        role ENUM('user','admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [userCols] = await conn.query("SHOW COLUMNS FROM users");
    if (!userCols.map(c => c.Field).includes("phone")) {
      await conn.query("ALTER TABLE users ADD COLUMN phone VARCHAR(30) NOT NULL DEFAULT ''");
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        instructor VARCHAR(100),
        image_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS instructors (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        specialty VARCHAR(200) NOT NULL DEFAULT '',
        bio TEXT,
        experience VARCHAR(100) NOT NULL DEFAULT '',
        avatar VARCHAR(500) NOT NULL DEFAULT '',
        socials TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        content TEXT,
        duration_min INT DEFAULT 0,
        position INT DEFAULT 0,
        video_url VARCHAR(500) DEFAULT '',
        image_url VARCHAR(500) DEFAULT '',
        quiz TEXT,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS course_media (
        id INT AUTO_INCREMENT PRIMARY KEY,
        course_id INT NOT NULL,
        type ENUM('image','video','audio') NOT NULL DEFAULT 'image',
        url VARCHAR(500) NOT NULL,
        position INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [lessonCols] = await conn.query("SHOW COLUMNS FROM lessons");
    const lessonColNames = lessonCols.map(c => c.Field);
    if (!lessonColNames.includes("video_url")) {
      await conn.query("ALTER TABLE lessons ADD COLUMN video_url VARCHAR(500) DEFAULT ''");
    }
    if (!lessonColNames.includes("image_url")) {
      await conn.query("ALTER TABLE lessons ADD COLUMN image_url VARCHAR(500) DEFAULT ''");
    }
    if (!lessonColNames.includes("quiz")) {
      await conn.query("ALTER TABLE lessons ADD COLUMN quiz TEXT");
    }

    // Профили преподавателей: привязка курса к профилю (instructor_id).
    // При первом запуске создаёт профили из имён преподавателей, уже указанных в курсах.
    const [courseCols] = await conn.query("SHOW COLUMNS FROM courses");
    const courseColNames = courseCols.map(c => c.Field);
    if (!courseColNames.includes("instructor_id")) {
      await conn.query("ALTER TABLE courses ADD COLUMN instructor_id INT NULL");
      const [legacy] = await conn.query(
        "SELECT id, instructor FROM courses WHERE instructor IS NOT NULL AND instructor <> ''"
      );
      for (const c of legacy) {
        const [found] = await conn.query("SELECT id FROM instructors WHERE name = ?", [c.instructor]);
        if (found.length) {
          await conn.query("UPDATE courses SET instructor_id = ? WHERE id = ?", [found[0].id, c.id]);
        } else {
          const [ins] = await conn.query("INSERT INTO instructors (name) VALUES (?)", [c.instructor]);
          await conn.query("UPDATE courses SET instructor_id = ? WHERE id = ?", [ins.insertId, c.id]);
        }
      }
      await conn.query(
        "ALTER TABLE courses ADD CONSTRAINT fk_course_instructor FOREIGN KEY (instructor_id) REFERENCES instructors(id) ON DELETE SET NULL"
      );
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS enrollments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        progress INT NOT NULL DEFAULT 0,
        enrolled_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_course (user_id, course_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('completed') NOT NULL DEFAULT 'completed',
        method VARCHAR(50),
        card_last4 VARCHAR(4),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sms_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(190) NOT NULL,
        code VARCHAR(10) NOT NULL,
        course_id INT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        method VARCHAR(50),
        card_last4 VARCHAR(4),
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_session (session_id),
        KEY idx_expiry (expires_at_ms)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        course_id INT NOT NULL,
        rating TINYINT NOT NULL DEFAULT 5,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_review (user_id, course_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } finally {
    conn.release();
  }
}

module.exports = { pool, initSchema };

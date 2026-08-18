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
        avatar VARCHAR(500) NOT NULL DEFAULT '',
        role ENUM('user','admin') NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [userCols] = await conn.query("SHOW COLUMNS FROM users");
    if (!userCols.map(c => c.Field).includes("phone")) {
      await conn.query("ALTER TABLE users ADD COLUMN phone VARCHAR(30) NOT NULL DEFAULT ''");
    }
    if (!userCols.map(c => c.Field).includes("avatar")) {
      await conn.query("ALTER TABLE users ADD COLUMN avatar VARCHAR(500) NOT NULL DEFAULT ''");
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
        course_id INT NULL,
        item_type ENUM('course','product','service','consultation','order') NOT NULL DEFAULT 'course',
        item_title VARCHAR(200) NOT NULL DEFAULT '',
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('completed') NOT NULL DEFAULT 'completed',
        method VARCHAR(50),
        card_last4 VARCHAR(4),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Обобщение таблицы payments под все типы покупок (курсы, товары, услуги, консультации).
    // course_id становится общим item_id, привязка к courses убирается.
    const [payCols] = await conn.query("SHOW COLUMNS FROM payments");
    const payColNames = payCols.map(c => c.Field);
    if (!payColNames.includes("item_type")) {
      await conn.query(
        "ALTER TABLE payments ADD COLUMN item_type ENUM('course','product','service','consultation','order') NOT NULL DEFAULT 'course' AFTER course_id"
      );
    }
    if (!payColNames.includes("item_title")) {
      await conn.query("ALTER TABLE payments ADD COLUMN item_title VARCHAR(200) NOT NULL DEFAULT '' AFTER item_type");
    }
    const [payFk] = await conn.query(
      `SELECT constraint_name FROM information_schema.KEY_COLUMN_USAGE
       WHERE table_schema = DATABASE() AND table_name = 'payments' AND column_name = 'course_id' AND referenced_table_name IS NOT NULL`
    );
    const fkName = payFk[0] && (payFk[0].constraint_name || payFk[0].CONSTRAINT_NAME);
    if (fkName) {
      try {
        await conn.query(`ALTER TABLE payments DROP FOREIGN KEY ${fkName}`);
      } catch (e) {
        console.error("[db] Не удалось снять FK payments.course_id:", e.message);
      }
    }
    await conn.query("ALTER TABLE payments MODIFY course_id INT NULL");
    await conn.query(
      `UPDATE payments p LEFT JOIN courses c ON c.id = p.course_id
       SET p.item_title = COALESCE(c.title, CONCAT('Позиция #', p.course_id))
       WHERE p.item_title = ''`
    );

    await conn.query(`
      CREATE TABLE IF NOT EXISTS sms_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        session_id VARCHAR(190) NOT NULL,
        code VARCHAR(10) NOT NULL,
        course_id INT NOT NULL,
        item_type VARCHAR(20) NOT NULL DEFAULT 'course',
        price DECIMAL(10,2) NOT NULL,
        method VARCHAR(50),
        card_last4 VARCHAR(4),
        expires_at_ms BIGINT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_session (session_id),
        KEY idx_expiry (expires_at_ms)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const [smsCols] = await conn.query("SHOW COLUMNS FROM sms_codes");
    if (!smsCols.map(c => c.Field).includes("item_type")) {
      await conn.query("ALTER TABLE sms_codes ADD COLUMN item_type VARCHAR(20) NOT NULL DEFAULT 'course' AFTER course_id");
    }

    // Записи на услуги и консультации
    await conn.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        item_type ENUM('service','consultation') NOT NULL,
        item_id INT NOT NULL,
        title VARCHAR(200) NOT NULL,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        method VARCHAR(50) NOT NULL DEFAULT '',
        status ENUM('new','paid','cancelled') NOT NULL DEFAULT 'new',
        booking_date VARCHAR(20) NOT NULL DEFAULT '',
        booking_time VARCHAR(20) NOT NULL DEFAULT '',
        note VARCHAR(500) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

    // Разделы главной страницы: товары, услуги, консультации, отзывы
    await conn.query(`
      CREATE TABLE IF NOT EXISTS products (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        image_url VARCHAR(500) NOT NULL DEFAULT '',
        category VARCHAR(100) NOT NULL DEFAULT '',
        in_stock TINYINT NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS services (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        duration_min INT NOT NULL DEFAULT 0,
        icon VARCHAR(10) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS consultations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        duration_min INT NOT NULL DEFAULT 0,
        expert VARCHAR(100) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS site_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        author VARCHAR(100) NOT NULL,
        role VARCHAR(100) NOT NULL DEFAULT '',
        rating TINYINT NOT NULL DEFAULT 5,
        text TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS consultation_requests (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(30) NOT NULL DEFAULT '',
        subject VARCHAR(200) NOT NULL DEFAULT '',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Заказы товаров из корзины
    await conn.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NULL,
        name VARCHAR(100) NOT NULL,
        phone VARCHAR(30) NOT NULL DEFAULT '',
        address VARCHAR(300) NOT NULL DEFAULT '',
        comment TEXT,
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        items TEXT,
        status VARCHAR(50) NOT NULL DEFAULT 'new',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Счётчик просмотров курса
    const [courseCols2] = await conn.query("SHOW COLUMNS FROM courses");
    if (!courseCols2.map(c => c.Field).includes("views")) {
      await conn.query("ALTER TABLE courses ADD COLUMN views INT NOT NULL DEFAULT 0");
    }

    // Детальные страницы разделов: галереи изображений и отзывы
    await conn.query(`
      CREATE TABLE IF NOT EXISTS item_images (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_type ENUM('product','service','consultation') NOT NULL,
        item_id INT NOT NULL,
        url VARCHAR(500) NOT NULL,
        position INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        KEY idx_item (item_type, item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS item_reviews (
        id INT AUTO_INCREMENT PRIMARY KEY,
        item_type ENUM('product','service','consultation') NOT NULL,
        item_id INT NOT NULL,
        user_id INT NULL,
        author VARCHAR(100) NOT NULL,
        rating TINYINT NOT NULL DEFAULT 5,
        comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_user_item (user_id, item_type, item_id),
        KEY idx_item (item_type, item_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Специалисты и изображения для услуг и консультаций
    for (const table of ["services", "consultations"]) {
      const [cols] = await conn.query(`SHOW COLUMNS FROM ${table}`);
      const names = cols.map(c => c.Field);
      if (!names.includes("instructor_id")) {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN instructor_id INT NULL`);
      }
      if (!names.includes("image_url")) {
        await conn.query(`ALTER TABLE ${table} ADD COLUMN image_url VARCHAR(500) NOT NULL DEFAULT ''`);
      }
    }

    // Глобальные настройки сайта (ссылки на мессенджеры, телефон, email)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS site_config (
        cfg_key VARCHAR(100) NOT NULL PRIMARY KEY,
        cfg_value TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } finally {
    conn.release();
  }
}

module.exports = { pool, initSchema };

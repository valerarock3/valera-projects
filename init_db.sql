CREATE DATABASE IF NOT EXISTS courses_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'app'@'localhost' IDENTIFIED BY 'app_password';
GRANT ALL PRIVILEGES ON courses_db.* TO 'app'@'localhost';
FLUSH PRIVILEGES;

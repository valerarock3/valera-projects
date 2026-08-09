# 🚀 Развёртывание проекта на другом устройстве

В репозитории два приложения:

| Приложение | Каталог | Порт | Нужна БД |
|------------|---------|------|----------|
| 📈 Финансовый дашборд (Yahoo Finance) | корень (`server.js`) | 3000 | нет (`data.json`) |
| 🎓 Платформа онлайн-курсов | `courses-site/` | 3001 | MySQL |

---

## 1. Требования

- **Git** — [git-scm.com](https://git-scm.com/downloads)
- **Node.js 18+** (вместе с npm) — [nodejs.org](https://nodejs.org)
- **MySQL 8.4** — [dev.mysql.com](https://dev.mysql.com/downloads/installer/) (только для сайта курсов)

Проверка после установки:

```powershell
git --version
node --version
npm --version
mysql --version
```

---

## 2. Скачать код

```powershell
git clone https://github.com/valerarock3/valera-projects.git
cd valera-projects
```

Дальше `node_modules` уже в репозитории, но для надёжности лучше переустановить зависимости (см. шаги 3–4).

---

## 3. Дашборд (порт 3000) — без БД

```powershell
cd valera-projects
npm install
node server.js
# или: npm start
```

Открыть: **http://localhost:3000**

- Работает сразу, база данных не нужна — состояние хранится в `data.json`.
- Для курсов/валют нужен интернет (запросы к Yahoo Finance).
- При необходимости поменяйте список символов (`STOCK_SYMBOLS`, `CRYPTO_SYMBOLS`) в `server.js`.

---

## 4. Сайт курсов (порт 3001) — нужен MySQL

### 4.1. Установите и запустите MySQL

- **Windows:** установите MySQL Server 8.4 инсталлятором и запустите службу (сервис обычно стартует сам).
- **Linux:** `sudo apt install mysql-server` → `sudo systemctl enable --now mysql`
- **macOS:** `brew install mysql` → `brew services start mysql`

### 4.2. Создайте базу и пользователя

```powershell
# путь в Windows может отличаться; в консоли MySQL (root) выполните:
mysql -u root -p
```

```sql
CREATE DATABASE courses_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'app'@'localhost' IDENTIFIED BY 'app_password';
GRANT ALL PRIVILEGES ON courses_db.* TO 'app'@'localhost';
FLUSH PRIVILEGES;
```

Если хотите другие логин/пароль — поправьте их и в SQL выше, и в `courses-site/db.js` (строки 4–7).

### 4.3. Запустите сервер

```powershell
cd courses-site
npm install
node server.js
```

Открыть: **http://localhost:3001**

**Всё создастся автоматически при первом запуске:**
- все таблицы БД (`initSchema()` в `db.js`);
- 4 категории, 5 демо-курсов с уроками (`seed()` в `server.js`);
- админ и тестовый пользователь.

### 4.4. Учётные записи (создаются сами)

| Роль | Email | Пароль |
|------|-------|--------|
| Админ | admin@courses.ru | admin123 |
| Пользователь | user@courses.ru | user123 |

---

## 5. phpMyAdmin (по желанию)

Код phpMyAdmin лежит в `courses-site/phpmyadmin/` и требует PHP:

```powershell
cd courses-site/phpmyadmin
php -S 127.0.0.1:8080
```

Открыть: **http://127.0.0.1:8080** → вход `app` / `app_password`.

---

## 6. Что НЕ переносить со старой машины

- **`mysql-data/`** из репозитория — это снимок рабочей папки MySQL конкретной машины. На новом устройстве он может не запуститься. Правильный путь — создать пустую БД и дать серверу `initSchema()`/`seed()` создать всё заново (шаг 4.2–4.3).
- Если нужны именно **данные со старой БД** (пользователи, оплаты, записи), сделайте дамп и импортируйте его:

```powershell
mysqldump -u app -papp_password courses_db > dump.sql
# на новой машине:
mysql -u app -papp_password courses_db < dump.sql
```

- Файлы в `courses-site/public/uploads/` — загруженные медиа (картинки/видео уроков). Если нужны — скопируйте папку вручную.

---

## 7. Частые проблемы

| Симптом | Решение |
|---------|---------|
| `ERROR 2003 Can't connect to MySQL server` | MySQL не запущен (запустите службу) или порт/хост неверный в `db.js` |
| `Unknown database 'courses_db'` | Не выполнен SQL из п. 4.2 (создание БД) |
| `Access denied for user 'app'` | Проверьте логин/пароль в `db.js` и `GRANT` из п. 4.2 |
| `EPERM` / не стартует mysqld на Windows | Путь проекта **не должен содержать кириллицу** — разверните в `C:\projects\valera-projects` и т.п. |
| Порт 3000/3001 занят | Закройте старый процесс или поменяйте порт: в `server.js` константа `PORT` |
| Дашборд не показывает котировки | Нет интернета или недоступен Yahoo Finance (подождите и обновите) |

---

## 8. Запуск одним скриптом (Windows)

Оба сервера можно стартовать параллельно:

```powershell
# вкладка 1 — дашборд
cd valera-projects
node server.js

# вкладка 2 — сайт курсов (MySQL должен быть запущен)
cd valera-projects\courses-site
node server.js
```

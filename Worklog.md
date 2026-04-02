# Worklog — JT-Zero Claude Sessions

> Цей файл веде Claude (remote `claude` → `iigar/JT_Zero_Core_Claude`).
> Кожна сесія — окремий розділ з датою, описом змін, причинами та файлами.
> **Читати обов'язково на початку кожної сесії**, щоб розуміти стан проєкту.

---

## Сесія 2026-04-02 — Аудит безпеки бекенду + Frontend дизайн

### 1. Аудит GitHub репо та виправлення 10 проблем безпеки/надійності

**Мета:** провести аудит `origin` гілки `main22`, виправити критичні проблеми.

#### `backend/flight_log.py`

| # | Проблема | Що зроблено | Чому |
|---|----------|-------------|------|
| 1 | Фіксована сіль `SALT = b"jtzero-flight-log-v1"` | Замінено на `_get_or_create_salt()` — 16 байт `secrets.token_bytes()`, зберігається в `config.json` | Фіксована сіль робить PBKDF2 детермінованим — attacker з rainbow table зламає за секунди |
| 2 | PBKDF2 викликався на кожний запис у лог | Ключ виводиться один раз при `start_log`, зберігається в `_key`; `_encrypt_data_with_key()` використовує готовий ключ | Кожен запис займав ~100ms на Pi Zero через 100k ітерацій |
| 3 | `except Exception: return []` при помилці дешифрування | `except InvalidToken: return None`; caller розрізняє "неправильний пароль" vs "порожній файл" | Загальний except ковтав реальні помилки та приховував corruption |
| 4 | Path traversal у `read_session()` | `os.path.realpath()` порівняння з базовою директорією | `../../etc/passwd` в імені сесії давав read за межами дозволеної директорії |
| 5 | `_write_failed` не виставлявся при помилці запису | При IOError: `_running=False`, файл закривається, `_write_failed=True` | Без цього лог продовжував "записувати" в закритий fd мовчки |
| 6 | `psutil` імпортувався безумовно | Module-level `try/except ImportError` → `_PSUTIL_AVAILABLE` flag | `psutil` не встановлений у базовому venv; безумовний імпорт ламає старт |

#### `backend/server.py`

| # | Проблема | Що зроблено | Чому |
|---|----------|-------------|------|
| 7 | CORS `allow_origins=["*"]` | `allow_origins=_ALLOWED_ORIGINS` з env `JTZERO_ALLOWED_ORIGINS` (default: localhost:3000, localhost:8001, jtzero.local:8001); `allow_credentials=False`; методи обмежено до GET/POST | Wildcard CORS + credentials = будь-який сайт може читати телеметрію дрону |
| 8 | Мінімальна довжина пароля 6 символів | Змінено на 12 | 6 символів — брутфорс за хвилини на Pi Zero |
| 9 | WebSocket exceptions мовчки ковталися | `except Exception as e: sys.stderr.write(f"[WS/...] {e}")` | Без логування impossible діагностувати обриви зв'язку |
| 10 | `read_session` повертав `{"error":"Wrong password"}` навіть при порожньому файлі | `if records is None → "Wrong password"`, `if not records → "Corrupted or empty file"` | Оператор бачив одне і те ж повідомлення при двох різних причинах |

#### `backend/native_bridge.py`

| # | Проблема | Що зроблено | Чому |
|---|----------|-------------|------|
| 11 | `import numpy as np` з fallback гілкою | Замінено на `NUMPY_AVAILABLE = False` + видалено всю numpy-гілку | CLAUDE.md правило 5: numpy заборонений на Pi Zero; fallback все одно не використовувався |

**⚠ Breaking change:** новий рандомний salt робить старі `.jtzlog` файли та паролі недійсними.
Після деплою треба скинути пароль через `POST /api/logs/password`.

---

### 2. Git інфраструктура — два remote

**Мета:** відокремити роботу Claude від комітів Emergent AI.

- Додано remote `claude` → `https://github.com/iigar/JT_Zero_Core_Claude.git`
- Remote `origin` → `https://github.com/iigar/JT_Zero_Core.git` (Emergent, не чіпати)
- Перший push з `--force` (GitHub auto-створив README)

**Правило:** Claude пушить ТІЛЬКИ в `claude`. Ніколи в `origin`.

---

### 3. Skill `/push-claude`

**Файл:** `C:/Users/vlase/.claude/skills/push-claude/SKILL.md`

Skill для коміту та пушу змін у `claude` remote. Викликається командою `push-claude` або `/push-claude`.

---

### 4. Frontend дизайн — "Orbital Command / Cyberpunk Terminal / Glass Cockpit"

**Мета:** підсилити візуальну атмосферу дашборду без зміни логіки.

#### `frontend/src/index.css`

| Зміна | Причина |
|-------|---------|
| CSS custom properties (`--cyan`, `--void`, `--cyan-glow` і т.д.) | Централізувати кольори, уникнути дублювання hex по всьому CSS |
| `.hud-lines` — сітка 48×48px з rgba(0,240,255,0.025) | Cockpit HUD texture без перевантаження темного фону |
| `.sweep-overlay::after` — анімований сканер 12s цикл | Cyberpunk "radar sweep" — система виглядає живою і активною |
| `.panel-glass` — переписано: `overflow:hidden` + gradient sheen | `overflow:hidden` фіксує corner decorations; sheen дає скляний ефект |
| `.readout` — Share Tech Mono + tabular-nums | Числові значення (°C, V, Гц) виглядають як авіоніка |
| `.cursor-blink::after` — термінальний курсор ▋ | Термінальна естетика для заголовків |
| `.status-live::after` — пульсуюче кільце | "Живий" сигнал потребує анімованого feedback |
| `.emergency-flash` — мигання фону при EMERGENCY | Критичні стани мають захоплювати увагу периферійним зором |
| `.battery-bar` / `.battery-bar-fill` — горизонтальний meter | Вертикальна смужка 1.5×3px не передавала рівень; fill-width читається миттєво |
| `.panel-accent-top::after` — cyan лінія по верху панелі | Mil-spec стиль приладових панелей |
| `body::after` — vignette radial-gradient | Фокусує погляд на центрі, приховує краї сітки |
| Google Font: `Share Tech Mono` import | Шрифт для числових readout-значень |

#### `frontend/src/components/Header.js`

| Зміна | Причина |
|-------|---------|
| Висота фіксована `42px` через style | `py-2.5` давав непостійну висоту; фіксована гарантує стабільний layout |
| Верхня accent лінія (gradient fade cyan) | Відокремлює header від фону без жорсткого border |
| Логотип "JT-ZERO" на Share Tech Mono + textShadow glow | JetBrains Mono виглядав як звичайний UI; Share Tech Mono + glow = позивний |
| Zap іконка: `drop-shadow` filter (не box-shadow) | box-shadow не працює на SVG; drop-shadow огортає форму іконки |
| Горизонтальний battery-bar + fill + окремий рядок V/% | Оператор має бачити заряд одним поглядом; fill-width + колір читається без цифр |
| `BATTERY_COLOR` helper: text/fill/glow для кожного стану | 3 різних CSS-властивості потребують різних форматів кольору |
| `emergency-flash` на `<header>` при EMERGENCY | Весь header мигає — неможливо пропустити |

#### `frontend/src/App.js`

| Зміна | Причина |
|-------|---------|
| `hud-lines sweep-overlay` на root div | Підключити фонову сітку та sweep до всього екрану |
| `textShadow` glow на активному табі | Підкреслити активний таб без зміни layout |

---

## Відкриті задачі (не розпочато)

| Пріоритет | Задача |
|-----------|--------|
| HIGH | C++ thread safety: data race на SystemState (8 потоків без mutex) |
| HIGH | C++ MemoryPool::allocate() race condition |
| MED | Repo hygiene: прибрати `.gitconfig`, `*.so`, `jt-zero/build/` з git tracking |
| LOW | Pi deploy: після нового salt скинути пароль через `/api/logs/password` |

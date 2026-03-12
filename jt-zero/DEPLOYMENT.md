# JT-Zero — Повна інструкція встановлення на Raspberry Pi

## Що потрібно

- **Raspberry Pi Zero 2 W** (або Pi 3B+, Pi 4, Pi 5 — теж підходять)
- **SD-карта** мінімум 8 ГБ (рекомендовано 16+ ГБ)
- **Живлення** — micro-USB кабель + блок живлення 5V 2.5A
- **Комп'ютер** з Wi-Fi у тій самій мережі (для підключення до Dashboard)
- **Опціонально:** сенсори (MPU6050, BMP280, GPS), камера Pi Camera v2

---

## Етап 1: Підготовка SD-карти

### 1.1. Завантажте Raspberry Pi Imager

Перейдіть на сайт і завантажте програму для вашої ОС (Windows / Mac / Linux):

```
https://www.raspberrypi.com/software/
```

Встановіть і запустіть.

### 1.2. Налаштуйте образ

1. Натисніть **"Choose Device"** → виберіть **"Raspberry Pi Zero 2 W"**
2. Натисніть **"Choose OS"** → виберіть **"Raspberry Pi OS (other)"** → **"Raspberry Pi OS Lite (64-bit)"**
   - Це версія без графічного інтерфейсу — легша і швидша
3. Натисніть **"Choose Storage"** → виберіть вашу SD-карту

### 1.3. Налаштуйте доступ (ВАЖЛИВО)

Натисніть іконку **шестерні** (або Ctrl+Shift+X) і задайте:

- **Hostname:** `jtzero`
- **Enable SSH:** ✅ увімкнено, "Use password authentication"
- **Username:** `pi`
- **Password:** ваш пароль (запам'ятайте його!)
- **Wi-Fi SSID:** назва вашої Wi-Fi мережі
- **Wi-Fi Password:** пароль від Wi-Fi
- **Wi-Fi Country:** UA (Україна)

Натисніть **"Save"**, потім **"Write"**.

### 1.4. Вставте SD-карту в Pi і увімкніть живлення

Зачекайте 1-2 хвилини поки Pi завантажиться і підключиться до Wi-Fi.

---

## Етап 2: Підключення до Pi через SSH

### 2.1. Відкрийте термінал

- **Windows:** відкрийте PowerShell (пошук → "PowerShell")
- **Mac/Linux:** відкрийте Terminal

### 2.2. Підключіться до Pi

Введіть команду:

```bash
ssh pi@jtzero.local
```

Система запитає пароль — введіть той, що задали в Imager.

**Якщо `jtzero.local` не працює:**
- Зайдіть у роутер (зазвичай `192.168.1.1` у браузері) і знайдіть IP-адресу пристрою `jtzero`
- Підключіться: `ssh pi@192.168.1.XX` (замініть XX на реальну адресу)

**Якщо все добре — побачите:**
```
pi@jtzero:~ $
```

Це означає: ви всередині Pi і можете вводити команди.

---

## Етап 3: Увімкнення інтерфейсів сенсорів

Цей крок потрібен для апаратних сенсорів (IMU, барометр, GPS). Якщо сенсорів поки немає — все одно зробіть, щоб потім не повертатися.

```bash
sudo raspi-config
```

Відкриється меню. Навігація: стрілками вгору/вниз, Enter — вибрати, Tab — перемикання між кнопками.

1. Виберіть **"Interface Options"** → **"I2C"** → **"Yes"** → **"OK"**
2. Виберіть **"Interface Options"** → **"SPI"** → **"Yes"** → **"OK"**
3. Виберіть **"Interface Options"** → **"Serial Port"**:
   - "Would you like a login shell?" → **"No"**
   - "Would you like the serial hardware enabled?" → **"Yes"** → **"OK"**
4. Виберіть **"Finish"** → **"Yes"** (перезавантажити)

Pi перезавантажиться. Зачекайте хвилину і підключіться знову:

```bash
ssh pi@jtzero.local
```

---

## Етап 4: Встановлення залежностей

Ці команди встановлять програми потрібні для збірки і роботи JT-Zero.

```bash
sudo apt update && sudo apt install -y cmake g++ python3-dev python3-pip python3-venv pybind11-dev libatomic1 i2c-tools git
```

**Що встановлюється:**
- `cmake`, `g++` — компілятор C++ та система збірки
- `python3-dev`, `python3-pip`, `python3-venv` — Python та інструменти
- `pybind11-dev` — бібліотека для з'єднання C++ з Python
- `libatomic1` — бібліотека для lock-free операцій (потрібна рантайму)
- `i2c-tools` — утиліти для перевірки сенсорів
- `git` — для завантаження коду з GitHub

Це займе 2-5 хвилин.

---

## Етап 5: Перевірка сенсорів (опціонально)

Якщо у вас підключені сенсори (MPU6050, BMP280), перевірте що Pi їх бачить:

```bash
sudo i2cdetect -y 1
```

**Що маєте побачити (якщо сенсори підключені):**
```
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
...
60: -- -- -- -- -- -- -- -- 68 -- -- -- -- -- -- --
70: -- -- -- -- -- -- 76 -- -- -- -- -- -- -- -- --
```

- `68` = MPU6050 (IMU/гіроскоп)
- `76` = BMP280 (барометр)

**Якщо сенсорів немає** — таблиця буде порожня. Це нормально — JT-Zero автоматично використає симуляцію.

---

## Етап 6: Завантаження проєкту

```bash
git clone https://github.com/iigar/JT_Zero_Core.git ~/jt-zero
```

**Що робить:** завантажує весь проєкт з GitHub у папку `~/jt-zero` на Pi.

---

## Етап 7: Збірка C++ рантайму

### 7.1. Виправити відому помилку компілятора

GCC 14 (який стоїть на новому Pi OS) суворіший до коду. Потрібно додати один рядок:

```bash
sed -i '10a #include <cstdlib>' ~/jt-zero/jt-zero/main.cpp
```

### 7.2. Зібрати

```bash
cd ~/jt-zero/jt-zero
rm -rf build
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
```

**Що робить кожна команда:**
1. Переходить у папку з C++ кодом
2. Видаляє стару папку збірки (якщо є)
3. Створює нову папку збірки
4. Переходить у неї
5. `cmake` — аналізує проєкт і генерує інструкції для компілятора
6. `make -j4` — компілює код використовуючи всі 4 ядра Pi

**Збірка займає 5-10 хвилин.** Під час збірки можуть з'явитися жовті `warning` — це нормально. Головне — немає червоних `error`.

**Якщо все добре, останній рядок:**
```
[100%] Built target jt-zero
```

---

## Етап 8: Налаштування Python-сервера

### 8.1. Скопіювати C++ модуль у backend

```bash
cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/
```

### 8.2. Створити Python-середовище та встановити бібліотеки

```bash
cd ~/jt-zero/backend
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn websockets
```

### 8.3. Перевірити що C++ модуль працює

```bash
python3 -c "import jtzero_native; print('OK')"
```

**Якщо побачите `OK`** — C++ рантайм підключений, сервер використовуватиме швидкий нативний код.

**Якщо помилка** — не страшно, сервер автоматично переключиться на Python-симулятор.

---

## Етап 9: Перший запуск (тест)

```bash
cd ~/jt-zero/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8001
```

**Що маєте побачити:**
```
[JT-Zero API] Using NATIVE C++ runtime (GCC GCC 14.2)
[JT-Zero] All threads started (7 threads)
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
```

### Перевірка у браузері

На вашому комп'ютері (не на Pi) відкрийте:

```
http://jtzero.local:8001
```

Або якщо не працює — дізнайтесь IP Pi:
```bash
# На Pi (в іншому вікні SSH):
hostname -I
```

І відкрийте: `http://<IP_АДРЕСА>:8001`

**Маєте побачити:** Dashboard з 3D дроном, графіками телеметрії, вкладками.

### Зупинити тестовий запуск

Натисніть **Ctrl+C** у терміналі де запущено сервер.

---

## Етап 10: Автозапуск (systemd)

Щоб JT-Zero запускався автоматично при кожному включенні Pi.

### 10.1. Створити файл сервісу

Скопіюйте цю команду **повністю** і вставте:

```bash
sudo tee /etc/systemd/system/jtzero.service << 'EOF'
[Unit]
Description=JT-Zero Runtime
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/jt-zero/backend
Environment=PYTHONPATH=/home/pi/jt-zero
ExecStart=/home/pi/jt-zero/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

### 10.2. Увімкнути та запустити

```bash
sudo systemctl daemon-reload
sudo systemctl enable jtzero
sudo systemctl start jtzero
```

### 10.3. Перевірити

```bash
sudo systemctl status jtzero
```

**Маєте побачити зелений текст `active (running)`.**

Натисніть **`q`** щоб вийти з цього екрану.

---

## Етап 11: Підключення сенсорів (GPIO)

### Схема підключення (3.3V логіка!)

```
  Pi Zero 2 W GPIO Header
  ─────────────────────────
  3V3  (1) (2)  5V
  SDA  (3) (4)  5V        ← I2C: MPU6050 + BMP280 (дані)
  SCL  (5) (6)  GND       ← I2C: MPU6050 + BMP280 (тактування)
  GP4  (7) (8)  TX (UART) ← GPS модуль: RX
  GND  (9) (10) RX (UART) ← GPS модуль: TX
```

### MPU6050 (IMU — гіроскоп + акселерометр)

| MPU6050 пін | Pi пін | Опис |
|---|---|---|
| VCC | Pin 1 (3.3V) | Живлення |
| GND | Pin 6 (GND) | Земля |
| SDA | Pin 3 (GPIO 2) | Дані I2C |
| SCL | Pin 5 (GPIO 3) | Тактування I2C |

### BMP280 (барометр — висота + температура)

| BMP280 пін | Pi пін | Опис |
|---|---|---|
| VCC | Pin 1 (3.3V) | Живлення |
| GND | Pin 9 (GND) | Земля |
| SDA | Pin 3 (GPIO 2) | Дані I2C (спільний з MPU6050) |
| SCL | Pin 5 (GPIO 3) | Тактування I2C (спільний з MPU6050) |

### GPS модуль (NMEA через UART)

| GPS пін | Pi пін | Опис |
|---|---|---|
| VCC | Pin 1 (3.3V) | Живлення |
| GND | Pin 6 (GND) | Земля |
| TX | Pin 10 (GPIO 15, RX) | GPS передає → Pi приймає |
| RX | Pin 8 (GPIO 14, TX) | Pi передає → GPS приймає |

**ВАЖЛИВО:** I2C сенсори (MPU6050, BMP280) підключаються до ОДНИХ і тих самих пінів SDA/SCL — вони розділяють шину.

---

## Корисні команди

| Що зробити | Команда |
|---|---|
| Статус сервера | `sudo systemctl status jtzero` |
| Зупинити | `sudo systemctl stop jtzero` |
| Запустити | `sudo systemctl start jtzero` |
| Перезапустити | `sudo systemctl restart jtzero` |
| Логи в реальному часі | `journalctl -u jtzero -f` |
| Перевірити I2C сенсори | `sudo i2cdetect -y 1` |
| Перевірити API | `curl http://localhost:8001/api/health` |
| IP адреса Pi | `hostname -I` |

---

## Оновлення проєкту

Коли в Emergent зроблені зміни і збережені на GitHub:

```bash
cd ~/jt-zero
git pull
cd jt-zero/build
make -j4
cp jtzero_native*.so ~/jt-zero/backend/
sudo systemctl restart jtzero
```

---

## Мінімальна конфігурація (без зовнішніх сенсорів)

JT-Zero працює і без зовнішніх сенсорів:

- **Pi Zero 2 W** + **камера** + **UART до польотного контролера** — цього достатньо
- Всі відсутні сенсори автоматично переходять у режим симуляції
- Камера (Pi Camera v2 або USB) забезпечує Visual Odometry
- MAVLink через UART відправляє дані на польотний контролер

Зовнішній IMU (MPU6050) потрібен тільки якщо хочете незалежний AHRS на companion computer.

---

## Вирішення проблем

### "Cannot connect to jtzero.local"
- Перевірте що Pi і комп'ютер в одній Wi-Fi мережі
- Спробуйте IP адресу замість jtzero.local
- На Pi: `hostname -I` покаже IP

### "{"detail":"Not Found"}" у браузері
- Dashboard (папка `static/`) не скопійована в backend
- Оновіть код: `cd ~/jt-zero && git pull && sudo systemctl restart jtzero`

### Сервер не запускається
- Перевірте логи: `journalctl -u jtzero -n 50`
- Перевірте що venv існує: `ls ~/jt-zero/backend/venv/bin/uvicorn`

### Збірка C++ падає з помилкою
- Перевірте що всі залежності встановлені (Етап 4)
- Спробуйте чисту збірку: `cd ~/jt-zero/jt-zero && rm -rf build && mkdir build && cd build && cmake .. && make -j4`

# JT-Zero — Повна інструкція встановлення на Raspberry Pi

Ця інструкція написана для початківців. Вона покриває ВСЕ: від чистого Pi до працюючої системи. Навіть якщо ви ніколи не працювали з Linux чи Raspberry Pi — просто виконуйте команди по порядку.

**Два способи встановлення:**
- **Спосіб А:** Через інтернет (GitHub) — якщо Pi підключений до Wi-Fi
- **Спосіб Б:** Без інтернету (архів) — якщо інтернету немає або не хочете використовувати GitHub

---

## Що потрібно

| Компонент | Обов'язково? | Опис |
|-----------|-------------|------|
| Raspberry Pi Zero 2 W | Так | Або Pi 3B+, Pi 4, Pi 5 |
| SD-карта 8+ ГБ | Так | Рекомендовано 16 ГБ |
| Кабель micro-USB + блок живлення 5V 2.5A | Так | Для живлення Pi |
| Комп'ютер у тій самій Wi-Fi мережі | Так | Для підключення до Dashboard |
| Pi Camera v2 | Рекомендовано | CSI камера для Visual Odometry |
| Польотний контролер (ArduPilot 4.3+) | Рекомендовано | Matek H743, Pixhawk, etc. |

---

## Етап 1: Підготовка SD-карти

### 1.1. Завантажте Raspberry Pi Imager

На вашому комп'ютері (Windows / Mac / Linux) перейдіть на сайт:

```
https://www.raspberrypi.com/software/
```

Завантажте та встановіть програму.

### 1.2. Запишіть образ ОС

1. Запустіть Raspberry Pi Imager
2. **"Choose Device"** → виберіть **"Raspberry Pi Zero 2 W"**
3. **"Choose OS"** → **"Raspberry Pi OS (other)"** → **"Raspberry Pi OS Lite (64-bit)"**
   - Lite = без графічного інтерфейсу, швидша та легша
4. **"Choose Storage"** → виберіть вашу SD-карту

### 1.3. Налаштуйте доступ (ДУЖЕ ВАЖЛИВО!)

Натисніть **іконку шестерні** (або Ctrl+Shift+X):

| Налаштування | Значення |
|-------------|----------|
| Hostname | `jtzero` |
| Enable SSH | Так, "Use password authentication" |
| Username | `pi` |
| Password | ваш пароль (запам'ятайте!) |
| Wi-Fi SSID | назва вашої Wi-Fi мережі |
| Wi-Fi Password | пароль від Wi-Fi |
| Wi-Fi Country | UA |

Натисніть **"Save"**, потім **"Write"**. Зачекайте поки запишеться.

### 1.4. Вставте SD-карту в Pi і увімкніть живлення

Зачекайте 1-2 хвилини — Pi завантажиться і підключиться до Wi-Fi.

---

## Етап 2: Підключення до Pi через SSH

### На Windows:
Відкрийте **PowerShell** (пошук → "PowerShell")

### На Mac / Linux:
Відкрийте **Terminal**

### Підключіться:

```bash
ssh pi@jtzero.local
```

Введіть пароль, який задали в Imager.

**Якщо `jtzero.local` не працює:**
- Зайдіть у роутер (зазвичай `192.168.1.1` у браузері)
- Знайдіть пристрій `jtzero` і його IP-адресу
- Підключіться: `ssh pi@192.168.1.XX`

**Якщо побачите `pi@jtzero:~ $`** — ви всередині Pi!

---

## Етап 3: Увімкнення інтерфейсів

Навіть якщо сенсорів ще немає — зробіть цей крок зараз.

```bash
sudo raspi-config
```

Навігація: стрілки вгору/вниз, Enter — вибрати, Tab — переключити кнопки.

1. **"Interface Options"** → **"I2C"** → **"Yes"** → **"OK"**
2. **"Interface Options"** → **"SPI"** → **"Yes"** → **"OK"**
3. **"Interface Options"** → **"Serial Port"**:
   - "Would you like a login shell?" → **"No"**
   - "Would you like the serial hardware enabled?" → **"Yes"**
4. **"Finish"** → **"Yes"** (перезавантажити)

Зачекайте хвилину і підключіться знову:
```bash
ssh pi@jtzero.local
```

---

## Етап 4: Встановлення системних пакетів

```bash
sudo apt update && sudo apt install -y \
  cmake g++ python3-dev python3-pip python3-venv pybind11-dev \
  libatomic1 i2c-tools unzip
```

**Що це:**
| Пакет | Для чого |
|-------|----------|
| `cmake`, `g++` | Компілятор C++ та система збірки |
| `python3-dev`, `python3-pip`, `python3-venv` | Python та пакетний менеджер |
| `pybind11-dev` | З'єднання C++ з Python |
| `libatomic1` | Lock-free операції в C++ ядрі |
| `i2c-tools` | Перевірка I2C сенсорів |
| `unzip` | Розпакування архівів |

Це займе 2-5 хвилин.

---

## Етап 5: Завантаження проєкту

### ─── Спосіб А: Через GitHub (потрібен інтернет на Pi) ───

```bash
sudo apt install -y git
git clone https://github.com/iigar/JT_Zero_Core.git ~/jt-zero
```

Готово! Переходьте до Етапу 6.

---

### ─── Спосіб Б: Без GitHub (офлайн, через архів) ───

Цей спосіб працює навіть якщо на Pi НЕМАЄ інтернету. Вам потрібен комп'ютер з інтернетом для скачування файлів.

#### Крок Б.1: Скачайте архів на ваш комп'ютер

Відкрийте у браузері на вашому комп'ютері:

```
https://github.com/iigar/JT_Zero_Core/archive/refs/heads/main.zip
```

Або: зайдіть на сторінку GitHub проєкту → зелена кнопка **"Code"** → **"Download ZIP"**.

Файл `JT_Zero_Core-main.zip` збережеться у папку "Завантаження" (Downloads).

#### Крок Б.2: Скопіюйте архів на Pi

Відкрийте **новий** термінал на вашому комп'ютері (НЕ SSH до Pi, а локальний).

**Windows (PowerShell):**
```powershell
scp $env:USERPROFILE\Downloads\JT_Zero_Core-main.zip pi@jtzero.local:~/
```

**Mac:**
```bash
scp ~/Downloads/JT_Zero_Core-main.zip pi@jtzero.local:~/
```

**Linux:**
```bash
scp ~/Downloads/JT_Zero_Core-main.zip pi@jtzero.local:~/
```

Система запитає пароль Pi — введіть його. Файл скопіюється на Pi.

#### Крок Б.3: Розпакуйте на Pi

Поверніться до SSH-терміналу Pi:

```bash
cd ~
unzip JT_Zero_Core-main.zip
mv JT_Zero_Core-main jt-zero
rm JT_Zero_Core-main.zip
```

**Перевірте:**
```bash
ls ~/jt-zero/
```

Маєте побачити: `backend/  frontend/  jt-zero/  memory/  README.md  ...`

#### Альтернатива: USB флешка (якщо Pi НЕ в мережі)

Якщо Pi взагалі не підключений до мережі:

1. На комп'ютері: скачайте ZIP на USB флешку
2. Вставте флешку в Pi через **micro-USB OTG адаптер**
3. На Pi:
```bash
# Змонтувати флешку
sudo mkdir -p /mnt/usb
sudo mount /dev/sda1 /mnt/usb

# Скопіювати архів
cp /mnt/usb/JT_Zero_Core-main.zip ~/

# Відмонтувати і витягти флешку
sudo umount /mnt/usb

# Розпакувати
cd ~
unzip JT_Zero_Core-main.zip
mv JT_Zero_Core-main jt-zero
rm JT_Zero_Core-main.zip
```

---

## Етап 6: Збірка C++ ядра

### 6.1. Виправлення для GCC 14

GCC 14 (на новому Pi OS) суворіший до коду. Потрібно додати один рядок:

```bash
sed -i '10a #include <cstdlib>' ~/jt-zero/jt-zero/main.cpp
```

### 6.2. Компіляція

```bash
cd ~/jt-zero/jt-zero
rm -rf build
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
```

**Що робить кожна команда:**
1. Переходить у папку C++ коду
2. Видаляє стару папку збірки
3. Створює нову папку для компіляції
4. Входить у неї
5. `cmake` — аналізує проєкт і готує інструкції для компілятора
6. `make -j4` — компілює, використовуючи всі 4 ядра Pi

**Збірка займає 5-10 хвилин.** Жовті `warning` — це нормально. Головне — немає червоних `error`.

**Якщо все добре, останні рядки:**
```
[100%] Built target jtzero_native
```

**ЦІ Ж САМІ КОМАНДИ** працюють однаково незалежно від того, скачали ви код через GitHub чи через ZIP архів. Структура файлів ідентична.

---

## Етап 7: Налаштування Python-сервера

### 7.1. Скопіюйте зібраний C++ модуль

```bash
cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/
```

### 7.2. Створіть Python-середовище

```bash
cd ~/jt-zero/backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements-pi.txt
```

Файл `requirements-pi.txt` містить мінімальний набір залежностей для Pi:
```
fastapi
uvicorn
websockets
psutil
```

### 7.3. Перевірте C++ модуль

```bash
python3 -c "import jtzero_native; print('C++ module OK!')"
```

**Якщо `C++ module OK!`** — все працює.
**Якщо помилка** — не страшно, сервер автоматично використає Python-симулятор.

---

## Етап 8: Перший запуск (тест)

```bash
cd ~/jt-zero/backend
source venv/bin/activate
uvicorn server:app --host 0.0.0.0 --port 8001
```

**Маєте побачити:**
```
[JT-Zero API] Using NATIVE C++ runtime (GCC 14.2)
[JT-Zero] All threads started (7 threads)
INFO:     Uvicorn running on http://0.0.0.0:8001 (Press CTRL+C to quit)
```

### Перевірка у браузері

На вашому комп'ютері відкрийте:
```
http://jtzero.local:8001
```

Або знайдіть IP Pi:
```bash
# На Pi (в іншому SSH-вікні):
hostname -I
```
І відкрийте: `http://<IP>:8001`

**Маєте побачити:** Dashboard з 3D дроном, графіками, 7 вкладками.

Натисніть **Ctrl+C** щоб зупинити тестовий запуск.

---

## Етап 9: Автозапуск (systemd)

Щоб JT-Zero запускався автоматично при кожному включенні Pi.

### 9.1. Створіть сервіс

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

### 9.2. Увімкніть і запустіть

```bash
sudo systemctl daemon-reload
sudo systemctl enable jtzero
sudo systemctl start jtzero
```

### 9.3. Перевірте

```bash
sudo systemctl status jtzero
```

**Має бути зелений `active (running)`.**
Натисніть `q` щоб вийти.

---

## Етап 10: Підключення камери

### Варіант А: Pi Camera (CSI)

#### Фізичне підключення

1. **Вимкніть Pi** (відключіть живлення)
2. На Pi Zero 2W знайдіть маленький білий роз'єм — **міні-CSI** (22-pin)
3. Підніміть фіксатор (чорна планка)
4. Вставте шлейф контактами вниз, синьою стороною вгору
5. Закрийте фіксатор
6. Увімкніть Pi

**ВАЖЛИВО:** Pi Zero 2W має **22-pin** роз'єм. Стандартний шлейф Pi 3/4 (15-pin) НЕ підходить! Потрібен перехідник або "Pi Zero Camera Cable".

#### Перевірка CSI

```bash
rpicam-hello --list-cameras
rpicam-still -o test.jpg
ls -la test.jpg
```

Якщо камера не знайдена:
```bash
# Перевірте boot config
grep camera /boot/firmware/config.txt
# Має бути: camera_auto_detect=1

# Якщо немає — додайте:
echo "camera_auto_detect=1" | sudo tee -a /boot/firmware/config.txt
sudo reboot
```

### Варіант Б: USB Thermal Camera (Caddx 256 та інші UVC)

#### Фізичне підключення

Просто підключіть USB камеру до Pi. Для Pi Zero 2W потрібен micro-USB OTG адаптер.

#### Перевірка USB камери

```bash
# Чи бачить Linux камеру
v4l2-ctl --list-devices

# Які формати підтримує
v4l2-ctl --list-formats-ext -d /dev/video0

# Для термальних камер типово:
# MJPG: 480x320@25, 640x480@25
# YUYV: 480x320@25 (використовується JT-Zero)
```

#### Перевірка через API

```bash
curl -s http://localhost:8001/api/camera | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Type:   {d.get(\"camera_type\",\"?\")}')
print(f'Open:   {d.get(\"camera_open\")}')
print(f'Size:   {d.get(\"width\",0)}x{d.get(\"height\",0)}')
print(f'FPS:    {d.get(\"fps_actual\",0):.1f}')
print(f'Track:  {d.get(\"vo_features_tracked\",0)}')
print(f'Valid:  {d.get(\"vo_valid\")}')
"
```

**Важливо:** JT-Zero автоматично визначає камеру: CSI → USB → Simulator. Якщо CSI не знайдена, автоматично спробує USB.

---

## Етап 11: Підключення сенсорів (опціонально)

### I2C сенсори (MPU6050, BMP280)

```
  Pi GPIO Header
  ─────────────────────
  3V3  (1) (2)  5V
  SDA  (3) (4)  5V        ← MPU6050 + BMP280: SDA
  SCL  (5) (6)  GND       ← MPU6050 + BMP280: SCL
  GP4  (7) (8)  TX (UART) ← GPS RX
  GND  (9) (10) RX (UART) ← GPS TX
```

I2C сенсори підключаються до ОДНИХ і тих самих пінів SDA/SCL (вони на одній шині).

Перевірка:
```bash
sudo i2cdetect -y 1
# 0x68 = MPU6050, 0x76 = BMP280
```

---

## Етап 12: Підключення до польотного контролера

Детальна інструкція: **[FC_CONNECTION.md](FC_CONNECTION.md)**

Коротко:
```
Pi TX (GPIO14) → FC RX (SERIAL4/UART6)
Pi RX (GPIO15) → FC TX
GND            → GND
```

Параметри ArduPilot (Mission Planner):
```
SERIAL4_PROTOCOL = 2    (MAVLink2)
SERIAL4_BAUD = 115       (115200)
VISO_TYPE = 1            (MAVLink)
EK3_SRC1_POSXY = 6      (ExternalNav)
EK3_SRC1_VELXY = 6      (ExternalNav)
```

---

## Як оновлювати систему

### З GitHub (якщо є інтернет)

```bash
cd ~/jt-zero && git pull
cd jt-zero/build && cmake -DCMAKE_BUILD_TYPE=Release .. && make -j4
cp jtzero_native*.so ../../backend/
cd ~/jt-zero/backend && source venv/bin/activate && pip install -r requirements-pi.txt
sudo systemctl restart jtzero
```

### Без GitHub (архівом)

1. На комп'ютері: скачайте новий ZIP з GitHub
2. Скопіюйте на Pi:
```bash
# На комп'ютері:
scp ~/Downloads/JT_Zero_Core-main.zip pi@jtzero.local:~/
```
3. На Pi:
```bash
cd ~
unzip -o JT_Zero_Core-main.zip
rm -rf jt-zero
mv JT_Zero_Core-main jt-zero
cd ~/jt-zero/jt-zero && rm -rf build && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release .. && make -j4
cp jtzero_native*.so ../../backend/
cd ~/jt-zero/backend && source venv/bin/activate && pip install -r requirements-pi.txt
sudo systemctl restart jtzero
```

---

## Вирішення проблем

### "Cannot connect to jtzero.local"
- Pi і комп'ютер мають бути в одній Wi-Fi мережі
- Спробуйте IP адресу: на Pi виконайте `hostname -I`

### Сервер не запускається
```bash
sudo journalctl -u jtzero -n 50 --no-pager
```

### Збірка C++ падає
```bash
cd ~/jt-zero/jt-zero
rm -rf build && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
```

### ArduPilot Pre-Arm помилки

| Помилка | Рішення |
|---------|---------|
| "Rangefinder 1: No Data" | Mission Planner: `RNGFND1_TYPE = 0` |
| "Battery below minimum arming" | Зарядіть батарею або `BATT_ARM_VOLT = 0` (тільки для тесту!) |
| "VisOdom: not healthy" | Перевірте JT-Zero: `curl http://localhost:8001/api/mavlink` |

---

## Порядок дій після встановлення

1. Відкрийте Dashboard: `http://jtzero.local:8001`
2. Перевірте вкладку **Settings** → Hardware Diagnostics
3. Перевірте вкладку **MAVLink** — статус має бути **CONNECTED**
4. У Mission Planner перевірте Pre-Arm Messages
5. Виправте Pre-Arm помилки (таблиця вище)
6. **Перший тест: БЕЗ ПРОПЕЛЕРІВ!**

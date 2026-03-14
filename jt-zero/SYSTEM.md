# JT-Zero — Технічний опис системи

## Загальний принцип роботи

JT-Zero — це система Visual Odometry (VO) для дронів. Камера на Raspberry Pi знімає відео, C++ ядро аналізує кадри, знаходить характерні точки (features), відстежує їх переміщення між кадрами і обчислює куди рухається дрон. Ці дані передаються на польотний контролер через MAVLink протокол.

Польотний контролер (ArduPilot) приймає VO дані і використовує їх у своєму Extended Kalman Filter (EKF3) разом з даними IMU, барометра і GPS для точного визначення позиції дрона.

---

## Алгоритм роботи (крок за кроком)

### 1. Захоплення кадру
```
CSI Camera → V4L2 → 320×240 кадр @ 15 FPS
```
Камера підключена через MIPI CSI інтерфейс. C++ код читає кадри через Video4Linux2 API. Роздільна здатність 320×240 обрана для балансу між якістю та швидкістю обробки на Pi Zero 2 W.

### 2. Детекція features (характерних точок)
```
Кадр → Grayscale → FAST corner detector → до 200 feature points
```
Алгоритм FAST (Features from Accelerated Segment Test) шукає кути — точки де яскравість різко змінюється. Це можуть бути кути меблів, контрастні лінії, текстури на підлозі.

### 3. Tracking (відстеження між кадрами)
```
Features[t-1] → Optical Flow (Lucas-Kanade) → Features[t]
```
Порівнюються features попереднього і поточного кадрів. Для кожної точки обчислюється вектор переміщення (dx, dy в пікселях).

### 4. Visual Odometry — обчислення руху
```
Набір (dx, dy) → Медіанний фільтр → (Δx, Δy, Δz) в метрах
```
З набору векторів переміщення features обчислюється загальний рух камери:
- Медіанний фільтр відкидає викиди (помилково відстежені точки)
- Конвертація пікселів у метри через фокусну відстань камери та висоту
- Результат: dx, dy (горизонтальне переміщення) та якість tracking (0-100%)

### 5. Накопичення позиції
```
pose_x += Δx  (якщо tracking валідний)
pose_y += Δy
pose_z = -altitude_agl (з барометра або FC)
```
Позиція накопичується тільки коли tracking якісний. При поганому tracking (мало features, розмиття) позиція "заморожується" і FC отримує останню відому позицію.

### 6. MAVLink серіалізація та передача
```
Позиція + Attitude → MAVLink v2 frame → UART @ 115200 → FC
```
Три типи повідомлень відправляються на FC:
- **VISION_POSITION_ESTIMATE (#102)** — позиція (x, y, z) + орієнтація (roll, pitch, yaw) @ ~12 Hz
- **ODOMETRY (#331)** — повна одометрія з швидкостями та якістю @ ~12 Hz
- **OPTICAL_FLOW_RAD (#106)** — оптичний потік @ ~6 Hz

### 7. EKF Fusion на FC
```
VO дані + IMU + Baro + GPS → EKF3 → Фінальна позиція
```
ArduPilot EKF3 об'єднує VO з іншими сенсорами. Це дає надійнішу навігацію ніж кожне джерело окремо.

**Статус інтеграції:** ArduPilot EKF3 успішно приймає VO дані від JT-Zero як ExternalNav джерело. Це підтверджено повідомленням `u-blox 1 EKF3 IMU0 is using external nav` у логах FC.

### 8. Конфігурація ArduPilot для VO

Мінімальні параметри (Mission Planner > Config > Full Parameter List):

```
# UART порт (SERIAL4 для Matek H743)
SERIAL4_PROTOCOL = 2          # MAVLink2
SERIAL4_BAUD = 115            # 115200 baud

# Visual Odometry
VISO_TYPE = 1                 # MAVLink
VISO_DELAY_MS = 50            # Затримка обробки

# EKF3: джерело навігації = ExternalNav
EK3_SRC1_POSXY = 6            # ExternalNav (VO позиція)
EK3_SRC1_VELXY = 6            # ExternalNav (VO швидкість)
EK3_SRC1_POSZ = 1             # Barometer (висота)
EK3_SRC1_YAW = 1              # Compass (курс)

# Stream rates для Pi (SERIAL4)
SR4_EXTRA1 = 10               # Attitude @ 10 Hz
SR4_EXTRA2 = 10               # VFR_HUD @ 10 Hz
SR4_EXTRA3 = 2                # AHRS @ 2 Hz
SR4_POSITION = 5              # Position @ 5 Hz
SR4_RAW_SENS = 5              # Raw sensors @ 5 Hz
```

---

## Характеристики системи

### Робочі параметри

| Параметр | Значення | Примітка |
|----------|----------|----------|
| **Ефективна швидкість** | до 2-3 м/с | Вище — features не встигають tracking |
| **Висота польоту** | 0.5 — 10 м | Оптимально 1-3 м для indoor |
| **Дистанція** | Необмежена* | *Дрейф VO ~1-5% від пройденого шляху |
| **Точність позиції** | ±5-20 см | Залежить від текстури поверхні |
| **Частота VO** | ~12 Hz | Достатньо для ArduPilot EKF |
| **Затримка (latency)** | ~50-80 мс | Камера → VO → MAVLink → FC |
| **Камера FPS** | 15 FPS | Обробка 320×240 |
| **Max features** | 200 | Обмеження для Pi Zero 2 W |

### Обмеження

| Обмеження | Причина | Вирішення |
|-----------|---------|-----------|
| **Дрейф позиції** | VO накопичує помилки | GPS fusion outdoor, loop closure indoor |
| **Погане освітлення** | Мало features | LED підсвітка або IR камера |
| **Однорідні поверхні** | Нема features для tracking | Текстурований підлога/стіни |
| **Різкі повороти** | Features "зникають" | Обмежити angular rate |
| **Вібрації** | Розмиття кадрів | Демпфер камери |

### Апаратні вимоги

| Компонент | Мінімум | Рекомендовано |
|-----------|---------|---------------|
| **Плата** | Pi Zero 2 W | Pi 4B / Pi 5 |
| **RAM** | 512 MB | 1+ GB |
| **Камера** | Pi Camera v2 (OV5647) | Pi Camera v3 (IMX708) |
| **FC** | ArduPilot 4.3+ | ArduPilot 4.5+ |
| **UART** | 1 порт (115200 baud) | — |
| **Живлення** | 5V 2A | 5V 3A (Pi 4/5) |
| **SD карта** | 8 GB | 16+ GB |

---

## Підключення до польотного контролера

### Matek H743-SLIM V3 (перевірена конфігурація)

```
Pi Zero 2 W                    Matek H743-SLIM V3
─────────────                  ──────────────────
GPIO 14 (TX) ────────────────→ SERIAL4 RX (RX4)
GPIO 15 (RX) ←──────────────── SERIAL4 TX (TX4)
GND          ────────────────── GND
```

**Параметри ArduPilot (Mission Planner):**

```
SERIAL4_PROTOCOL = 2    (MAVLink2)
SERIAL4_BAUD = 115       (115200 baud)

VISO_TYPE = 1            (MAVLink)
VISO_DELAY_MS = 50

EK3_SRC1_POSXY = 6      (ExternalNav)
EK3_SRC1_VELXY = 6      (ExternalNav)
EK3_SRC1_POSZ = 1       (Baro)
EK3_SRC1_YAW = 1        (Compass)

SR4_EXTRA1 = 10          (Attitude, 10 Hz)
SR4_EXTRA2 = 10          (VFR_HUD, 10 Hz)
SR4_EXTRA3 = 2           (AHRS etc, 2 Hz)
SR4_POSITION = 5         (Position, 5 Hz)
SR4_RAW_SENS = 5         (Raw sensors, 5 Hz)
SR4_RC_CHAN = 2           (RC channels, 2 Hz)
SR4_RAW_CTRL = 0         (Raw control, off)
SR4_ADSB = 0              (ADS-B, off)
```

### Інші FC

Принцип той самий — знайдіть вільний UART на вашому FC та підключіть:
- FC TX → Pi RX (GPIO 15)
- FC RX → Pi TX (GPIO 14)
- GND → GND

Налаштуйте відповідний SERIAL порт з PROTOCOL = 2, BAUD = 115.

---

## Потік даних у системі

```
               ПРИЙОМ (FC → Pi)                    ПЕРЕДАЧА (Pi → FC)
               ──────────────────                  ──────────────────
               HEARTBEAT (#0)                      HEARTBEAT (#0)
               ATTITUDE (#30)                      VISION_POSITION_ESTIMATE (#102)
               RAW_IMU (#27)                       ODOMETRY (#331)
               SCALED_PRESSURE (#29)               OPTICAL_FLOW_RAD (#106)
               SYS_STATUS (#1)
               VFR_HUD (#74)
               GPS_RAW_INT (#24)
               GLOBAL_POSITION_INT (#33)
```

### MAVLink повідомлення що відправляються

| Повідомлення | ID | CRC | Частота | Дані |
|---|---|---|---|---|
| VISION_POSITION_ESTIMATE | 102 | 158 | ~12 Hz | x, y, z, roll, pitch, yaw |
| ODOMETRY | 331 | 91 | ~12 Hz | pose, velocity, quaternion, quality |
| OPTICAL_FLOW_RAD | 106 | 175 | ~6 Hz | integrated flow, gyro, distance |
| HEARTBEAT | 0 | 50 | 1 Hz | system type, component |

---

## Режими роботи сенсорів

JT-Zero автоматично визначає доступне обладнання:

| Режим | Позначення | Опис |
|-------|-----------|------|
| **mavlink** | MAV (блакитний) | Дані від FC через MAVLink (основний режим) |
| **hardware** | HW (зелений) | Прямий драйвер I2C/SPI (MPU6050, BMP280) |
| **simulated** | SIM (жовтий) | Програмна симуляція (для розробки) |

Пріоритет: hardware → mavlink → simulated

---

## API Endpoints

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/health` | Стан сервера, версія, uptime |
| GET | `/api/state` | Повний стан системи (телеметрія) |
| GET | `/api/mavlink` | MAVLink статистика та FC інформація |
| GET | `/api/sensors` | Режими сенсорів (mavlink/hardware/simulated) |
| GET | `/api/diagnostics` | Кешована діагностика обладнання |
| POST | `/api/diagnostics/scan` | Запустити нове сканування обладнання |
| GET | `/api/performance` | Метрики CPU, RAM, диск, мережа |
| GET | `/api/camera/frame` | Поточний кадр з камери (JPEG) |
| GET | `/api/camera/features` | Позиції feature points |
| WS | `/api/ws/telemetry` | WebSocket потік телеметрії (~10 Hz) |

---

## Вкладки Dashboard

| Вкладка | Що показує |
|---------|-----------|
| **Dashboard** | 3D модель дрона, сайдбар з CPU/RAM/Temp, System Monitor, живе відео |
| **Telemetry** | Графіки Roll/Pitch, Gyroscope, Barometer, Battery з auto-scaling |
| **Camera/VO** | Живе відео з feature points overlay, VO статистика |
| **MAVLink** | Стан з'єднання, FC інфо, лічильники повідомлень |
| **Events** | Лог системних подій |
| **Docs** | Документація та інструкції підключення |
| **Settings** | Hardware Diagnostics, C++ Sensor Drivers, конфігурація потоків |

# JT-Zero — Підключення до Польотного Контролера

## Загальна схема

```
                    UART (3 дроти)
┌──────────────┐                      ┌────────────────────┐
│  Pi Zero 2W  │  TX (GPIO14) ──────► │ RX (будь-який UART)│
│  (JT-Zero)   │  RX (GPIO15) ◄────── │ TX                 │  Польотний
│              │  GND ────────────── │ GND                │  Контролер
│              │                      │                    │
│  Камера CSI  │                      │  IMU + Baro + GPS  │
│  Wi-Fi       │                      │  ESC → Мотори      │
└──────────────┘                      └────────────────────┘

Pi відправляє на FC:
  • VISION_POSITION_ESTIMATE — позиція з камери (Visual Odometry)
  • OPTICAL_FLOW_RAD — оптичний потік
  • HEARTBEAT — "я живий" кожну секунду

FC відправляє на Pi:
  • ATTITUDE — крен/тангаж/курс
  • GPS_RAW_INT — координати GPS
  • HEARTBEAT — стан FC (armed/disarmed)
```

---

## ВАЖЛИВО: Правила безпеки

1. **НІКОЛИ не підключайте 5V від Pi до FC** — тільки TX, RX, GND
2. **Перевіряйте мультиметром** що UART працює на 3.3V (не 5V!)
3. **Перший тест — без пропелерів!**
4. **TX Pi → RX FC, RX Pi → TX FC** — перехресне підключення

---

## Підключення: Matek H743-SLIM V3

### Крок 1: Знайдіть UART6 на платі

Matek H743-SLIM V3 має 7 UART портів. Ми використаємо **UART6** — він спеціально
призначений для companion computers і знаходиться на конекторі.

Дивіться схему плати (друкована на самій платі або в документації):
```
https://www.mateksys.com/?portfolio=h743-slim-v3
```

Порт UART6 на Matek H743-SLIM V3:
```
  Конектор на платі (маркування "UART6" або "U6"):
  ┌─────────┐
  │ TX6     │ — сюди підключаємо RX від Pi (GPIO15, Pin 10)
  │ RX6     │ — сюди підключаємо TX від Pi (GPIO14, Pin 8)
  │ GND     │ — сюди підключаємо GND від Pi (Pin 6 або Pin 9)
  └─────────┘
```

### Крок 2: Припаяйте/підключіть 3 дроти

Потрібно 3 дроти (рекомендуємо 26AWG або тонший силіконовий):

| Дріт | Від (Pi Zero 2W) | До (Matek H743-SLIM V3) | Колір (рекомендація) |
|------|-------------------|--------------------------|----------------------|
| 1    | Pin 8 (GPIO14, TX)| RX6 (UART6 RX)           | Зелений              |
| 2    | Pin 10 (GPIO15, RX)| TX6 (UART6 TX)          | Жовтий               |
| 3    | Pin 6 (GND)       | GND (будь-який GND)      | Чорний               |

```
  Pi Zero 2W GPIO                    Matek H743-SLIM V3
  ──────────────                     ───────────────────

  Pin 1  [3V3]  [5V]  Pin 2
  Pin 3  [SDA]  [5V]  Pin 4
  Pin 5  [SCL]  [GND] Pin 6  ◄── Чорний дріт ──► GND (FC)
  Pin 7  [GP4]  [TX ] Pin 8  ◄── Зелений дріт ──► RX6 (FC)
  Pin 9  [GND]  [RX ] Pin 10 ◄── Жовтий дріт ──► TX6 (FC)
```

**УВАГА:**
- TX від Pi йде на **RX** контролера (перехресно!)
- RX від Pi йде на **TX** контролера
- НЕ підключайте 5V або 3V3 між Pi та FC
- Pi живиться окремо (через свій micro-USB)

### Крок 3: Налаштування ArduPilot (Mission Planner / QGC)

Підключіть FC до комп'ютера через USB і відкрийте **Mission Planner** або **QGroundControl**.

Перейдіть у **Config/Tuning → Full Parameter List** і змініть ці параметри:

```
# === UART6 — Companion Computer (JT-Zero) ===
SERIAL6_PROTOCOL = 2          # MAVLink2
SERIAL6_BAUD = 921            # 921600 бод (921 = скорочення в ArduPilot)

# === EKF — приймати дані від Visual Odometry ===
VISO_TYPE = 1                 # MAVLink vision position
EK3_SRC1_POSXY = 6            # ExternalNav (Visual Odometry)
EK3_SRC1_VELXY = 6            # ExternalNav
EK3_SRC1_POSZ = 1             # Barometer (висота від баро FC)
EK3_SRC1_YAW = 1              # Compass

# === Optical Flow (опціонально, якщо JT-Zero передає flow) ===
FLOW_TYPE = 1                 # MAVLink optical flow

# === Companion Computer ===
SYSID_THISMAV = 1             # System ID польотника
```

**Після зміни параметрів:**
1. Натисніть **"Write Params"** (зберегти)
2. Перезавантажте FC (вимкніть/увімкніть живлення)

### Крок 4: Перевірка зв'язку

На Pi через SSH:

```bash
# Перевірити що UART працює:
ls -la /dev/ttyAMA0

# Подивитися логи JT-Zero:
journalctl -u jtzero -f
```

В Mission Planner:
- Відкрийте **Messages** (вікно повідомлень внизу)
- Маєте побачити: `VISION_POSITION_ESTIMATE` або `Companion heartbeat`

---

## Підключення: Інші контролери

### SpeedyBee F405 V4

Використовуйте **UART4** (TX4/RX4):

```
SERIAL4_PROTOCOL = 2
SERIAL4_BAUD = 921
```

Піни на платі позначені як TX4/RX4. Підключення аналогічне:
- Pi TX (Pin 8) → RX4 (FC)
- Pi RX (Pin 10) → TX4 (FC)
- Pi GND (Pin 6) → GND (FC)

### Pixhawk 2.4.8

Використовуйте **TELEM2** порт (6-пін конектор):

```
  TELEM2 конектор (DF13 або JST-GH):
  ┌─────────────────────────────┐
  │ 1: 5V (НЕ підключати!)     │
  │ 2: TX  → RX Pi (Pin 10)    │
  │ 3: RX  → TX Pi (Pin 8)     │
  │ 4: CTS (не підключати)     │
  │ 5: RTS (не підключати)     │
  │ 6: GND → GND Pi (Pin 6)    │
  └─────────────────────────────┘
```

```
SERIAL2_PROTOCOL = 2
SERIAL2_BAUD = 921
```

### Cube Orange+

Використовуйте **TELEM2** порт (аналогічно Pixhawk):

```
SERIAL2_PROTOCOL = 2
SERIAL2_BAUD = 921
```

Cube Orange+ використовує конектор JST-GH. Розпіновка така ж як Pixhawk.

---

## Налаштування JT-Zero для роботи з FC

Після підключення дротів та налаштування ArduPilot, потрібно вказати JT-Zero
використовувати реальний UART замість симуляції.

### Крок 1: Відредагуйте конфігурацію

На Pi:

```bash
sudo nano /home/pi/jt-zero/backend/.env
```

Додайте рядки:

```
MAVLINK_TRANSPORT=serial
MAVLINK_DEVICE=/dev/ttyAMA0
MAVLINK_BAUD=921600
```

Збережіть: **Ctrl+O**, Enter, **Ctrl+X**

### Крок 2: Перезапустіть

```bash
sudo systemctl restart jtzero
```

### Крок 3: Перевірте

```bash
journalctl -u jtzero -f
```

Маєте побачити:
```
[MAVLink] Serial opened: /dev/ttyAMA0 @ 921600 baud
[MAVLink] Connected to FC (received response)
```

---

## Типові проблеми

### "No data from FC"
- Перевірте що TX і RX не переплутані (найчастіша помилка!)
- Перевірте що ArduPilot параметри збережені та FC перезавантажений
- Перевірте baud rate (має бути однаковий на FC і Pi)

### "UART busy" або "Permission denied"
- Переконайтесь що Serial Console вимкнений в raspi-config
  (Interface Options → Serial Port → Login shell: NO, Hardware: YES)

### "Vision position rejected"
- ArduPilot вимагає стабільні дані. Переконайтесь що камера працює
- Перевірте що EK3_SRC1_POSXY = 6

### FC не реагує на команди від Pi
- Переконайтесь що SYSID_THISMAV на FC = 1
- JT-Zero відправляє з component_id = 191 (MAV_COMP_ID_ONBOARD_COMPUTER)

---

## Повна схема підключення для дрона

```
                                    ┌─── GPS Module
                                    │    (підключений до FC)
                                    │
┌──────────────┐    UART    ┌───────┴──────┐    PWM/DShot    ┌─────────┐
│  Pi Zero 2W  │◄──────────►│ Matek H743   │───────────────►│ ESC x4  │
│              │ TX/RX/GND  │ SLIM V3      │                │         │
│  ┌────────┐  │            │              │                │ Мотори  │
│  │Камера  │  │            │ IMU (вбудов.)│                └─────────┘
│  │Pi Cam  │  │            │ Баро (вбудов)│
│  └────────┘  │            │              │
│              │            │ RC Receiver  │◄─── Пульт управління
│  Wi-Fi ))))  │            └──────────────┘
│  Dashboard   │
└──────────────┘
  живлення:            живлення:
  USB 5V 2.5A          Батарея LiPo → BEC 5V
  (окремий)            (через ESC або окремий BEC)
```

---

## Рекомендації

1. **Почніть з тестів на столі** — без пропелерів, з USB живленням
2. **Спочатку перевірте MAVLink** — чи бачить FC дані від Pi
3. **Потім додайте камеру** — перевірте VO в Dashboard
4. **Тільки потім літайте** — в режимі LOITER або GUIDED
5. **Завжди майте RC пульт** — для екстренного переключення в STABILIZE

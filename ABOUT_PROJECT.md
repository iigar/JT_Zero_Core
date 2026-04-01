# JT-Zero — Про проєкт

## Що це?

**JT-Zero** — автономна система візуальної навігації для дронів на Raspberry Pi. Дозволяє дрону орієнтуватись у просторі без GPS, використовуючи лише камеру.

Система аналізує відео з камери в реальному часі, знаходить та відслідковує характерні точки (кути, текстури), обчислює як дрон рухається, і передає цю інформацію польотному контролеру через MAVLink.

## Для кого?

- Пілоти FPV дронів які хочуть стабільний політ без GPS
- Розробники автономних систем на базі ArduPilot
- Дослідники computer vision на embedded платформах
- Команди SAR (пошук та рятування) — нічні польоти з термальною камерою

## Як працює?

### Visual Odometry (VO)

```
Кадр N-1 (попередній)          Кадр N (поточний)
┌─────────────────────┐       ┌─────────────────────┐
│    .  скеля          │       │         .  скеля     │
│  .  кущ              │  -->  │       .  кущ         │
│        . стежка      │       │             . стежка  │
└─────────────────────┘       └─────────────────────┘
                                 
  Скеля змістилась на (dx, dy) пікселів
  Дрон змістився на (-dx, -dy) * масштаб
```

1. **Детекція фіч** — FAST-9 + Shi-Tomasi знаходять кути та текстури
2. **Трекінг** — Lucas-Kanade optical flow відслідковує точки між кадрами
3. **Фільтрація** — Median + MAD відкидає аутлаєри
4. **Масштабування** — пікселі → метри через висоту та фокусну відстань
5. **Фільтр Калмана** — згладжує швидкість, перевіряє з IMU
6. **MAVLink** — передає позицію на польотний контролер @ 25Hz

### Навіщо VO коли є GPS?

| Ситуація | GPS | VO |
|----------|-----|-----|
| Відкрите поле | Працює | Працює |
| Між будівлями | Відбиття (±10м) | Працює |
| Під мостом/навісом | Зникає | Працює |
| Густий ліс | Погано (±5м) | Працює |
| Приміщення | Немає сигналу | **Єдине джерело** |
| Глушіння GPS | Відключений | **Єдине джерело** |

## Апаратне забезпечення

### Мінімальна конфігурація
- Raspberry Pi Zero 2 W (~$15)
- CSI камера (Pi Camera v2 ~$25 або IMX290 ~$20)
- UART підключення до польотного контролера (3 дроти: TX, RX, GND)

### Оптимальна конфігурація
- Raspberry Pi 4 (4GB)
- CSI камера (вперед, для VO)
- USB термальна камера Caddx 256x192 (вниз, для сканування)
- Matek H743 або аналогічний FC з ArduPilot

### Підтримувані камери

**CSI (основна, для VO):**

| Сенсор | Камера | Роздільність | FOV | Особливість |
|--------|--------|-------------|-----|-------------|
| OV5647 | Pi Camera v1 | 5MP | 62° | Найдешевша |
| IMX219 | Pi Camera v2 | 8MP | 62° | Найпопулярніша |
| IMX477 | Pi HQ Camera | 12.3MP | залежить від об'єктива | Змінні лінзи |
| IMX708 | Pi Camera v3 | 12MP | 66° | Автофокус |
| OV9281 | Global Shutter | 1MP | 80° | Ідеальна для VO |
| IMX296 | Pi GS Camera | 1.6MP | 49° | Global shutter |
| OV64A40 | Arducam 64MP | 64MP | 84° | Максимальна роздільність |
| IMX290 | STARVIS | 2MP | 82° | Нічне бачення |

Будь-яка інша камера яку бачить `rpicam-hello` також підтримується (GENERIC mode).

**USB (допоміжна, термальна):**
- Caddx 256x192 — термальне сканування вниз, on-demand capture

## Програмна архітектура

```
jt-zero/
├── jt-zero/              # C++ ядро (8 потоків real-time)
│   ├── core/             # Runtime, event engine, reflex engine
│   ├── camera/           # Camera pipeline, VO, drivers (CSI + USB)
│   ├── mavlink/          # MAVLink v2 parser + transport
│   ├── api/              # pybind11 Python bindings
│   └── include/          # Headers (camera.h, common.h, sensors.h)
│
├── backend/              # FastAPI сервер
│   ├── server.py         # REST API + WebSocket
│   ├── simulator.py      # Python симулятор (для тестування без Pi)
│   ├── native_bridge.py  # Міст до C++ runtime
│   └── static/           # Pre-built React frontend
│
├── frontend/             # React 19 + Tailwind CSS
│   └── src/components/   # Dashboard, Camera, Thermal, MAVLink панелі
│
├── .github/workflows/    # CI/CD
│   └── build-frontend.yml # Auto-build React on push
│
├── setup.sh              # Повна установка на новий Pi
├── update.sh             # Швидке оновлення (git pull + build)
└── commands_reminder.md  # Шпаргалка команд
```

## Потік даних

```
CSI Camera (15fps)
    │
    ▼
C++ Camera Thread (T6)
    │ FAST + Shi-Tomasi → LK Tracker → Outlier Filter → Kalman
    ▼
VO Result (dx, dy, confidence)
    │
    ▼
C++ MAVLink Thread (T5)
    │ VISION_POSITION_ESTIMATE @ 25Hz
    ▼
Flight Controller (ArduPilot EKF3)
    │ Fuses: GPS + VO + IMU + Baro + Compass
    ▼
Stable Flight
```

## Сценарії використання

1. **Точне землеробство** — термальна камера вниз, VO для точного позиціонування, термальна карта показує вологість/хвороби
2. **Пошук та рятування (SAR)** — нічний політ з термальною камерою, VO навігація без GPS (ліс, гори)
3. **Інспекція інфраструктури** — мости, лінії електропередач: VO тримає стабільну позицію для фото; термальна знаходить перегріті контакти
4. **Навігація в приміщеннях** — склади, шахти: GPS=0, VO — єдине джерело позиції
5. **Картографія та 3D моделювання** — серія знімків з точними VO координатами → фотограмметрія
6. **Охорона та патрулювання** — автономний маршрут периметру; термальна виявляє людей/тварин

## Підключення до польотного контролера

### Дроти (3 штуки):
```
Pi Pin 8  (TX)  ──> FC RX (UART порт)
Pi Pin 10 (RX)  <── FC TX
Pi Pin 6  (GND) ─── FC GND
```

### Параметри ArduPilot:
```
SERIALx_PROTOCOL = 2    (MAVLink2)
SERIALx_BAUD = 115      (115200)
VISO_TYPE = 1            (MAVLink vision)
EK3_SRC1_POSXY = 6      (ExternalNav)
EK3_SRC1_VELXY = 6      (ExternalNav)
```

JT-Zero автоматично визначає baud rate FC (CRC-validated probe).

## Перевірено на залізі

- **Pi Zero 2W + Matek H743** @ 115200 baud — CONNECTED
- **IMX219** (Pi Camera v2) — DET:180, TRACK:44, CONF:28%, Valid:True
- **IMX290** (STARVIS) — DET:180, TRACK:44, INL:44, Valid:True
- **Caddx 256x192** USB thermal — on-demand capture працює
- **EKF3 ExternalNav** — "EKF3 IMU0/1 is using external nav data"
- **VISION_POSITION_ESTIMATE** @ 25Hz confirmed
- **0 CRC помилок** на всіх конфігураціях

## Ліцензія

Приватний проєкт. Всі права захищено.

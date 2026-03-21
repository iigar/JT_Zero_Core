# JT-Zero: Система Visual Odometry для дронів

## Що це і навіщо?

JT-Zero — це **companion computer система** для дронів. Вона вирішує конкретну проблему: **стабільний політ без GPS** (у приміщеннях, підвалах, тунелях, складах).

Як це працює: камера Raspberry Pi дивиться вниз, аналізує переміщення поверхні і каже дрону "ти змістився на 10 см вліво". Польотний контролер (ArduPilot) використовує ці дані замість GPS для стабілізації і навігації.

**Коштує:** ~$60 (Pi Zero 2W + камера + дроти) замість $500+ за промислові рішення.

---

## Документація

| Документ | Що описує |
|----------|-----------|
| **[SYSTEM.md](jt-zero/SYSTEM.md)** | Навіщо створена система, як працює алгоритм VO, характеристики (швидкість, висота, точність, дальність), архітектура, обмеження |
| **[DEPLOYMENT.md](jt-zero/DEPLOYMENT.md)** | Покрокова встановлення від нуля (для початківців). **Два способи: через GitHub або офлайн (архів/USB)** |
| **[COMMANDS.md](jt-zero/COMMANDS.md)** | Всі команди: збірка, запуск, API (curl), діагностика, troubleshooting |
| **[FC_CONNECTION.md](jt-zero/FC_CONNECTION.md)** | Підключення до польотного контролера (Matek H743, Pixhawk, etc.) |
| **[LONG_RANGE_FLIGHT.md](jt-zero/LONG_RANGE_FLIGHT.md)** | Конфігурація для 5+ км польотів (VO+IMU, без GPS) |

---

## Встановлення без GitHub

Не хочете використовувати `git`? Є два варіанти:

### Варіант 1: Скачати ZIP з сайту

1. На комп'ютері відкрийте: `https://github.com/iigar/JT_Zero_Core/archive/refs/heads/main.zip`
2. Скопіюйте на Pi: `scp ~/Downloads/JT_Zero_Core-main.zip pi@jtzero.local:~/`
3. На Pi: `unzip JT_Zero_Core-main.zip && mv JT_Zero_Core-main jt-zero`

### Варіант 2: Установочний архів з автоінсталятором

```bash
# На комп'ютері (де є git clone):
cd jt-zero
chmod +x create_archive.sh
./create_archive.sh
# Створить файл jt-zero-install.zip

# Скопіювати на Pi:
scp jt-zero-install.zip pi@jtzero.local:~/

# На Pi:
unzip jt-zero-install.zip
cd jt-zero-install
chmod +x install.sh
./install.sh
```

Детальна інструкція: **[DEPLOYMENT.md](jt-zero/DEPLOYMENT.md)** (Етап 5, Спосіб Б)

---

## Архітектура

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────┐
│   CSI / USB     │─────>│  C++ Core        │─────>│  Flight        │
│   Camera        │ V4L2 │  - FAST Detect   │ UART │  Controller    │
│                 │ MMAP │  - Shi-Tomasi    │      │  (ArduPilot)   │
└─────────────────┘      │  - LK + Sobel    │      └────────────────┘
                         │  - MAVLink TX/RX │
                         └────────┬─────────┘
                                  │ pybind11
                         ┌────────┴─────────┐
                         │  FastAPI Backend  │
                         │  WebSocket 10 Hz  │
                         └────────┬─────────┘
                                  │ HTTP/WS
                         ┌────────┴─────────┐
                         │  React Dashboard  │
                         │  7 вкладок        │
                         └──────────────────┘
```

## Стек технологій

| Компонент | Технологія |
|-----------|-----------|
| Ядро | C++17, lock-free, 8 потоків реального часу |
| Зв'язка C++/Python | pybind11 |
| Backend | FastAPI, WebSocket, uvicorn |
| Frontend | React 19, Recharts, Tailwind CSS, Three.js |
| Протокол | MAVLink v2 (повна серіалізація з CRC) |
| Платформи | Raspberry Pi Zero 2W, Pi 4, Pi 5 |
| Камери | Pi Camera v2/v3 (CSI), USB термальні (Caddx 256) |

## Можливості

- Visual Odometry з точністю ±5-20 см
- **Далекий політ: до 5+ км з RTL (VO+IMU, без GPS)**
- Ефективна швидкість: до 2-3 м/с
- Робоча висота: 0.3-10 м (оптимально 1-3 м)
- Частота VO: ~12 Hz (ArduPilot EKF приймає)
- **FAST + Shi-Tomasi детектори** (каскад для термальних камер)
- **LK трекер з Sobel градієнтами і білінійною інтерполяцією**
- Kalman-фільтрована швидкість + outlier rejection
- Confidence-based covariance для EKF
- **Platform/VO Mode:** автовизначення платформи + VO режими без перезапуску
- 7-вкладковий Dashboard з реальним часом
- Підтримка Pi Camera v2/v3, **USB термальних камер** (Caddx 256)

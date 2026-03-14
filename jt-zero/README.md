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
│   CSI Camera    │─────>│  C++ Core        │─────>│  Flight        │
│   (OV5647)      │ MIPI │  - FAST Detect   │ UART │  Controller    │
│                 │      │  - LK Tracking   │      │  (ArduPilot)   │
└─────────────────┘      │  - MAVLink TX/RX │      └────────────────┘
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
| Платформа | Raspberry Pi Zero 2 W (ARM Cortex-A53) |

## Можливості

- Visual Odometry з точністю ±5-20 см
- Ефективна швидкість: до 2-3 м/с
- Робоча висота: 0.3-10 м (оптимально 1-3 м)
- Частота VO: ~12 Hz (ArduPilot EKF приймає)
- 7-вкладковий Dashboard з реальним часом
- Автовизначення обладнання
- Підтримка Pi Camera v2/v3 та USB камер

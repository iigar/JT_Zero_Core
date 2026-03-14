# JT-Zero Runtime

Автономна система візуальної навігації для дронів на базі Raspberry Pi Zero 2 W.

C++ ядро реального часу + Python API + React dashboard + MAVLink інтеграція з польотним контролером.

## Що це

JT-Zero — це companion computer система, яка перетворює звичайну камеру Raspberry Pi на джерело навігаційних даних для польотного контролера. Система аналізує відео з камери, відстежує візуальні ознаки, обчислює переміщення дрона і передає ці дані через MAVLink на FC (ArduPilot/PX4).

## Можливості

- **Visual Odometry** — обчислення позиції та швидкості за відеопотоком
- **Стрімінг відео** — живе відео з камери в веб-інтерфейс з накладанням feature points
- **MAVLink телеметрія** — двонаправлений зв'язок з FC (прийом/передача)
- **Hardware Diagnostics** — автоматичне сканування обладнання при старті
- **System Monitor** — моніторинг CPU, RAM, температури, мережі
- **Веб-інтерфейс** — 7 вкладок з повною інформацією про систему

## Архітектура

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────┐
│   CSI Camera    │─────→│  C++ Core        │─────→│  Flight        │
│   (OV5647/      │ MIPI │  - Feature Det.  │ UART │  Controller    │
│    IMX219)      │      │  - Visual Odom.  │      │  (ArduPilot)   │
└─────────────────┘      │  - MAVLink TX/RX │      └────────────────┘
                         └────────┬─────────┘
                                  │ pybind11
                         ┌────────┴─────────┐
                         │  FastAPI Backend  │
                         │  - WebSocket      │
                         │  - REST API       │
                         └────────┬─────────┘
                                  │ HTTP/WS
                         ┌────────┴─────────┐
                         │  React Dashboard  │
                         │  (браузер)        │
                         └──────────────────┘
```

## Швидкий старт

Дивіться [DEPLOYMENT.md](jt-zero/DEPLOYMENT.md) — повна інструкція від нуля.

## Документація

| Файл | Опис |
|------|------|
| [DEPLOYMENT.md](jt-zero/DEPLOYMENT.md) | Встановлення та налаштування (з GitHub або офлайн) |
| [FC_CONNECTION.md](jt-zero/FC_CONNECTION.md) | Підключення до польотного контролера |
| [SYSTEM.md](jt-zero/SYSTEM.md) | Технічний опис системи, алгоритми, характеристики |
| [COMMANDS.md](jt-zero/COMMANDS.md) | Всі команди для взаємодії з системою |

## Стек технологій

| Компонент | Технологія |
|-----------|-----------|
| Ядро | C++17, lock-free, real-time |
| Зв'язка C++/Python | pybind11 |
| Backend | FastAPI, WebSocket, uvicorn |
| Frontend | React, Recharts, Tailwind CSS |
| Протокол | MAVLink v2 |
| Платформа | Raspberry Pi Zero 2 W (ARM Cortex-A53) |

## Ліцензія

Приватний проєкт.

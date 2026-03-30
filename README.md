# JT-Zero Runtime

Автономна система візуальної навігації для дронів на базі Raspberry Pi Zero 2 W.

## Навіщо це?

Дрони не можуть стабільно літати у приміщеннях без GPS. JT-Zero вирішує цю проблему: камера Pi аналізує переміщення поверхні і передає позицію на польотний контролер через MAVLink. Дрон літає стабільно навіть без GPS, використовуючи лише камеру за $15.

## Що входить

- **C++ ядро** — обробка відео та сенсорів в реальному часі (8 потоків)
- **Python сервер** — FastAPI бекенд з WebSocket стрімінгом
- **React Dashboard** — 7-вкладковий моніторинг у браузері
- **MAVLink** — повна двостороння інтеграція з ArduPilot

## Архітектура

```
┌─────────────────┐      ┌──────────────────┐      ┌────────────────┐
│   CSI Camera    │─────>│  C++ Core        │─────>│  Flight        │
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

## Документація

| Файл | Опис |
|------|------|
| **[SYSTEM.md](jt-zero/SYSTEM.md)** | Як працює система, алгоритм VO, характеристики, архітектура |
| **[DEPLOYMENT.md](jt-zero/DEPLOYMENT.md)** | Встановлення на Pi (через GitHub або офлайн через ZIP/USB) |
| **[COMMANDS.md](jt-zero/COMMANDS.md)** | Всі команди: збірка, запуск, API, діагностика, troubleshooting |
| **[FC_CONNECTION.md](jt-zero/FC_CONNECTION.md)** | Підключення до польотного контролера |

## Встановлення без GitHub

Не потрібен `git`! Скачайте ZIP і перенесіть на Pi:

1. Завантажте: `https://github.com/iigar/JT_Zero_Core/archive/refs/heads/main.zip`
2. Скопіюйте на Pi: `scp JT_Zero_Core-main.zip pi@jtzero.local:~/`
3. На Pi: `unzip JT_Zero_Core-main.zip && mv JT_Zero_Core-main jt-zero`

Або використовуйте скрипт `create_archive.sh` для створення установочного архіву з автоінсталятором.

Детальна інструкція: [DEPLOYMENT.md](jt-zero/DEPLOYMENT.md)

## Стек технологій

| Компонент | Технологія |
|-----------|-----------|
| Ядро | C++17, lock-free, real-time |
| Зв'язка C++/Python | pybind11 |
| Backend | FastAPI, WebSocket, uvicorn |
| Frontend | React 19, Recharts, Tailwind CSS, Three.js |
| Протокол | MAVLink v2 |
| Платформа | Raspberry Pi Zero 2 W (ARM Cortex-A53) |

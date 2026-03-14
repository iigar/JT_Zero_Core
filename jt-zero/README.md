# JT-Zero: Система Visual Odometry для дронів

## Що це?

JT-Zero -- це програма-компаньйон для дрона, яка працює на **Raspberry Pi Zero 2 W**. Вона використовує камеру для визначення позиції дрона у просторі (Visual Odometry) і передає ці дані на польотний контролер через MAVLink.

**Простими словами:** камера дивиться вниз, бачить як рухається підлога, і каже дрону "ти змістився на 10 см вліво". Польотний контролер використовує цю інформацію для стабільного зависання навіть без GPS (наприклад, у приміщенні).

## Що входить до складу?

```
JT-Zero
  |
  |-- C++ ядро         швидка обробка відео та сенсорів
  |-- Python сервер    FastAPI бекенд для API та WebSocket
  |-- Web Dashboard    7-вкладковий моніторинг у браузері
  |-- MAVLink          двосторонній зв'язок з польотним контролером
```

## Можливості

- Визначення позиції камерою (Visual Odometry) з точністю 5-20 см
- Реальний час: обробка 15 кадрів/сек на Pi Zero 2 W
- Інтеграція з ArduPilot EKF3 як External Navigation
- Живий Dashboard з телеметрією, 3D моделлю, графіками
- Автовизначення обладнання (камера, I2C сенсори, UART)
- Підтримка Pi Camera v2/v3 та USB камер

## Що потрібно для початку?

| Компонент | Обов'язково | Опціонально |
|-----------|-------------|-------------|
| Raspberry Pi Zero 2 W | Так | Pi 3B+, Pi 4, Pi 5 теж підходять |
| SD-карта 8+ ГБ | Так | Рекомендовано 16 ГБ |
| Pi Camera v2 | Так | USB камера як альтернатива |
| Польотний контролер | Так | ArduPilot 4.3+, перевірено з Matek H743 |
| 3 дроти (TX, RX, GND) | Так | Для UART з'єднання |
| IMU (MPU6050) | Ні | Для незалежного AHRS |
| Барометр (BMP280) | Ні | Для точнішої висоти |
| GPS модуль | Ні | Для outdoor навігації |

## Швидкий старт

### 1. Встановлення на Pi

Детальна покрокова інструкція (для початківців):
**[DEPLOYMENT.md](DEPLOYMENT.md)**

### 2. Підключення до польотного контролера

Схема проводки та параметри ArduPilot:
**[FC_CONNECTION.md](FC_CONNECTION.md)**

### 3. Перевірка роботи

Відкрийте у браузері (з комп'ютера у тій самій мережі):
```
http://jtzero.local:8001
```

## Документація

| Документ | Опис |
|----------|------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Встановлення на Pi (з GitHub або офлайн) |
| [FC_CONNECTION.md](FC_CONNECTION.md) | Підключення до Matek H743 / інших FC |
| [SYSTEM.md](SYSTEM.md) | Архітектура, алгоритми, характеристики |
| [COMMANDS.md](COMMANDS.md) | Всі команди для збірки, запуску, дебагу |

## Архітектура (коротко)

```
  Pi Camera (CSI)     Matek H743-SLIM V3 (FC)
       |                      |
  [C++ ядро]            [MAVLink UART]
  15fps VO               115200 baud
  FAST + LK              |
       |                  |
  [Python FastAPI]--------+
       |
  [React Dashboard]
  7 вкладок, WebSocket @ 10 Hz
```

### 8 потоків реального часу

| Потік | Частота | Роль |
|-------|---------|------|
| T0 Supervisor | 10 Hz | Здоров'я системи, телеметрія |
| T1 Sensors | 200 Hz | Читання IMU, Baro, GPS |
| T2 Events | 200 Hz | Диспетчер подій |
| T3 Reflex | 200 Hz | Швидкі реакції (<5ms) |
| T4 Rules | 20 Hz | Складна логіка поведінки |
| T5 MAVLink | 50 Hz | Зв'язок з FC |
| T6 Camera | 15 FPS | Visual Odometry |
| T7 API | 30 Hz | HTTP/WebSocket бридж |

## API Endpoints

| Метод | Endpoint | Опис |
|-------|----------|------|
| GET | `/api/health` | Стан сервера |
| GET | `/api/state` | Повна телеметрія |
| GET | `/api/mavlink` | MAVLink статистика |
| GET | `/api/sensors` | Режими сенсорів |
| GET | `/api/diagnostics` | Діагностика обладнання |
| GET | `/api/camera/frame` | Кадр з камери (PNG) |
| GET | `/api/camera/features` | Feature points |
| GET | `/api/performance` | CPU, RAM, Temp |
| WS | `/api/ws/telemetry` | Потік телеметрії (10 Hz) |
| POST | `/api/command` | Відправити команду (arm, disarm, etc.) |

## Поточний статус

- Visual Odometry: працює, ~12 Hz
- MAVLink: працює, ArduPilot EKF приймає VO дані
- Dashboard: 7 вкладок, все функціонує
- Камера: Pi Camera v2 (OV5647), 15 FPS
- FC: Matek H743-SLIM V3, ArduCopter V4.3.6

## Ліцензія

MIT License

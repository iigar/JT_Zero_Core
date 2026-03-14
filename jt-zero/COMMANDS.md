# JT-Zero — Довідник команд

Всі команди для збірки, запуску, діагностики та взаємодії з системою JT-Zero.

---

## 1. Керування сервісом на Pi

Після встановлення JT-Zero працює як системний сервіс (systemd). Ці команди виконуються на Pi через SSH.

| Дія | Команда |
|-----|---------|
| Статус | `sudo systemctl status jtzero` |
| Запустити | `sudo systemctl start jtzero` |
| Зупинити | `sudo systemctl stop jtzero` |
| Перезапустити | `sudo systemctl restart jtzero` |
| Увімкнути автозапуск | `sudo systemctl enable jtzero` |
| Вимкнути автозапуск | `sudo systemctl disable jtzero` |

### Логи

```bash
# Логи в реальному часі (Ctrl+C для виходу)
journalctl -u jtzero -f

# Останні 50 рядків
sudo journalctl -u jtzero -n 50 --no-pager

# Логи за останню годину
sudo journalctl -u jtzero --since "1 hour ago"

# Логи з помилками
sudo journalctl -u jtzero -p err
```

---

## 2. Збірка C++ ядра

### Перша збірка (або повна перезбірка)

```bash
cd ~/jt-zero/jt-zero
rm -rf build
mkdir build
cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
```

**Пояснення:**
- `rm -rf build` — видаляє стару збірку
- `mkdir build && cd build` — створює папку для компіляції
- `cmake ..` — аналізує CMakeLists.txt і генерує Makefile
- `make -j4` — компілює, використовуючи 4 ядра Pi
- Займає 5-10 хвилин на Pi Zero 2W

**Результат (якщо успішно):**
```
[100%] Built target jtzero_native
```

### Швидка перезбірка (після зміни коду)

```bash
cd ~/jt-zero/jt-zero/build
make -j4
```

Перекомпілює тільки файли що змінилися. Зазвичай 30-60 секунд.

### Копіювання зібраного модуля в backend

```bash
cp ~/jt-zero/jt-zero/build/jtzero_native*.so ~/jt-zero/backend/
sudo systemctl restart jtzero
```

---

## 3. Оновлення проєкту

### Оновлення з GitHub (якщо є інтернет)

```bash
cd ~/jt-zero
git pull
cd jt-zero/build
make -j4
cp jtzero_native*.so ../../backend/
sudo systemctl restart jtzero
```

### Оновлення з архіву (без GitHub)

```bash
# На комп'ютері: скачайте новий ZIP і скопіюйте на Pi через SCP
# Далі на Pi:
cd ~
unzip -o JT_Zero_Core-main.zip
rm -rf jt-zero
mv JT_Zero_Core-main jt-zero
cd ~/jt-zero/jt-zero/build
make -j4
cp jtzero_native*.so ../../backend/
sudo systemctl restart jtzero
```

### Оновлення Python залежностей

```bash
cd ~/jt-zero/backend
source venv/bin/activate
pip install fastapi uvicorn websockets psutil
sudo systemctl restart jtzero
```

### Оновлення Dashboard (frontend)

Dashboard компілюється на комп'ютері (не на Pi):

```bash
# На комп'ютері:
cd frontend
yarn install
yarn build

# Скопіювати на Pi:
scp -r build/* pi@jtzero.local:~/jt-zero/backend/static/
```

На Pi:
```bash
sudo systemctl restart jtzero
```

---

## 4. Перевірка через API (curl)

Ці команди можна виконувати на Pi або з будь-якого комп'ютера у тій самій мережі.

**На Pi:** використовуйте `http://localhost:8001`
**З комп'ютера:** використовуйте `http://jtzero.local:8001` або `http://<IP>:8001`

### Стан системи

```bash
# Здоров'я сервера
curl -s http://localhost:8001/api/health | python3 -m json.tool

# Короткий статус
curl -s http://localhost:8001/api/health | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Status: {d[\"status\"]}')
print(f'Mode: {d[\"mode\"]} (native=C++, simulator=Python)')
print(f'Uptime: {d[\"uptime\"]}s')
"
```

### Телеметрія (сенсори, позиція, батарея)

```bash
curl -s http://localhost:8001/api/state | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'--- Attitude ---')
print(f'Roll:  {d.get(\"roll\",0):.2f} deg')
print(f'Pitch: {d.get(\"pitch\",0):.2f} deg')
print(f'Yaw:   {d.get(\"yaw\",0):.2f} deg')
print(f'--- Battery ---')
print(f'Voltage: {d.get(\"battery_voltage\",0):.2f} V')
print(f'Percent: {d.get(\"battery_percent\",0):.0f}%')
print(f'--- Baro ---')
print(f'Pressure: {d.get(\"baro\",{}).get(\"pressure\",0):.1f} hPa')
print(f'Altitude: {d.get(\"baro\",{}).get(\"altitude\",0):.1f} m')
print(f'Temp:     {d.get(\"baro\",{}).get(\"temperature\",0):.1f} C')
print(f'--- GPS ---')
print(f'Lat: {d.get(\"gps\",{}).get(\"lat\",0):.6f}')
print(f'Lon: {d.get(\"gps\",{}).get(\"lon\",0):.6f}')
print(f'Sats: {d.get(\"gps\",{}).get(\"satellites\",0)}')
"
```

### MAVLink з'єднання

```bash
curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'--- MAVLink ---')
print(f'State:   {d[\"state\"]}')
print(f'FC:      {d[\"fc_firmware\"]} ({d[\"fc_type\"]})')
print(f'Armed:   {d[\"fc_armed\"]}')
print(f'--- Messages ---')
print(f'Sent:    {d[\"messages_sent\"]}')
print(f'Recv:    {d[\"messages_received\"]}')
print(f'Errors:  {d[\"errors\"]}')
print(f'Link Q:  {d[\"link_quality\"]:.0%}')
print(f'--- VO Messages Sent ---')
print(f'Vision:  {d[\"vision_pos_sent\"]}')
print(f'Odom:    {d[\"odometry_sent\"]}')
print(f'Flow:    {d[\"optical_flow_sent\"]}')
"
```

### Сенсори та режими

```bash
# Режими сенсорів (mavlink / hardware / simulated)
curl -s http://localhost:8001/api/sensors | python3 -c "
import sys,json; d=json.load(sys.stdin)
for k in ['imu','baro','gps','rangefinder','optical_flow']:
    print(f'{k:15s} = {d.get(k,\"?\")}')
hw = d.get('hw_info',{})
print(f'--- Hardware ---')
print(f'I2C: {\"Yes\" if hw.get(\"i2c_available\") else \"No\"}')
print(f'IMU: {hw.get(\"imu_model\",\"none\")} ({\"detected\" if hw.get(\"imu_detected\") else \"not found\"})')
print(f'Baro: {hw.get(\"baro_model\",\"none\")} ({\"detected\" if hw.get(\"baro_detected\") else \"not found\"})')
"
```

### Діагностика обладнання

```bash
# Кешована діагностика (швидко)
curl -s http://localhost:8001/api/diagnostics | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d['summary']
print(f'Platform:  {s[\"platform\"]}')
print(f'Camera:    {s[\"camera\"]}')
print(f'I2C:       {s[\"i2c_devices\"]} devices')
print(f'MAVLink:   {\"Connected\" if s[\"mavlink_connected\"] else \"Disconnected\"}')
print(f'Overall:   {s[\"overall\"]}')
"

# Нове сканування (повільніше, але свіжі дані)
curl -s -X POST http://localhost:8001/api/diagnostics/scan | python3 -m json.tool
```

### Системні метрики (CPU, RAM, температура)

```bash
curl -s http://localhost:8001/api/performance | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d.get('system',{})
cpu=s.get('cpu',{})
mem=s.get('memory',{})
print(f'CPU:  {cpu.get(\"total_percent\",0):.1f}%')
print(f'RAM:  {mem.get(\"used_mb\",0):.0f} / {mem.get(\"total_mb\",0):.0f} MB')
print(f'Temp: {s.get(\"temperature\",0):.1f} C')
print(f'Disk: {s.get(\"disk\",{}).get(\"used_gb\",0):.1f} / {s.get(\"disk\",{}).get(\"total_gb\",0):.1f} GB')
"
```

### Камера

```bash
# Статистика камери
curl -s http://localhost:8001/api/camera | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Type:     {d.get(\"camera_type\",\"?\")}')
print(f'Status:   {\"Open\" if d.get(\"camera_open\") else \"Closed\"}')
print(f'FPS:      {d.get(\"fps_actual\",0):.1f}')
print(f'Frames:   {d.get(\"frame_count\",0)}')
print(f'Features: {d.get(\"vo_features_tracked\",0)}/{d.get(\"vo_features_detected\",0)}')
print(f'VO valid: {d.get(\"vo_valid\",False)}')
"

# Зберегти кадр з камери
curl -s http://localhost:8001/api/camera/frame -o frame.png
```

### Команди дрону

```bash
# Arm (увімкнути мотори) -- ОБЕРЕЖНО!
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"arm"}'

# Disarm (вимкнути мотори)
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"disarm"}'

# Takeoff на 3 метри
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"takeoff","param1":3.0}'

# Landing
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"land"}'

# RTL (повернення на точку зльоту)
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"rtl"}'

# Hold (зависання на місці)
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"hold"}'

# Emergency Stop (аварійна зупинка)
curl -X POST http://localhost:8001/api/command \
  -H "Content-Type: application/json" \
  -d '{"command":"emergency"}'
```

---

## 5. Діагностика обладнання на Pi

### I2C шина (сенсори)

```bash
# Сканування I2C пристроїв
sudo i2cdetect -y 1

# Відомі адреси:
# 0x68 = MPU6050 / ICM42688P (IMU)
# 0x69 = MPU6050 (альтернативна адреса)
# 0x76 = BMP280 / DPS310 (Барометр)
# 0x77 = BMP280 (альтернативна адреса)
# 0x1E = HMC5883L (Компас)
```

### UART / MAVLink

```bash
# Перевірити що UART доступний
ls -la /dev/ttyAMA0
# Має бути: crw-rw---- 1 root dialout ...

# Перевірити що pi в групі dialout
groups pi
# Якщо ні:
sudo usermod -a -G dialout pi && sudo reboot

# Перевірити UART трафік (сирі байти)
sudo cat /dev/ttyAMA0 | xxd | head -20
# Якщо бачите дані -- MAVLink комунікація працює
```

### Камера

```bash
# Список підключених камер
rpicam-hello --list-cameras

# Тестовий знімок
rpicam-still -o test.jpg
ls -la test.jpg

# Video devices
ls -la /dev/video*
v4l2-ctl --list-devices

# Перевірити boot config
grep camera /boot/firmware/config.txt
```

### Системні ресурси

```bash
# Температура CPU (ділити на 1000 для градусів)
cat /sys/class/thermal/thermal_zone0/temp

# RAM
free -m

# Диск
df -h

# Процеси (інтерактивно)
htop

# IP адреса
hostname -I
```

### Мережа

```bash
# IP адреса Pi
hostname -I

# Перевірити підключення до мережі
ping -c 3 google.com

# Dashboard у браузері (з комп'ютера у тій самій мережі):
# http://jtzero.local:8001
# або http://<IP_АДРЕСА>:8001
```

---

## 6. Troubleshooting (вирішення проблем)

### Сервер не стартує

```bash
# 1. Перевірити логи
sudo journalctl -u jtzero -n 50 --no-pager

# 2. Тест імпорту вручну
cd ~/jt-zero/backend
source venv/bin/activate
python3 -c "from server import app; print('Server OK')"

# 3. Тест C++ модуля
python3 -c "import jtzero_native; print('C++ OK')"

# 4. Перевірити venv
ls ~/jt-zero/backend/venv/bin/uvicorn
```

### MAVLink не підключається

```bash
# 1. Перевірити UART device
ls -la /dev/ttyAMA0

# 2. Перевірити групу dialout
groups pi

# 3. Перевірити baud rate в конфігурації FC
# Має бути SERIAL4_BAUD = 115 (115200)

# 4. Перевірити проводку:
#    Pi TX (GPIO14) → FC RX
#    Pi RX (GPIO15) → FC TX
#    GND → GND
```

### Камера не працює

```bash
# 1. Перевірити підключення
rpicam-hello --list-cameras

# 2. Перевірити boot config
grep camera /boot/firmware/config.txt
# Має бути: camera_auto_detect=1

# 3. Перевірити dmesg
dmesg | grep -i "camera\|csi\|imx\|ov5647"
```

### VO не працює (VisOdom: not healthy)

```bash
# 1. Перевірити що VO повідомлення відправляються
curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Vision sent: {d[\"vision_pos_sent\"]}')
print(f'Odometry sent: {d[\"odometry_sent\"]}')
"
# Обидва лічильники мають рости кожні кілька секунд

# 2. Перевірити параметри ArduPilot:
# VISO_TYPE = 1
# EK3_SRC1_POSXY = 6
# EK3_SRC1_VELXY = 6

# 3. Перевірити якість tracking
curl -s http://localhost:8001/api/camera | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Features tracked: {d.get(\"vo_features_tracked\",0)}')
print(f'Features detected: {d.get(\"vo_features_detected\",0)}')
print(f'VO valid: {d.get(\"vo_valid\",False)}')
"
# Треба мінімум 30 tracked features
```

### ArduPilot Pre-Arm помилки

```bash
# "Rangefinder 1: No Data"
# → В Mission Planner встановити: RNGFND1_TYPE = 0

# "Battery 1 below minimum arming voltage"
# → Зарядити батарею, або для тесту: BATT_ARM_VOLT = 0
# УВАГА: не літайте з BATT_ARM_VOLT = 0!

# "VisOdom: not healthy"
# → Перевірити що JT-Zero запущений і VO лічильники ростуть (див. вище)
```

---

## 7. Корисні однорядкові команди

```bash
# Повний статус одним рядком
curl -s http://localhost:8001/api/health | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'{d[\"status\"]} | {d[\"mode\"]} | uptime {d[\"uptime\"]}s')"

# MAVLink стан одним рядком
curl -s http://localhost:8001/api/mavlink | python3 -c "import sys,json;d=json.load(sys.stdin);print(f'{d[\"state\"]} | TX:{d[\"messages_sent\"]} RX:{d[\"messages_received\"]} | VO:{d[\"vision_pos_sent\"]} Odom:{d[\"odometry_sent\"]}')"

# CPU + RAM + Temp одним рядком
curl -s http://localhost:8001/api/performance | python3 -c "import sys,json;d=json.load(sys.stdin);s=d.get('system',{});print(f'CPU:{s.get(\"cpu\",{}).get(\"total_percent\",0):.0f}% RAM:{s.get(\"memory\",{}).get(\"used_mb\",0):.0f}MB Temp:{s.get(\"temperature\",0):.0f}C')"
```

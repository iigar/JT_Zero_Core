# JT-Zero — Команди для взаємодії з системою

## Керування сервісом

```bash
# Перезапуск (після оновлень)
sudo systemctl restart jtzero

# Зупинити
sudo systemctl stop jtzero

# Запустити
sudo systemctl start jtzero

# Статус
sudo systemctl status jtzero

# Логи в реальному часі (Ctrl+C для виходу)
journalctl -u jtzero -f

# Останні 50 рядків логу
sudo journalctl -u jtzero -n 50 --no-pager
```

---

## Перевірка через API (curl)

### Загальний стан
```bash
# Здоров'я сервера
curl -s http://localhost:8001/api/health | python3 -m json.tool

# Повна телеметрія
curl -s http://localhost:8001/api/state | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Roll: {d.get(\"roll\",0):.1f}, Pitch: {d.get(\"pitch\",0):.1f}, Yaw: {d.get(\"yaw\",0):.1f}')
print(f'Battery: {d.get(\"battery_voltage\",0):.2f}V')
print(f'Baro: {d.get(\"baro\",{}).get(\"pressure\",0):.1f} hPa, Temp: {d.get(\"baro\",{}).get(\"temperature\",0):.1f}C')
print(f'IMU valid: {d.get(\"imu\",{}).get(\"valid\",False)}')
"
```

### MAVLink з'єднання
```bash
curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'State: {d[\"state\"]}')
print(f'FC: {d[\"fc_firmware\"]} ({d[\"fc_type\"]})')
print(f'Sent: {d[\"messages_sent\"]}, Recv: {d[\"messages_received\"]}')
print(f'Vision: {d[\"vision_pos_sent\"]}, Odom: {d[\"odometry_sent\"]}, Flow: {d[\"optical_flow_sent\"]}')
print(f'Link: {d[\"link_quality\"]:.0%}, Errors: {d[\"errors\"]}')
print(f'Battery: {d[\"fc_telemetry\"][\"battery_voltage\"]:.2f}V ({d[\"fc_telemetry\"][\"battery_remaining\"]}%)')
"
```

### Сенсори та діагностика
```bash
# Режими сенсорів
curl -s http://localhost:8001/api/sensors | python3 -m json.tool

# Діагностика обладнання
curl -s http://localhost:8001/api/diagnostics | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d['summary']
print(f'Platform: {s[\"platform\"]}')
print(f'Camera: {s[\"camera\"]}')
print(f'I2C: {s[\"i2c_devices\"]} devices')
print(f'MAVLink: {\"OK\" if s[\"mavlink_connected\"] else \"N/A\"}')
print(f'Overall: {s[\"overall\"]}')
"

# Запустити нове сканування обладнання
curl -s -X POST http://localhost:8001/api/diagnostics/scan | python3 -m json.tool

# Системні метрики (CPU, RAM, temp)
curl -s http://localhost:8001/api/performance | python3 -c "
import sys,json; d=json.load(sys.stdin)
s=d.get('system',{})
print(f'CPU: {s.get(\"cpu\",{}).get(\"total_percent\",0)}%')
print(f'RAM: {s.get(\"memory\",{}).get(\"used_mb\",0)}/{s.get(\"memory\",{}).get(\"total_mb\",0)} MB')
print(f'Temp: {s.get(\"temperature\",0)}C')
"
```

---

## Збірка та оновлення

### Оновлення з GitHub
```bash
cd ~/jt-zero && git pull
cd jt-zero/build && make -j4
cp jtzero_native*.so ../../backend/
cd ~/jt-zero && cp -r frontend/build/* backend/static/
sudo systemctl restart jtzero
```

### Повна перезбірка C++ (після зміни cmake або headers)
```bash
cd ~/jt-zero/jt-zero
rm -rf build && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release ..
make -j4
cp jtzero_native*.so ../../backend/
sudo systemctl restart jtzero
```

### Оновлення Python залежностей
```bash
cd ~/jt-zero/backend
source venv/bin/activate
pip install <package_name>
sudo systemctl restart jtzero
```

---

## Діагностика обладнання

### I2C шина
```bash
# Сканування I2C пристроїв
sudo i2cdetect -y 1

# Відомі адреси:
# 0x68 = MPU6050 / ICM42688P (IMU)
# 0x76 = BMP280 / DPS310 (Baro)
# 0x1E = HMC5883L (Compass)
# 0x36 = CSI Camera controller
```

### UART / MAVLink
```bash
# Перевірити що UART активний
ls -la /dev/ttyAMA0

# Моніторинг UART трафіку (raw bytes)
sudo cat /dev/ttyAMA0 | xxd | head -20
```

### Камера
```bash
# Список камер
rpicam-hello --list-cameras

# Тестовий знімок
rpicam-still -o test.jpg

# Перевірити video device
ls -la /dev/video*
v4l2-ctl --list-devices
```

### GPIO
```bash
# Перевірити GPIO стан
cat /sys/class/gpio/export
ls /sys/class/gpio/
```

### Системні ресурси
```bash
# CPU температура
cat /sys/class/thermal/thermal_zone0/temp

# RAM
free -m

# Диск
df -h

# Процеси
htop
```

---

## Мережа та доступ

```bash
# IP адреса Pi
hostname -I

# Dashboard у браузері (з комп'ютера у тій самій мережі)
# http://jtzero.local:8001
# або http://<IP_АДРЕСА>:8001

# SSH доступ
ssh pi@jtzero.local
```

---

## Troubleshooting

### Сервер не стартує
```bash
# Перевірити логи
sudo journalctl -u jtzero -n 50 --no-pager

# Тест імпорту вручну
cd ~/jt-zero/backend && source venv/bin/activate
python3 -c "from server import app; print('OK')"
```

### MAVLink не підключається
```bash
# Перевірити UART
ls -la /dev/ttyAMA0
# Має бути: crw-rw---- 1 root dialout ...

# Перевірити що pi в групі dialout
groups pi
# Якщо ні: sudo usermod -a -G dialout pi && sudo reboot

# Перевірити baud rate в конфігурації FC
# Має бути SERIAL4_BAUD = 115 (115200)
```

### Камера не працює
```bash
# Перевірити підключення
rpicam-hello --list-cameras

# Перевірити boot config
grep camera /boot/firmware/config.txt

# Перевірити dmesg
dmesg | grep -i "camera\|csi\|imx"
```

### VO не працює (VisOdom: not healthy)
```bash
# Перевірити що повідомлення відправляються
curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f'Vision sent: {d[\"vision_pos_sent\"]}')
"
# Має рости кожні кілька секунд

# Перевірити параметри ArduPilot:
# VISO_TYPE = 1
# EK3_SRC1_POSXY = 6
```

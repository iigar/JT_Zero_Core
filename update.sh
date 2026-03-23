#!/bin/bash
# ============================================================================
# JT-Zero — Швидке оновлення
# ============================================================================
# Використання:  cd ~/jt-zero && ./update.sh
# ============================================================================

set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

JT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CPP_DIR="$JT_DIR/jt-zero"
BACKEND_DIR="$JT_DIR/backend"

# ─── Визначення платформи ───────────────────────────────────
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
CORES=$(nproc)
PI_MODEL="Unknown"
[ -f /proc/device-tree/model ] && PI_MODEL=$(cat /proc/device-tree/model | tr -d '\0')

# Підібрати make -j залежно від RAM
if [ "$RAM_MB" -lt 600 ]; then
    JOBS=2    # Pi Zero 2W (512MB) — RAM bottleneck
elif [ "$RAM_MB" -lt 1500 ]; then
    JOBS=3    # Pi 3B (1GB)
else
    JOBS=$CORES  # Pi 4/5 (2-8GB) — повна швидкість
fi

echo -e "${CYAN}${BOLD}JT-Zero Update${NC}"
echo -e "  Pi:    $PI_MODEL"
echo -e "  RAM:   ${RAM_MB}MB, Cores: ${CORES}, Jobs: ${JOBS}"
echo ""

# ─── Git pull (якщо є .git) ─────────────────────────────────
cd "$JT_DIR"
if [ -d ".git" ]; then
    echo -e "${CYAN}[1/4]${NC} git pull..."
    git pull
else
    echo -e "${YELLOW}[1/4]${NC} Немає .git — пропуск git pull"
fi

# ─── Збірка C++ ─────────────────────────────────────────────
echo -e "${CYAN}[2/4]${NC} make -j${JOBS}..."
cd "$CPP_DIR"
mkdir -p build && cd build

# cmake тільки якщо ще не було
if [ ! -f Makefile ]; then
    cmake -DCMAKE_BUILD_TYPE=Release .. 2>&1 | tail -5
fi

make -j"$JOBS" 2>&1 | tail -3

# ─── Копіювання .so ─────────────────────────────────────────
echo -e "${CYAN}[3/4]${NC} Копіювання модуля..."
cp jtzero_native*.so "$BACKEND_DIR/"

# ─── Перезапуск сервісу ─────────────────────────────────────
echo -e "${CYAN}[4/4]${NC} Перезапуск сервісу..."
sudo systemctl restart jtzero

# ─── Перевірка ──────────────────────────────────────────────
echo ""
echo -e "  Очікування запуску (15с)..."
sleep 15

if curl -s --max-time 5 http://localhost:8001/api/health > /dev/null 2>&1; then
    # Повна діагностика
    curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f\"  State:  {d['state']}\")
print(f\"  Baud:   {d.get('transport_info','?')}\")
print(f\"  HB:     {d.get('heartbeats_received',0)}\")
print(f\"  Msgs:   TX={d['messages_sent']} RX={d['messages_received']}\")
print(f\"  FC:     {d['fc_type']} {d['fc_firmware']}\")
print(f\"  CRC err:{d.get('crc_errors',0)}\")
" 2>/dev/null || echo -e "  ${YELLOW}MAVLink API недоступний${NC}"
    
    echo ""
    echo -e "  ${GREEN}${BOLD}Оновлення завершено!${NC}"
else
    echo -e "  ${YELLOW}Сервіс ще стартує. Перевірте: sudo systemctl status jtzero${NC}"
fi

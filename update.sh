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
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m'

JT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CPP_DIR="$JT_DIR/jt-zero"
BACKEND_DIR="$JT_DIR/backend"
FRONTEND_DIR="$JT_DIR/frontend"

# ─── Визначення платформи ───────────────────────────────────
RAM_MB=$(free -m | awk '/Mem:/{print $2}')
CORES=$(nproc)
PI_MODEL="Unknown"
[ -f /proc/device-tree/model ] && PI_MODEL=$(cat /proc/device-tree/model | tr -d '\0')

if [ "$RAM_MB" -lt 600 ]; then
    JOBS=2
elif [ "$RAM_MB" -lt 1500 ]; then
    JOBS=3
else
    JOBS=$CORES
fi

echo -e "${CYAN}${BOLD}JT-Zero Update${NC}"
echo -e "  Pi:    $PI_MODEL"
echo -e "  RAM:   ${RAM_MB}MB, Cores: ${CORES}, Jobs: ${JOBS}"
echo ""

# ─── [1/5] Git pull ──────────────────────────────────────────
cd "$JT_DIR"
if [ -d ".git" ]; then
    echo -e "${CYAN}[1/5]${NC} git pull..."
    git pull || echo -e "${YELLOW}  git pull не вдався, продовжуємо...${NC}"
else
    echo -e "${YELLOW}[1/5]${NC} Немає .git — пропуск"
fi

# ─── [2/5] Збірка C++ ───────────────────────────────────────
echo -e "${CYAN}[2/5]${NC} Збірка C++ (make -j${JOBS})..."
cd "$CPP_DIR"
mkdir -p build && cd build

# Перевірити чи CMake кеш вказує на правильний шлях
NEED_CMAKE=false
if [ ! -f Makefile ]; then
    NEED_CMAKE=true
elif [ -f CMakeCache.txt ]; then
    CACHED_SRC=$(grep "CMAKE_HOME_DIRECTORY" CMakeCache.txt 2>/dev/null | cut -d= -f2)
    if [ "$CACHED_SRC" != "$CPP_DIR" ]; then
        echo -e "  ${YELLOW}CMake кеш застарів ($CACHED_SRC != $CPP_DIR), перебілд...${NC}"
        rm -rf *
        NEED_CMAKE=true
    fi
fi

if [ "$NEED_CMAKE" = true ]; then
    echo -e "  Запуск cmake..."
    cmake -DCMAKE_BUILD_TYPE=Release .. 2>&1 | tail -5
fi

make -j"$JOBS" 2>&1 | tail -5

# ─── [3/5] Копіювання .so ───────────────────────────────────
echo -e "${CYAN}[3/5]${NC} Копіювання модуля..."
if ls jtzero_native*.so 1>/dev/null 2>&1; then
    cp jtzero_native*.so "$BACKEND_DIR/"
    echo -e "  ${GREEN}OK${NC}"
else
    echo -e "  ${YELLOW}Модуль не знайдено (pybind11?)${NC}"
fi

# ─── [4/5] Збірка фронтенду ─────────────────────────────────
echo -e "${CYAN}[4/5]${NC} Збірка фронтенду..."
if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
    cd "$FRONTEND_DIR"
    
    # Визначити пакетний менеджер (yarn або npm)
    if command -v yarn &>/dev/null; then
        PKG="yarn"
        PKG_INSTALL="yarn install --production=false"
        PKG_BUILD="yarn build"
    elif command -v npm &>/dev/null; then
        PKG="npm"
        PKG_INSTALL="npm install"
        PKG_BUILD="npm run build"
    else
        echo -e "  ${RED}Ні yarn ні npm не знайдено!${NC}"
        echo -e "  Встановіть: ${BOLD}sudo apt install nodejs npm${NC}"
        PKG=""
    fi
    
    if [ -n "$PKG" ]; then
        # Встановити залежності якщо node_modules відсутній
        if [ ! -d "node_modules" ]; then
            echo -e "  Встановлення залежностей ($PKG)..."
            $PKG_INSTALL 2>&1 | tail -3
        fi
        
        # Перевірити чи потрібно перебілдити
        BUILD_NEEDED=false
        if [ ! -d "build" ]; then
            BUILD_NEEDED=true
        elif [ "$(find src/ -newer build/index.html -print -quit 2>/dev/null)" ]; then
            BUILD_NEEDED=true
        fi
        
        if [ "$BUILD_NEEDED" = true ]; then
            echo -e "  $PKG build..."
            # На Pi фронтенд обслуговується з того ж сервера — порожній URL
            export REACT_APP_BACKEND_URL=""
            # На Pi Zero обмежити RAM для Node
            if [ "$RAM_MB" -lt 600 ]; then
                NODE_OPTIONS="--max-old-space-size=256" $PKG_BUILD 2>&1 | tail -3
            else
                $PKG_BUILD 2>&1 | tail -3
            fi
            # Копіювати білд в backend/static/ (звідки server.py обслуговує)
            echo -e "  Копіювання в backend/static/..."
            rm -rf "$BACKEND_DIR/static"
            cp -r build "$BACKEND_DIR/static"
            echo -e "  ${GREEN}Frontend збілдено та скопійовано!${NC}"
        else
            echo -e "  ${GREEN}Frontend актуальний, пропуск${NC}"
        fi
    fi
else
    echo -e "  ${YELLOW}Фронтенд не знайдено${NC}"
fi

# ─── [5/5] Перезапуск сервісу ────────────────────────────────
echo -e "${CYAN}[5/5]${NC} Перезапуск сервісу..."
sudo systemctl restart jtzero

echo ""
echo -e "  Очікування запуску (15с)..."
sleep 15

if curl -s --max-time 5 http://localhost:8001/api/health > /dev/null 2>&1; then
    curl -s http://localhost:8001/api/mavlink | python3 -c "
import sys,json; d=json.load(sys.stdin)
print(f\"  State:  {d['state']}\")
print(f\"  Baud:   {d.get('transport_info','?')}\")
print(f\"  HB:     {d.get('heartbeats_received',0)}\")
print(f\"  Msgs:   TX={d['messages_sent']} RX={d['messages_received']}\")
print(f\"  FC:     {d['fc_type']} {d['fc_firmware']}\")
print(f\"  CRC err:{d.get('crc_errors',0)}\")
" 2>/dev/null || echo -e "  ${YELLOW}MAVLink API недоступний${NC}"
    
    # Перевірити камери
    curl -s http://localhost:8001/api/cameras | python3 -c "
import sys,json
try:
    cams=json.load(sys.stdin)
    print(f'  Cameras: {len(cams)}')
    for c in cams:
        status = 'ACTIVE' if c.get('active') else 'OFF'
        print(f\"    {c['slot']}: {c.get('label','?')} [{status}]\")
except: pass
" 2>/dev/null

    echo ""
    echo -e "  ${GREEN}${BOLD}Оновлення завершено!${NC}"
else
    echo -e "  ${YELLOW}Сервіс ще стартує. Перевірте: sudo systemctl status jtzero${NC}"
fi

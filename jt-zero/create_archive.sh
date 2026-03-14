#!/bin/bash
# ═══════════════════════════════════════════════════════════
# JT-Zero: Скрипт створення установочного архіву
# ═══════════════════════════════════════════════════════════
#
# Цей скрипт збирає ВСІ потрібні файли проєкту в один ZIP-архів,
# який можна перенести на Raspberry Pi через SCP або USB флешку.
#
# Використання:
#   chmod +x create_archive.sh
#   ./create_archive.sh
#
# Результат: файл jt-zero-install.zip у поточній папці
# ═══════════════════════════════════════════════════════════

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
ARCHIVE_NAME="jt-zero-install"
TEMP_DIR="/tmp/${ARCHIVE_NAME}"

echo "=== JT-Zero Archive Creator ==="
echo "Project root: ${PROJECT_ROOT}"
echo ""

# Clean temp
rm -rf "${TEMP_DIR}"
mkdir -p "${TEMP_DIR}/jt-zero"

echo "[1/5] Copying C++ core..."
cp -r "${SCRIPT_DIR}/include" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/core" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/sensors" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/drivers" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/camera" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/mavlink" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/api" "${TEMP_DIR}/jt-zero/"
cp -r "${SCRIPT_DIR}/simulator" "${TEMP_DIR}/jt-zero/"
cp "${SCRIPT_DIR}/main.cpp" "${TEMP_DIR}/jt-zero/"
cp "${SCRIPT_DIR}/CMakeLists.txt" "${TEMP_DIR}/jt-zero/"
[ -f "${SCRIPT_DIR}/toolchain-pi-zero.cmake" ] && cp "${SCRIPT_DIR}/toolchain-pi-zero.cmake" "${TEMP_DIR}/jt-zero/"

echo "[2/5] Copying backend..."
mkdir -p "${TEMP_DIR}/backend"
cp "${PROJECT_ROOT}/backend/server.py" "${TEMP_DIR}/backend/"
cp "${PROJECT_ROOT}/backend/native_bridge.py" "${TEMP_DIR}/backend/"
cp "${PROJECT_ROOT}/backend/simulator.py" "${TEMP_DIR}/backend/"
cp "${PROJECT_ROOT}/backend/system_metrics.py" "${TEMP_DIR}/backend/"
cp "${PROJECT_ROOT}/backend/diagnostics.py" "${TEMP_DIR}/backend/"
# Copy .so if exists (pre-built for current platform)
if ls "${PROJECT_ROOT}/backend"/jtzero_native*.so 1>/dev/null 2>&1; then
    cp "${PROJECT_ROOT}/backend"/jtzero_native*.so "${TEMP_DIR}/backend/"
    echo "   (included pre-built .so for current platform)"
fi

echo "[3/5] Copying frontend build..."
if [ -d "${PROJECT_ROOT}/backend/static" ] && [ -f "${PROJECT_ROOT}/backend/static/index.html" ]; then
    cp -r "${PROJECT_ROOT}/backend/static" "${TEMP_DIR}/backend/static"
    echo "   (included pre-built Dashboard)"
elif [ -d "${PROJECT_ROOT}/frontend/build" ] && [ -f "${PROJECT_ROOT}/frontend/build/index.html" ]; then
    mkdir -p "${TEMP_DIR}/backend/static"
    cp -r "${PROJECT_ROOT}/frontend/build/"* "${TEMP_DIR}/backend/static/"
    echo "   (copied from frontend/build)"
else
    echo "   WARNING: No pre-built Dashboard found. Build it first: cd frontend && yarn build"
fi

echo "[4/5] Copying documentation..."
for doc in README.md DEPLOYMENT.md SYSTEM.md COMMANDS.md FC_CONNECTION.md; do
    [ -f "${SCRIPT_DIR}/${doc}" ] && cp "${SCRIPT_DIR}/${doc}" "${TEMP_DIR}/jt-zero/"
done
[ -f "${PROJECT_ROOT}/README.md" ] && cp "${PROJECT_ROOT}/README.md" "${TEMP_DIR}/"

# Create install script
cat > "${TEMP_DIR}/install.sh" << 'INSTALL_EOF'
#!/bin/bash
# ═══════════════════════════════════════════════════
# JT-Zero Quick Installer
# Запустіть цей скрипт на Raspberry Pi:
#   chmod +x install.sh
#   ./install.sh
# ═══════════════════════════════════════════════════

set -e
echo ""
echo "=== JT-Zero Installer ==="
echo ""

INSTALL_DIR="$HOME/jt-zero"

# Check if already installed
if [ -d "$INSTALL_DIR" ]; then
    echo "JT-Zero already installed at $INSTALL_DIR"
    read -p "Overwrite? (y/n): " answer
    if [ "$answer" != "y" ]; then
        echo "Cancelled."
        exit 0
    fi
    rm -rf "$INSTALL_DIR"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[1/6] Copying files..."
mkdir -p "$INSTALL_DIR"
cp -r "$SCRIPT_DIR"/* "$INSTALL_DIR/"
rm -f "$INSTALL_DIR/install.sh"

echo "[2/6] Installing system packages..."
sudo apt update && sudo apt install -y \
  cmake g++ python3-dev python3-pip python3-venv pybind11-dev \
  libatomic1 i2c-tools 2>/dev/null || echo "Some packages may have failed - continuing"

echo "[3/6] Building C++ core..."
cd "$INSTALL_DIR/jt-zero"
# Fix for GCC 14
grep -q "<cstdlib>" main.cpp || sed -i '10a #include <cstdlib>' main.cpp
rm -rf build && mkdir build && cd build
cmake -DCMAKE_BUILD_TYPE=Release .. 2>&1
make -j$(nproc) 2>&1

echo "[4/6] Copying C++ module to backend..."
cp "$INSTALL_DIR"/jt-zero/build/jtzero_native*.so "$INSTALL_DIR/backend/" 2>/dev/null || echo "Note: C++ module may need manual copy"

echo "[5/6] Setting up Python environment..."
cd "$INSTALL_DIR/backend"
python3 -m venv venv
source venv/bin/activate
pip install fastapi uvicorn websockets psutil 2>&1

echo "[6/6] Testing..."
python3 -c "import jtzero_native; print('C++ module: OK')" 2>/dev/null || echo "C++ module: using Python simulator (rebuild may be needed)"
python3 -c "from server import app; print('Server import: OK')"

echo ""
echo "=== Installation Complete ==="
echo ""
echo "To start manually:"
echo "  cd ~/jt-zero/backend"
echo "  source venv/bin/activate"
echo "  uvicorn server:app --host 0.0.0.0 --port 8001"
echo ""
echo "To set up auto-start, run:"
echo "  sudo tee /etc/systemd/system/jtzero.service << 'EOF'"
echo "  [Unit]"
echo "  Description=JT-Zero Runtime"
echo "  After=network.target"
echo "  [Service]"
echo "  Type=simple"
echo "  User=pi"
echo "  WorkingDirectory=/home/pi/jt-zero/backend"
echo "  Environment=PYTHONPATH=/home/pi/jt-zero"
echo "  ExecStart=/home/pi/jt-zero/backend/venv/bin/uvicorn server:app --host 0.0.0.0 --port 8001"
echo "  Restart=always"
echo "  RestartSec=5"
echo "  [Install]"
echo "  WantedBy=multi-user.target"
echo "  EOF"
echo ""
echo "  sudo systemctl daemon-reload && sudo systemctl enable jtzero && sudo systemctl start jtzero"
echo ""
echo "Dashboard: http://$(hostname -I | awk '{print $1}'):8001"
echo ""
INSTALL_EOF

chmod +x "${TEMP_DIR}/install.sh"

echo "[5/5] Creating ZIP archive..."
cd /tmp
rm -f "${ARCHIVE_NAME}.zip"
zip -r "${ARCHIVE_NAME}.zip" "${ARCHIVE_NAME}/" -x "*/build/*" "*/__pycache__/*" "*/node_modules/*" "*/.git/*"

# Move to project root
mv "/tmp/${ARCHIVE_NAME}.zip" "${PROJECT_ROOT}/"

# Clean temp
rm -rf "${TEMP_DIR}"

ARCHIVE_SIZE=$(du -sh "${PROJECT_ROOT}/${ARCHIVE_NAME}.zip" | cut -f1)

echo ""
echo "=== Archive Created ==="
echo "File: ${PROJECT_ROOT}/${ARCHIVE_NAME}.zip"
echo "Size: ${ARCHIVE_SIZE}"
echo ""
echo "How to use:"
echo "  1. Copy to Pi: scp jt-zero-install.zip pi@jtzero.local:~/"
echo "  2. On Pi: unzip jt-zero-install.zip"
echo "  3. On Pi: cd jt-zero-install && chmod +x install.sh && ./install.sh"
echo ""

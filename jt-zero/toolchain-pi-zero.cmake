# ─────────────────────────────────────────────────────────────
# JT-Zero Cross-Compilation Toolchain for Raspberry Pi Zero 2 W
# Target: aarch64-linux-gnu (ARM Cortex-A53)
# ─────────────────────────────────────────────────────────────
# Usage:
#   mkdir build-pi && cd build-pi
#   cmake -DCMAKE_TOOLCHAIN_FILE=../toolchain-pi-zero.cmake ..
#   make -j$(nproc)
#
# Prerequisites (Ubuntu/Debian host):
#   sudo apt install gcc-aarch64-linux-gnu g++-aarch64-linux-gnu
#   sudo apt install cmake ninja-build
#
# For Raspberry Pi OS (32-bit), use arm-linux-gnueabihf instead.
# ─────────────────────────────────────────────────────────────

set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

# Cross-compiler paths
set(CMAKE_C_COMPILER aarch64-linux-gnu-gcc)
set(CMAKE_CXX_COMPILER aarch64-linux-gnu-g++)

# Sysroot (optional, set if cross-compiling with Pi sysroot)
# set(CMAKE_SYSROOT /path/to/pi-sysroot)
# set(CMAKE_FIND_ROOT_PATH /path/to/pi-sysroot)

# Search rules: headers/libs from target, programs from host
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)

# Pi Zero 2 W optimization flags (Cortex-A53, ARMv8-A)
set(PI_ZERO_FLAGS "-mcpu=cortex-a53 -mtune=cortex-a53 -O2 -ffast-math")
set(CMAKE_C_FLAGS_INIT "${PI_ZERO_FLAGS}")
set(CMAKE_CXX_FLAGS_INIT "${PI_ZERO_FLAGS}")

# Disable pybind11 for cross-compilation (no Python on host for target)
set(JT_ZERO_CROSS_COMPILE ON CACHE BOOL "Cross-compiling for Pi" FORCE)

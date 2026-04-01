#pragma once
// ═══════════════════════════════════════════════════════════
// JT-Zero ARM NEON Accelerated Functions
// ═══════════════════════════════════════════════════════════
// SIMD-optimized hot paths for Visual Odometry on Cortex-A53.
// Falls back to scalar implementations on x86/x64 for development.
//
// Usage:
//   #include "neon_accel.h"
//   float brightness = neon::frame_brightness(data, width * height);
//   neon::sobel_row_abs(row_above, row_center, row_below, gx_out, gy_out, count);

#include <cstdint>
#include <cstddef>
#include <cmath>

#ifdef __ARM_NEON
#include <arm_neon.h>
#define JT_NEON_AVAILABLE 1
#else
#define JT_NEON_AVAILABLE 0
#endif

namespace neon {

// ─── Frame Brightness (Mean Pixel Value) ─────────────────
// Used by VO monitor to detect darkness → fallback trigger.
// NEON processes 16 pixels per iteration (~8x scalar speedup).
inline float frame_brightness(const uint8_t* data, size_t pixel_count) {
#if JT_NEON_AVAILABLE
    uint64_t total = 0;
    size_t i = 0;
    
    // Process 16 bytes at a time
    uint32x4_t acc = vdupq_n_u32(0);
    for (; i + 16 <= pixel_count; i += 16) {
        uint8x16_t pixels = vld1q_u8(data + i);
        // Widen 8→16 and pairwise add into 32-bit accumulator
        uint16x8_t sum16 = vpaddlq_u8(pixels);
        acc = vpadalq_u16(acc, sum16);
    }
    // Horizontal reduce: sum all 4 lanes
    total = vaddlvq_u32(acc);
    
    // Handle remaining pixels
    for (; i < pixel_count; ++i) {
        total += data[i];
    }
    return pixel_count > 0 ? static_cast<float>(total) / static_cast<float>(pixel_count) : 0.0f;
#else
    // Scalar fallback
    uint64_t total = 0;
    for (size_t i = 0; i < pixel_count; ++i) {
        total += data[i];
    }
    return pixel_count > 0 ? static_cast<float>(total) / static_cast<float>(pixel_count) : 0.0f;
#endif
}

// ─── Sobel 3x3 Gradient (Batch Row) ─────────────────────
// Computes |Gx| and |Gy| for a row of pixels simultaneously.
// Used in Shi-Tomasi structure tensor and LK gradient.
// Processes 8 pixels per NEON iteration (~4x speedup).
//
// Sobel X: [-1 0 +1]   Sobel Y: [-1 -2 -1]
//          [-2 0 +2]             [ 0  0  0]
//          [-1 0 +1]             [+1 +2 +1]
inline void sobel_row(const uint8_t* row_above, const uint8_t* row_center,
                      const uint8_t* row_below, int16_t* gx_out, int16_t* gy_out,
                      int count) {
#if JT_NEON_AVAILABLE
    int i = 0;
    for (; i + 8 <= count; i += 8) {
        // Load 3 rows: 10 bytes each (need left and right neighbors)
        // row_above[i-1..i+8], row_center[i-1..i+8], row_below[i-1..i+8]
        uint8x8_t a_left  = vld1_u8(row_above + i - 1);
        uint8x8_t a_right = vld1_u8(row_above + i + 1);
        uint8x8_t a_mid   = vld1_u8(row_above + i);
        
        uint8x8_t c_left  = vld1_u8(row_center + i - 1);
        uint8x8_t c_right = vld1_u8(row_center + i + 1);
        
        uint8x8_t b_left  = vld1_u8(row_below + i - 1);
        uint8x8_t b_right = vld1_u8(row_below + i + 1);
        uint8x8_t b_mid   = vld1_u8(row_below + i);
        
        // Widen to 16-bit for signed arithmetic
        int16x8_t al = vreinterpretq_s16_u16(vmovl_u8(a_left));
        int16x8_t ar = vreinterpretq_s16_u16(vmovl_u8(a_right));
        int16x8_t am = vreinterpretq_s16_u16(vmovl_u8(a_mid));
        int16x8_t cl = vreinterpretq_s16_u16(vmovl_u8(c_left));
        int16x8_t cr = vreinterpretq_s16_u16(vmovl_u8(c_right));
        int16x8_t bl = vreinterpretq_s16_u16(vmovl_u8(b_left));
        int16x8_t br = vreinterpretq_s16_u16(vmovl_u8(b_right));
        int16x8_t bm = vreinterpretq_s16_u16(vmovl_u8(b_mid));
        
        // Gx = -a_left + a_right - 2*c_left + 2*c_right - b_left + b_right
        int16x8_t gx = vsubq_s16(ar, al);               // a_right - a_left
        gx = vaddq_s16(gx, vshlq_n_s16(vsubq_s16(cr, cl), 1)); // + 2*(c_right - c_left)
        gx = vaddq_s16(gx, vsubq_s16(br, bl));           // + b_right - b_left
        
        // Gy = -a_left - 2*a_mid - a_right + b_left + 2*b_mid + b_right
        int16x8_t gy = vsubq_s16(bl, al);                // b_left - a_left
        gy = vaddq_s16(gy, vshlq_n_s16(vsubq_s16(bm, am), 1)); // + 2*(b_mid - a_mid)
        gy = vaddq_s16(gy, vsubq_s16(br, ar));            // + b_right - a_right
        
        vst1q_s16(gx_out + i, gx);
        vst1q_s16(gy_out + i, gy);
    }
    // Scalar tail
    for (; i < count; ++i) {
        gx_out[i] = static_cast<int16_t>(
            -row_above[i-1] + row_above[i+1]
            - 2*row_center[i-1] + 2*row_center[i+1]
            - row_below[i-1] + row_below[i+1]);
        gy_out[i] = static_cast<int16_t>(
            -row_above[i-1] - 2*row_above[i] - row_above[i+1]
            + row_below[i-1] + 2*row_below[i] + row_below[i+1]);
    }
#else
    for (int i = 0; i < count; ++i) {
        gx_out[i] = static_cast<int16_t>(
            -row_above[i-1] + row_above[i+1]
            - 2*row_center[i-1] + 2*row_center[i+1]
            - row_below[i-1] + row_below[i+1]);
        gy_out[i] = static_cast<int16_t>(
            -row_above[i-1] - 2*row_above[i] - row_above[i+1]
            + row_below[i-1] + 2*row_below[i] + row_below[i+1]);
    }
#endif
}

// ─── Structure Tensor Accumulation (Shi-Tomasi) ──────────
// Accumulates Sxx, Syy, Sxy over a window for eigenvalue computation.
// Used in corner detection for thermal/low-contrast images.
inline void structure_tensor_5x5(const uint8_t* img, int x, int y, uint16_t w,
                                  float& sxx, float& syy, float& sxy) {
    sxx = syy = sxy = 0;
    for (int dy = -2; dy <= 2; ++dy) {
        const uint8_t* r0 = img + (y + dy - 1) * w + x;
        const uint8_t* r1 = img + (y + dy) * w + x;
        const uint8_t* r2 = img + (y + dy + 1) * w + x;
        for (int dx = -2; dx <= 2; ++dx) {
            int px = dx;
            float gx = static_cast<float>(-r0[px-1]+r0[px+1] -2*r1[px-1]+2*r1[px+1] -r2[px-1]+r2[px+1]);
            float gy = static_cast<float>(-r0[px-1]-2*r0[px]-r0[px+1] +r2[px-1]+2*r2[px]+r2[px+1]);
            sxx += gx * gx;
            syy += gy * gy;
            sxy += gx * gy;
        }
    }
}

// ─── Batch Absolute Difference (SAD) ─────────────────────
// Sum of absolute differences between two patches.
// Used for feature matching validation.
inline uint32_t sad_8x8(const uint8_t* a, const uint8_t* b,
                         uint16_t stride_a, uint16_t stride_b) {
#if JT_NEON_AVAILABLE
    uint32x4_t acc = vdupq_n_u32(0);
    for (int row = 0; row < 8; ++row) {
        uint8x8_t va = vld1_u8(a + row * stride_a);
        uint8x8_t vb = vld1_u8(b + row * stride_b);
        uint16x8_t diff = vabdl_u8(va, vb);
        acc = vpadalq_u16(acc, diff);
    }
    return vaddvq_u32(acc);
#else
    uint32_t sum = 0;
    for (int row = 0; row < 8; ++row) {
        for (int col = 0; col < 8; ++col) {
            int d = static_cast<int>(a[row * stride_a + col]) - static_cast<int>(b[row * stride_b + col]);
            sum += static_cast<uint32_t>(d < 0 ? -d : d);
        }
    }
    return sum;
#endif
}

// ─── Fast Row Sum (for brightness window) ────────────────
// Sum N uint8 values. Used for sliding window brightness.
inline uint32_t row_sum(const uint8_t* data, size_t count) {
#if JT_NEON_AVAILABLE
    uint32x4_t acc = vdupq_n_u32(0);
    size_t i = 0;
    for (; i + 16 <= count; i += 16) {
        uint8x16_t v = vld1q_u8(data + i);
        uint16x8_t s16 = vpaddlq_u8(v);
        acc = vpadalq_u16(acc, s16);
    }
    uint32_t total = vaddvq_u32(acc);
    for (; i < count; ++i) total += data[i];
    return total;
#else
    uint32_t total = 0;
    for (size_t i = 0; i < count; ++i) total += data[i];
    return total;
#endif
}

} // namespace neon

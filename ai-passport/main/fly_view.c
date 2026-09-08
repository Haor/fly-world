#include "fly_view.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

const uint32_t fly_palette[16] = {
    0x182d32, 0xa9cbd0, 0x71979d, 0xecedce,
    0x9ab858, 0x668b42, 0x3c603c, 0x95704b,
    0x5e493c, 0xc99c63, 0x579daa, 0xc85843,
    0xf1ce72, 0xc0d8cc, 0x323a3b, 0x83b4bb
};

typedef struct { uint8_t *pixels; } painter_t;
static void pixel(painter_t *p, int x, int y, int c) {
    if (x < 0 || x >= FLY_VIEW_WIDTH || y < 0 || y >= FLY_VIEW_HEIGHT) return;
    int i = y * (FLY_VIEW_WIDTH / 2) + x / 2;
    if (x & 1) p->pixels[i] = (uint8_t)((p->pixels[i] & 0xf0) | c);
    else p->pixels[i] = (uint8_t)((p->pixels[i] & 0x0f) | (c << 4));
}
static void rect(painter_t *p, int x, int y, int w, int h, int c) {
    for (int j = y; j < y + h; j++) for (int i = x; i < x + w; i++) pixel(p, i, j, c);
}
static void line(painter_t *p, int x, int y, int x1, int y1, int c) {
    int dx = abs(x1 - x), sx = x < x1 ? 1 : -1;
    int dy = -abs(y1 - y), sy = y < y1 ? 1 : -1, error = dx + dy;
    for (;;) {
        pixel(p, x, y, c);
        if (x == x1 && y == y1) break;
        int twice = error * 2;
        if (twice >= dy) { error += dy; x += sx; }
        if (twice <= dx) { error += dx; y += sy; }
    }
}
static void ellipse(painter_t *p, int x, int y, int rx, int ry, int c) {
    for (int j = -ry; j <= ry; j++) for (int i = -rx; i <= rx; i++)
        if (i * i * ry * ry + j * j * rx * rx <= rx * rx * ry * ry) pixel(p, x + i, y + j, c);
}
static const uint8_t glyphs[][5] = {
    {2,5,7,5,5},{6,5,6,5,6},{3,4,4,4,3},{6,5,5,5,6},{7,4,6,4,7},{7,4,6,4,4},
    {3,4,5,5,3},{5,5,7,5,5},{7,2,2,2,7},{1,1,1,5,2},{5,5,6,5,5},{4,4,4,4,7},
    {5,7,7,5,5},{5,7,7,7,5},{2,5,5,5,2},{6,5,6,4,4},{2,5,5,3,1},{6,5,6,5,5},
    {3,4,2,1,6},{7,2,2,2,2},{5,5,5,5,7},{5,5,5,5,2},{5,5,7,7,5},{5,5,2,5,5},
    {5,5,2,2,2},{7,1,2,4,7},
    {7,5,5,5,7},{2,6,2,2,7},{6,1,2,4,7},{6,1,2,1,6},{5,5,7,1,1},
    {7,4,6,1,6},{3,4,7,5,7},{7,1,2,2,2},{7,5,7,5,7},{7,5,7,1,6}
};
static void text(painter_t *p, int x, int y, const char *s, int c, int scale) {
    for (; *s; s++, x += 4 * scale) {
        int g = *s >= 'A' && *s <= 'Z' ? *s - 'A' : *s >= '0' && *s <= '9' ? *s - '0' + 26 : -1;
        if (g >= 0) for (int row = 0; row < 5; row++) for (int col = 0; col < 3; col++)
            if (glyphs[g][row] & (4 >> col)) rect(p, x + col * scale, y + row * scale, scale, scale, c);
        if (*s == '-') rect(p, x, y + 2 * scale, 3 * scale, scale, c);
        if (*s == '.') rect(p, x + scale, y + 4 * scale, scale, scale, c);
        if (*s == '/') { pixel(p, x + 2, y, c); pixel(p, x + 1, y + 2, c); pixel(p, x, y + 4, c); }
    }
}
static void centered(painter_t *p, int y, const char *s, int c, int scale) {
    text(p, (240 - (int)strlen(s) * 4 * scale + scale) / 2, y, s, c, scale);
}

static void diamond(painter_t *p, int x, int y, int radius, int color) {
    for (int j = -radius / 2; j <= radius / 2; j++) {
        int half = radius - abs(j) * 2;
        rect(p, x - half, y + j, half * 2 + 1, 1, color);
    }
}
static void block(painter_t *p, int x, int y, int radius, int height, int top, int left, int right) {
    for (int dx = -radius; dx <= radius; dx++) {
        int edge = (radius - abs(dx)) / 2;
        rect(p, x + dx, y + edge, 1, height, dx <= 0 ? left : right);
    }
    diamond(p, x, y, radius, top);
}
static void plant(painter_t *p, int x, int y, int height) {
    rect(p, x - 2, y - height, 4, height, 8);
    rect(p, x - 2, y - height, 1, height, 9);
    block(p, x, y - height - 3, 14, 10, 4, 5, 6);
    block(p, x - 5, y - height - 9, 10, 7, 4, 5, 6);
    rect(p, x - 6, y - height - 11, 3, 2, 3);
}

static void insect(painter_t *p, int x, int y, float angle, float phase, bool flying, bool sleeping) {
    float du = sinf(angle), dv = cosf(angle);
    float sx = du - dv, sy = (du + dv) * 0.5f;
    float length = sqrtf(sx * sx + sy * sy);
    if (length < 0.1f) length = 1;
    sx /= length; sy /= length;
    float nx = -sy, ny = sx;
    int gait = sleeping ? 0 : sinf(phase) > 0 ? 1 : -1;
    for (int side = -1; side <= 1; side += 2) for (int leg = -1; leg <= 1; leg++) {
        int ax = x + (int)(sx * leg * 2), ay = y + (int)(sy * leg * 2);
        int bx = ax + (int)(nx * side * 4 + sx * leg * 2);
        int by = ay + (int)(ny * side * 4 + sy * leg * 2);
        int cx = bx + (int)(nx * side * 2 + sx * gait * (leg == 0 ? -1 : 1));
        int cy = by + (int)(ny * side * 2 + sy * gait * (leg == 0 ? -1 : 1));
        line(p, ax, ay, bx, by, 14); line(p, bx, by, cx, cy, 0);
    }
    ellipse(p, x - (int)(sx * 3), y - (int)(sy * 3), 4, 3, 14);
    pixel(p, x - (int)(sx * 4), y - (int)(sy * 4) - 1, 9);
    for (int side = -1; side <= 1; side += 2) {
        float spread = flying ? (gait > 0 ? 9 : 6) : 3;
        int wx = x - (int)(sx * 3) + (int)(nx * side * spread);
        int wy = y - (int)(sy * 3) + (int)(ny * side * spread) - 1;
        ellipse(p, wx, wy, flying ? 5 : 3, 2, 2);
        ellipse(p, wx, wy - 1, flying ? 4 : 3, 1, 13);
        line(p, x, y - 1, wx, wy - 1, 3);
    }
    ellipse(p, x, y - 1, 3, 2, 14);
    pixel(p, x - 1, y - 2, 9);
    int hx = x + (int)(sx * 4), hy = y + (int)(sy * 4) - 1;
    ellipse(p, hx, hy, 2, 2, 0);
    pixel(p, hx + (int)(nx * 2), hy + (int)(ny * 2) - 1, 11);
    pixel(p, hx - (int)(nx * 2), hy - (int)(ny * 2) - 1, 11);
    pixel(p, hx + (int)(sx * 3), hy + (int)(sy * 3), 14);
    if (sleeping) text(p, x + 10, y - 16, "Z", 0, 1);
}

void fly_view_render(uint8_t *pixels, const fly_model_t *m, int battery) {
    painter_t canvas = {pixels}, *p = &canvas;
    memset(pixels, 0x11, FLY_VIEW_BYTES);
    /* Distant stepped silhouettes frame an open, compact terrarium. */
    for (int x = 0; x < 240; x += 12) {
        int h = 8 + ((x * 7 + 19) % 29);
        rect(p, x, 128 - h, 12, h + 30, 15);
    }
    rect(p, 0, 152, 240, 87, 15);
    rect(p, 23, 68, 26, 4, 3); rect(p, 30, 64, 12, 4, 3);
    rect(p, 184, 82, 34, 4, 13); rect(p, 194, 77, 12, 5, 13);
    ellipse(p, 120, 206, 101, 18, 2);

    for (int sum = 0; sum <= 10; sum++) for (int u = 0; u < 6; u++) {
        int v = sum - u;
        if (v < 0 || v >= 6) continue;
        int x = 120 + (u - v) * 16, y = 116 + (u + v) * 8;
        bool water = (u == 3 || u == 4) && (v == 0 || v == 1);
        block(p, x, y, 16, 15, water ? 10 : (u + v) % 3 == 0 ? 4 : 5, 7, 8);
        if (!water) {
            int shift = (u * 17 + v * 9) % 13 - 6;
            rect(p, x + shift, y - 2, 3, 1, 4);
            pixel(p, x + shift + 5, y + 2, 6);
            if ((u + v) % 3 == 0) { pixel(p, x - 5, y + 12, 9); pixel(p, x - 3, y + 13, 9); }
        } else rect(p, x - 4, y, 8, 1, 13);
        if (u == 0 && v == 0) plant(p, x, y - 3, 24);
        if (u == 0 && v == 3) { rect(p, x, y - 7, 1, 7, 6); rect(p, x - 2, y - 9, 5, 3, 12); }
        if (u == 5 && v == 2) block(p, x, y - 4, 7, 6, 13, 2, 14);
        if (u == 4 && v == 5) { rect(p, x, y - 5, 2, 5, 3); rect(p, x - 3, y - 8, 8, 3, 11); }
        if (u == 1 && v == 4) {
            block(p, x, y - 2, 5, 4, 12, 9, 7);
            rect(p, x, y - 6, 1, 3, 6);
        }
    }
    if (m->food_present) {
        int fx = 120 + (int)((1.3f - 3.7f) * 16), fy = 116 + (int)((1.3f + 3.7f) * 8);
        rect(p, fx - 3, fy - 5, 6, 5, 11); rect(p, fx, fy - 7, 3, 2, 6);
    }
    int fx = 120 + (int)((m->u - m->v) * 16);
    int ground = 116 + (int)((m->u + m->v) * 8);
    if (m->world_state && m->shadow) diamond(p, fx, ground, 20, 14);
    ellipse(p, fx, ground + 3, m->height > 0.1f ? 5 : 7, 2, 6);
    int fy = ground - 3 - (int)(m->height * 11);
    insect(p, fx, fy, m->heading, m->phase, m->height > 0.1f, m->mode == FLY_LOCAL && m->behavior == FLY_SLEEP);
    if (m->world_state && m->feeding > 0) {
        float du = sinf(m->heading), dv = cosf(m->heading);
        line(p, fx, fy, fx + (int)((du - dv) * 8), fy + (int)((du + dv) * 4), 11);
    }

    rect(p, 0, 0, 240, 43, 0);
    text(p, 12, 10, "FLY WORLD", 3, 2);
    text(p, 13, 29, m->mode == FLY_LOCAL ? "POCKET HABITAT" : "MALECNS CONNECTED", 13, 1);
    rect(p, 200, 12, 25, 10, 2); rect(p, 202, 14, 21, 6, 0); rect(p, 225, 15, 2, 4, 2);
    if (battery >= 0) rect(p, 203, 15, battery * 19 / 100, 4, battery < 20 ? 11 : 4);
    else text(p, 209, 15, "-", 2, 1);
    text(p, 199, 29, m->mode == FLY_LOCAL ? "LOCAL" : "USB", m->mode == FLY_LOCAL ? 12 : 4, 1);
    centered(p, 223, fly_model_status(m), 0, 1);

    rect(p, 0, 239, 240, 81, 0);
    rect(p, 0, 239, 240, 2, 6);
    if (m->mode == FLY_LOCAL) {
        text(p, 12, 250, "FOOD", 13, 1); text(p, 130, 250, "ENERGY", 13, 1);
        rect(p, 12, 260, 94, 3, 14); rect(p, 130, 260, 94, 3, 14);
        rect(p, 12, 260, (int)(m->food * 0.94f), 3, 12);
        rect(p, 130, 260, (int)(m->energy * 0.94f), 3, 4);
    } else {
        text(p, 12, 250, "WALK", 13, 1); text(p, 94, 250, "TURN", 13, 1); text(p, 170, 250, "FLIGHT", 13, 1);
        rect(p, 12, 260, 58, 3, 14); rect(p, 94, 260, 58, 3, 14); rect(p, 170, 260, 58, 3, 14);
        rect(p, 12, 260, m->walking > 100 ? 58 : m->walking * 58 / 100, 3, 4);
        int turn = abs(m->turning); if (turn > 180) turn = 180;
        rect(p, 94, 260, turn * 58 / 180, 3, 12);
        rect(p, 170, 260, m->escape > 250 ? 58 : m->escape * 58 / 250, 3, 11);
    }
    rect(p, 12, 274, 216, 29, 6); rect(p, 13, 275, 214, 27, 14);
    line(p, 28, 285, 24, 289, 13); line(p, 24, 289, 28, 293, 13);
    line(p, 211, 285, 215, 289, 13); line(p, 215, 289, 211, 293, 13);
    centered(p, 284, fly_model_action(m), 3, 2);
    text(p, 18, 310, "UP DOWN SELECT", 2, 1); text(p, 151, 310, "OK INTERACT", 2, 1);
}

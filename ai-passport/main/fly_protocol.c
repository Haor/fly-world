#include "fly_protocol.h"

#include <errno.h>
#include <stdlib.h>
#include <string.h>

static bool number(const char **p, int64_t low, int64_t high, int64_t *out) {
    if (**p != ' ') return false;
    const char *start = *p + 1;
    if (!(*start == '-' || (*start >= '0' && *start <= '9'))) return false;
    errno = 0;
    char *end;
    long long value = strtoll(start, &end, 10);
    if (errno || end == start || (*end && *end != ' ') || value < low || value > high) return false;
    *p = end; *out = value; return true;
}

bool fly_protocol_parse(const char *line, fly_message_t *m) {
    memset(m, 0, sizeof(*m));
    const char *p;
    int64_t v[16];
    if (strcmp(line, "F1 CAPTURE") == 0) { m->type = FLY_MSG_CAPTURE; return true; }
    if (strncmp(line, "F1 HELLO", 8) == 0) {
        p = line + 8;
        if (!number(&p, 1, UINT32_MAX, &v[0]) || *p) return false;
        m->type = FLY_MSG_HELLO; m->session = (uint32_t)v[0]; return true;
    }
    if (strncmp(line, "F1 ACK", 6) == 0) {
        p = line + 6;
        if (!number(&p, 1, UINT32_MAX, &v[0]) || !number(&p, 1, UINT32_MAX, &v[1]) || *p) return false;
        m->type = FLY_MSG_ACK; m->session = (uint32_t)v[0]; m->sequence = (uint32_t)v[1]; return true;
    }
    if (strncmp(line, "F1 BUTTON", 9) == 0) {
        p = line + 9;
        if (!number(&p, 0, 3, &v[0]) || *p) return false;
        m->type = FLY_MSG_BUTTON; m->button = (int)v[0]; return true;
    }
    bool world = strncmp(line, "F1 WORLD", 8) == 0;
    if (!world && strncmp(line, "F1 STATE", 8) != 0) return false;
    p = line + 8;
    const int64_t low[] = {1, 1, 0, 0, -100000000, -100000000, -10000, 0, 0, 0, -10000, 0};
    const int64_t high[] = {UINT32_MAX, UINT32_MAX, UINT32_MAX, 1, 100000000, 100000000, 10000, 10000, 7000, 10000, 10000, 10000};
    for (unsigned i = 0; i < 12; i++) if (!number(&p, low[i], high[i], &v[i])) return false;
    if (world) {
        const int64_t extra_high[] = {1000, 100, 100, 1};
        for (unsigned i = 0; i < 4; i++) if (!number(&p, 0, extra_high[i], &v[12 + i])) return false;
        if (v[4] < -13438 || v[4] > 13438 || v[5] < -13438 || v[5] > 13438) return false;
    }
    if (*p) return false;
    m->type = FLY_MSG_STATE;
    m->snapshot = (fly_snapshot_t){
        .session = (uint32_t)v[0], .sequence = (uint32_t)v[1], .tick_ms = (uint32_t)v[2],
        .running = (int)v[3], .x = (int32_t)v[4], .z = (int32_t)v[5], .heading = (int32_t)v[6],
        .height = (int32_t)v[7], .phase = (int32_t)v[8], .walking = (int32_t)v[9],
        .turning = (int32_t)v[10], .escape = (int32_t)v[11]
    };
    if (world) {
        m->snapshot.world = true;
        m->snapshot.feeding = (int)v[12]; m->snapshot.food = (int)v[13];
        m->snapshot.energy = (int)v[14]; m->snapshot.shadow = (int)v[15];
    }
    return true;
}

bool fly_protocol_feed(fly_line_t *line, char byte) {
    if (byte == '\r') return false;
    if (byte == '\n') {
        bool ready = line->length > 0 && !line->overflow;
        line->data[line->length] = '\0';
        line->length = 0; line->overflow = false;
        return ready;
    }
    if ((unsigned char)byte < 32 || (unsigned char)byte > 126) { line->overflow = true; return false; }
    if (line->length >= FLY_LINE_MAX - 1) line->overflow = true;
    if (!line->overflow) line->data[line->length++] = byte;
    return false;
}

#include "fly_model.h"

#include <math.h>
#include <string.h>

static float limit(float x, float a, float b) { return x < a ? a : x > b ? b : x; }
static float wrap(float x) {
    while (x < 0.35f) x += 4.3f;
    while (x > 4.65f) x -= 4.3f;
    return x;
}
static float random_unit(fly_model_t *m) {
    m->random = m->random * 1664525u + 1013904223u;
    return (float)(m->random >> 16) / 65535.0f;
}

void fly_model_init(fly_model_t *m, uint32_t seed, uint64_t now) {
    memset(m, 0, sizeof(*m));
    m->u = 2.6f; m->v = 2.9f;
    m->target_u = 4.1f; m->target_v = 1.6f;
    m->food = 75; m->energy = 90;
    m->random = seed;
    m->now_ms = m->last_update_ms = m->last_key_ms = now;
}

bool fly_model_snapshot(fly_model_t *m, const fly_snapshot_t *s, uint64_t now) {
    bool same = m->have_state && m->session == s->session;
    if (same && (int32_t)(s->sequence - m->sequence) <= 0) return false;
    if (same && s->tick_ms < m->tick_ms) return false;
    if (s->world) {
        m->u = limit(2.5f + (float)s->x * 0.00016f, 0.35f, 4.65f);
        m->v = limit(2.5f + (float)s->z * 0.00016f, 0.35f, 4.65f);
    } else if (same) {
        float dx = (float)((int64_t)s->x - m->previous_x) / 1000;
        float dz = (float)((int64_t)s->z - m->previous_z) / 1000;
        m->u = wrap(m->u + limit(dx, -5, 5) * 0.16f);
        m->v = wrap(m->v + limit(dz, -5, 5) * 0.16f);
    }
    if (m->mode == FLY_LOCAL) {
        m->selected = 0;
        m->food_present = false;
        m->behavior = FLY_WANDER;
    }
    m->mode = s->running ? FLY_NEURAL : FLY_PAUSED;
    m->heading = (float)s->heading / 1000;
    m->height = (float)s->height / 1000;
    m->phase = (float)s->phase / 1000;
    m->walking = s->walking; m->turning = s->turning; m->escape = s->escape;
    m->world_state = s->world;
    m->feeding = s->feeding; m->world_food = s->food; m->world_energy = s->energy;
    m->shadow = s->shadow;
    m->previous_x = s->x; m->previous_z = s->z;
    m->session = s->session; m->sequence = s->sequence; m->tick_ms = s->tick_ms;
    m->last_state_ms = now; m->have_state = true;
    return true;
}

void fly_model_tick(fly_model_t *m, uint64_t now) {
    if (now < m->last_update_ms) return;
    float dt = (float)(now - m->last_update_ms) / 1000;
    m->last_update_ms = m->now_ms = now;
    dt = limit(dt, 0, 0.15f);
    if (m->mode != FLY_LOCAL && now - m->last_state_ms > 2500) {
        m->mode = FLY_LOCAL; m->selected = 0; m->have_state = false;
        m->world_state = false; m->feeding = 0; m->shadow = 0;
        m->behavior = FLY_WANDER; m->command_pending = false;
        m->target_u = m->u; m->target_v = m->v;
    }
    if (m->mode != FLY_LOCAL) return;
    m->food = limit(m->food - dt / 25, 0, 100);
    m->energy = limit(m->energy + (m->behavior == FLY_SLEEP ? dt * 0.8f : -dt / 40), 0, 100);
    m->dirty = true;
    m->height = limit(m->height - dt * 4, 0, 3);
    if (m->behavior == FLY_SLEEP) return;
    if (m->behavior == FLY_PLAY && now < m->action_until_ms) {
        m->height = 1.4f + 0.5f * sinf((float)(m->action_until_ms - now) / 250);
        m->phase += dt * 20;
    } else if (m->behavior == FLY_EAT && now < m->action_until_ms) {
        m->phase += dt * 3; return;
    } else if (m->behavior != FLY_WANDER) {
        m->behavior = FLY_WANDER; m->food_present = false;
    }
    if (m->energy < 8) { m->behavior = FLY_SLEEP; return; }
    float du = m->target_u - m->u, dv = m->target_v - m->v;
    float distance = sqrtf(du * du + dv * dv);
    if (distance < 0.06f) {
        if (m->food_present) {
            m->behavior = FLY_EAT; m->action_until_ms = now + 4500;
            m->food = limit(m->food + 25, 0, 100); m->feeds++;
        } else {
            m->target_u = 0.6f + random_unit(m) * 3.8f;
            m->target_v = 0.6f + random_unit(m) * 3.8f;
        }
    } else {
        float step = fminf(distance, dt * (m->behavior == FLY_PLAY ? 1.1f : 0.42f));
        m->u += du / distance * step; m->v += dv / distance * step;
        m->heading = atan2f(du, dv); m->phase += dt * 9;
    }
}

void fly_model_select(fly_model_t *m, int delta, uint64_t now) {
    int count = m->mode == FLY_LOCAL ? 3 : 6;
    m->selected = (m->selected + delta + count) % count;
    m->last_key_ms = now; m->command_failed = false;
}

void fly_model_local_action(fly_model_t *m, uint64_t now) {
    if (m->mode != FLY_LOCAL) return;
    m->last_key_ms = now; m->dirty = true;
    if (m->selected == 0) {
        m->food_present = true; m->target_u = 1.3f; m->target_v = 3.7f;
        m->behavior = FLY_WANDER;
    } else if (m->selected == 1) {
        m->behavior = FLY_PLAY; m->action_until_ms = now + 3500;
        m->target_u = 0.6f + random_unit(m) * 3.8f;
        m->target_v = 0.6f + random_unit(m) * 3.8f;
    } else {
        m->behavior = m->behavior == FLY_SLEEP ? FLY_WANDER : FLY_SLEEP;
    }
}

const char *fly_model_action(const fly_model_t *m) {
    static const char *const local[] = {"FEED", "PLAY", "REST"};
    static const char *const neural[] = {"WALK", "LEFT", "RIGHT", "FLY", "PAUSE", "RESET"};
    return m->mode == FLY_LOCAL ? local[m->selected % 3] : neural[m->selected % 6];
}

const char *fly_model_status(const fly_model_t *m) {
    if (m->command_failed) return "TRY AGAIN";
    if (m->command_pending) return "STIMULATING";
    if (m->mode == FLY_PAUSED) return "SIM PAUSED";
    if (m->mode == FLY_NEURAL) return m->height > 0.1f ? "IN FLIGHT" : m->feeding > 0 ? "ENJOYING FRUIT" : m->walking > 2 ? "EXPLORING" : "OBSERVING";
    static const char *const states[] = {"EXPLORING", "ENJOYING FRUIT", "IN FLIGHT", "RESTING"};
    return states[m->behavior];
}

#pragma once

#include <stdbool.h>
#include <stdint.h>

typedef enum { FLY_LOCAL, FLY_NEURAL, FLY_PAUSED } fly_mode_t;
typedef enum { FLY_WANDER, FLY_EAT, FLY_PLAY, FLY_SLEEP } fly_behavior_t;

typedef struct {
    uint32_t session, sequence, tick_ms;
    int running;
    int32_t x, z, heading, height, phase, walking, turning, escape;
    bool world;
    int feeding, food, energy, shadow;
} fly_snapshot_t;

typedef struct {
    fly_mode_t mode;
    fly_behavior_t behavior;
    float u, v, height, heading, phase;
    float target_u, target_v;
    float food, energy;
    uint32_t feeds, random;
    uint64_t now_ms, last_update_ms, last_state_ms, action_until_ms, last_key_ms;
    uint32_t session, sequence, tick_ms;
    int32_t previous_x, previous_z;
    int walking, turning, escape, selected;
    bool world_state;
    int feeding, world_food, world_energy, shadow;
    bool have_state, food_present, dirty, command_pending, command_failed;
} fly_model_t;

void fly_model_init(fly_model_t *model, uint32_t seed, uint64_t now);
bool fly_model_snapshot(fly_model_t *model, const fly_snapshot_t *snapshot, uint64_t now);
void fly_model_tick(fly_model_t *model, uint64_t now);
void fly_model_select(fly_model_t *model, int delta, uint64_t now);
void fly_model_local_action(fly_model_t *model, uint64_t now);
const char *fly_model_action(const fly_model_t *model);
const char *fly_model_status(const fly_model_t *model);

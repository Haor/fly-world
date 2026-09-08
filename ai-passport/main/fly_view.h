#pragma once
#include <stdint.h>
#include "fly_model.h"

#define FLY_VIEW_WIDTH 240
#define FLY_VIEW_HEIGHT 320
#define FLY_VIEW_BYTES (FLY_VIEW_WIDTH * FLY_VIEW_HEIGHT / 2)
extern const uint32_t fly_palette[16];
void fly_view_render(uint8_t *pixels, const fly_model_t *model, int battery);


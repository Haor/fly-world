#pragma once

#include <stddef.h>
#include <stdint.h>
#include "fly_model.h"

#define FLY_LINE_MAX 256
typedef enum { FLY_MSG_INVALID, FLY_MSG_HELLO, FLY_MSG_STATE, FLY_MSG_ACK, FLY_MSG_CAPTURE, FLY_MSG_BUTTON } fly_message_type_t;
typedef struct {
    fly_message_type_t type;
    uint32_t session, sequence;
    int button;
    fly_snapshot_t snapshot;
} fly_message_t;

bool fly_protocol_parse(const char *line, fly_message_t *message);
typedef struct { char data[FLY_LINE_MAX]; size_t length; bool overflow; } fly_line_t;
/* Returns a complete line once; overlong frames are discarded through newline. */
bool fly_protocol_feed(fly_line_t *line, char byte);


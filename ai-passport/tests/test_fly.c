#include "fly_model.h"
#include "fly_protocol.h"
#include "fly_view.h"
#include <assert.h>
#include <math.h>
#include <stdio.h>
#include <string.h>

static void protocol(void) {
    fly_message_t m;
    assert(fly_protocol_parse("F1 HELLO 123", &m) && m.session == 123);
    assert(!fly_protocol_parse("F1 HELLO 0", &m));
    assert(!fly_protocol_parse("F1 HELLO -1", &m));
    assert(!fly_protocol_parse("F1 HELLO 4294967296", &m));
    assert(fly_protocol_parse("F1 STATE 123 1 100 1 -1000 2000 3141 500 6282 20 -30 150", &m));
    assert(m.snapshot.x == -1000 && m.snapshot.phase == 6282);
    assert(!fly_protocol_parse("F1 STATE 123 1 100 2 -1000 2000 3141 500 6282 20 -30 150", &m));
    assert(!fly_protocol_parse("F1 STATE 123 1 100 1 -1000 2000 3141 500 6282 20 -30 150 extra", &m));
    assert(!fly_protocol_parse("F1 ACK 1 2x", &m));
    assert(fly_protocol_parse("F1 WORLD 123 1 100 1 -9375 9375 0 0 0 20 0 0 800 50 90 1", &m));
    assert(m.snapshot.world && m.snapshot.feeding == 800 && m.snapshot.shadow == 1);
    assert(!fly_protocol_parse("F1 WORLD 123 1 100 1 -9375 9375 0 0 0 20 0 0 1001 50 90 1", &m));
    assert(!fly_protocol_parse("F1 WORLD 123 1 100 1 20000 0 0 0 0 20 0 0 0 50 90 0", &m));
    assert(!fly_protocol_parse("F1 WORLD 123 1 100 1 0 0 0 0 0 20 0 0", &m));
    fly_line_t line = {0};
    const char *s = "boot log\nF1 HE";
    for (; *s; s++) fly_protocol_feed(&line, *s);
    s = "LLO 7\r\n";
    bool complete = false;
    for (; *s; s++) if (fly_protocol_feed(&line, *s)) complete = true;
    assert(complete && !strcmp(line.data, "F1 HELLO 7"));
    for (int i=0;i<300;i++) assert(!fly_protocol_feed(&line, 'x'));
    assert(!fly_protocol_feed(&line, '\n'));
    s = "F1 CAPTURE\n";
    for (; *s; s++) complete = fly_protocol_feed(&line, *s);
    assert(complete && fly_protocol_parse(line.data, &m));
}

static void world_coordinates(void) {
    fly_model_t m; fly_model_init(&m, 4, 0);
    float food = m.food, energy = m.energy;
    fly_snapshot_t s = {.session=1, .sequence=1, .tick_ms=100, .running=1,
        .world=true, .x=-9375, .z=9375, .feeding=900, .food=20, .energy=50, .shadow=1};
    assert(fly_model_snapshot(&m, &s, 100));
    assert(fabsf(m.u - 1) < .001f && fabsf(m.v - 4) < .001f);
    assert(!strcmp(fly_model_status(&m), "ENJOYING FRUIT"));
    s.sequence++; s.x=0; s.z=0;
    assert(fly_model_snapshot(&m, &s, 200));
    assert(fabsf(m.u - 2.5f) < .001f && fabsf(m.v - 2.5f) < .001f);
    s.session=2; s.sequence=1; s.tick_ms=0; s.x=-9375;
    assert(fly_model_snapshot(&m, &s, 300));
    assert(fabsf(m.u - 1) < .001f);
    fly_model_tick(&m, 3000);
    assert(m.mode == FLY_LOCAL && !m.world_state && !m.feeding && !m.shadow);
    assert(fabsf(m.food - food) < .1f && fabsf(m.energy - energy) < .1f);
}

static void behavior(void) {
    fly_model_t m;
    fly_model_init(&m, 42, 0);
    fly_model_local_action(&m, 0);
    for (int i=1;i<=120;i++) fly_model_tick(&m, i*50);
    assert(m.feeds == 1 && m.food > 95);
    m.selected = 2; fly_model_local_action(&m, 6000);
    float u = m.u, v = m.v, energy = m.energy;
    for (int i=121;i<=160;i++) fly_model_tick(&m, i*50);
    assert(m.u == u && m.v == v && m.energy > energy);
    fly_snapshot_t s = {.session=1,.sequence=1,.tick_ms=100,.running=1,.x=0,.z=0,.phase=2000};
    assert(fly_model_snapshot(&m, &s, 8000));
    assert(m.mode == FLY_NEURAL && m.selected == 0);
    assert(!fly_model_snapshot(&m, &s, 8100));
    s.sequence=2;s.tick_ms=200;s.x=1000;
    assert(fly_model_snapshot(&m,&s,8200));
    assert(m.u > u);
    s.sequence=3;s.running=0;
    assert(fly_model_snapshot(&m,&s,8300));
    u=m.u;v=m.v;float phase=m.phase;
    fly_model_tick(&m, 9000);
    assert(m.mode==FLY_PAUSED && m.u==u && m.v==v && m.phase==phase);
    s.sequence=4;s.tick_ms=100;
    assert(!fly_model_snapshot(&m,&s,9100));
    fly_model_tick(&m,11000);
    assert(m.mode==FLY_LOCAL && !m.have_state);
    assert(m.food > 90 && m.feeds == 1);
    for(int i=0;i<10000;i++) {
        fly_model_tick(&m,11050+i*50);
        assert(isfinite(m.u) && m.u >= .3f && m.u <= 4.7f);
        assert(isfinite(m.v) && m.v >= .3f && m.v <= 4.7f);
        assert(m.energy >= 0 && m.energy <= 100 && m.food >= 0 && m.food <= 100);
    }
}

static void drawing(void) {
    static uint8_t data[FLY_VIEW_BYTES+32];
    fly_model_t m;fly_model_init(&m, 4, 0);
    memset(data, 0xa7, sizeof(data));
    for(int i=0;i<30;i++) {
        m.heading=i*.4f;m.height=(i%4)*.8f;m.u=.35f+(i%6)*.8f;
        fly_view_render(data+16,&m,i%2?-1:100);
    }
    for(int i=0;i<16;i++) { assert(data[i]==0xa7);assert(data[sizeof(data)-1-i]==0xa7); }
}
int main(void) { protocol();behavior();world_coordinates();drawing();puts("Fly model, framing, offline/online transitions and renderer: PASS"); }

#include "bsp_battery.h"
#include "bsp_button.h"
#include "bsp_display.h"
#include "bsp_i2c.h"
#include "driver/usb_serial_jtag.h"
#include "driver/usb_serial_jtag_vfs.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_random.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "lvgl.h"
#include "nvs.h"
#include "nvs_flash.h"
#include "fly_model.h"
#include "fly_protocol.h"
#include "fly_view.h"

#include <stdio.h>
#include <string.h>

static fly_model_t s_model;
static QueueHandle_t s_keys;
static uint8_t s_canvas[64 + FLY_VIEW_BYTES] __attribute__((aligned(64)));
static lv_obj_t *s_view;
static uint32_t s_boot, s_host_session, s_command;
static unsigned s_attempts;
static uint64_t s_last_send;
static char s_pending[12];
static nvs_handle_t s_store;
static bool s_store_ready;
static int s_battery = -1;
static unsigned s_dropped_keys;
static uint32_t s_frames;

static uint64_t now_ms(void) { return (uint64_t)esp_timer_get_time() / 1000; }

static bool send_bytes(const void *data, size_t length) {
    return usb_serial_jtag_write_bytes(data, length, pdMS_TO_TICKS(20)) == (int)length;
}
static void send_line(const char *line) { (void)send_bytes(line, strlen(line)); }

static void on_key(bsp_btn_t key, bsp_btn_ev_t event, void *context) {
    (void)context;
    int value = (int)key;
    if (key == BSP_BTN_OK && event == BSP_BTN_LONG) value = 3;
    else if (event != BSP_BTN_CLICK) return;
    if (xQueueSend(s_keys, &value, 0) != pdTRUE) s_dropped_keys++;
}

static void key_event(int key, uint64_t now) {
    s_model.last_key_ms = now;
    if (key < 2) { fly_model_select(&s_model, key == 0 ? -1 : 1, now); return; }
    if (s_model.mode == FLY_LOCAL) {
        if (key == 3) s_model.selected = 2;
        fly_model_local_action(&s_model, now);
    } else if (!s_model.command_pending) {
        if (key == 3) s_model.selected = 4;
        snprintf(s_pending, sizeof(s_pending), "%s", fly_model_action(&s_model));
        s_command++;
        if (!s_command) s_command++;
        s_model.command_pending = true; s_model.command_failed = false;
        s_attempts = 0; s_last_send = 0;
    }
}

static void save_state(void) {
    if (!s_store_ready || !s_model.dirty) return;
    const uint32_t values[] = {1, (uint32_t)s_model.food, (uint32_t)s_model.energy, s_model.feeds};
    if (nvs_set_blob(s_store, "pet", values, sizeof(values)) == ESP_OK && nvs_commit(s_store) == ESP_OK)
        s_model.dirty = false;
}

static void load_state(void) {
    /* Never erase the provisioned NVS partition to recover an initialization error. */
    if (nvs_flash_init() != ESP_OK || nvs_open("fly_world", NVS_READWRITE, &s_store) != ESP_OK) return;
    s_store_ready = true;
    uint32_t values[4]; size_t length = sizeof(values);
    if (nvs_get_blob(s_store, "pet", values, &length) == ESP_OK && length == sizeof(values) &&
        values[0] == 1 && values[1] <= 100 && values[2] <= 100) {
        s_model.food = values[1]; s_model.energy = values[2]; s_model.feeds = values[3];
    }
}

static void capture(void) {
    char header[80];
    snprintf(header, sizeof(header), "F1 IMAGE %d %d I4 %d\n", FLY_VIEW_WIDTH, FLY_VIEW_HEIGHT, FLY_VIEW_BYTES);
    if (!send_bytes(header, strlen(header))) return;
    /* The application is the only USB writer; the framebuffer is immutable here. */
    for (size_t offset = 0; offset < FLY_VIEW_BYTES; offset += 256) {
        size_t size = FLY_VIEW_BYTES - offset;
        if (size > 256) size = 256;
        if (usb_serial_jtag_write_bytes(s_canvas + 64 + offset, size, pdMS_TO_TICKS(1000)) != (int)size) return;
    }
    send_line("\n");
}

static void message(const fly_message_t *m, uint64_t now) {
    char line[80];
    switch (m->type) {
    case FLY_MSG_HELLO:
        if (s_host_session != m->session) {
            s_host_session = m->session;
            s_model.have_state = false;
            s_model.command_pending = false;
        }
        snprintf(line, sizeof(line), "F1 READY %lu 1\n", (unsigned long)s_boot);
        send_line(line);
        break;
    case FLY_MSG_STATE:
        if (s_host_session && m->snapshot.session == s_host_session)
            fly_model_snapshot(&s_model, &m->snapshot, now);
        break;
    case FLY_MSG_ACK:
        if (m->session == s_boot && m->sequence == s_command) s_model.command_pending = false;
        break;
    case FLY_MSG_CAPTURE: capture(); break;
    case FLY_MSG_BUTTON: key_event(m->button, now); break;
    default: break;
    }
}

void app_main(void) {
    s_boot = esp_random(); if (!s_boot) s_boot = 1;
    s_keys = xQueueCreate(12, sizeof(int));
    if (!s_keys) return;
    fly_model_init(&s_model, s_boot, now_ms());
    load_state();
    bsp_i2c_init();
    bool battery_ok = bsp_battery_init() == ESP_OK;
    if (battery_ok) s_battery = bsp_battery_soc();
    if (bsp_display_init() != ESP_OK || !bsp_lvgl_init()) return;
    if (!bsp_lvgl_lock(1000)) return;
    lv_obj_t *screen = lv_obj_create(NULL);
    lv_obj_set_style_bg_color(screen, lv_color_hex(fly_palette[0]), 0);
    lv_obj_set_style_pad_all(screen, 0, 0);
    lv_obj_remove_flag(screen, LV_OBJ_FLAG_SCROLLABLE);
    s_view = lv_canvas_create(screen);
    lv_canvas_set_buffer(s_view, s_canvas, FLY_VIEW_WIDTH, FLY_VIEW_HEIGHT, LV_COLOR_FORMAT_I4);
    for (int i = 0; i < 16; i++) {
        uint32_t c = fly_palette[i];
        lv_color32_t color = {.red = c >> 16, .green = c >> 8, .blue = c, .alpha = 255};
        lv_canvas_set_palette(s_view, (uint8_t)i, color);
    }
    fly_view_render(s_canvas + 64, &s_model, s_battery);
    lv_screen_load(screen);
    bsp_lvgl_unlock();
    bsp_display_backlight(70);
    if (bsp_button_init(on_key, NULL) != ESP_OK) return;

    usb_serial_jtag_driver_config_t usb = {.tx_buffer_size = 2048, .rx_buffer_size = 1024};
    if (usb_serial_jtag_driver_install(&usb) != ESP_OK) return;
    usb_serial_jtag_vfs_use_driver();
    /* Protocol and boot diagnostics share USB. After boot, only this task writes. */
    esp_log_level_set("*", ESP_LOG_NONE);
    fly_line_t input = {0};
    uint64_t frame_at = 0, status_at = 0, battery_at = 0, save_at = now_ms();
    int brightness = 70;
    for (;;) {
        uint64_t now = now_ms();
        uint8_t bytes[128];
        int count = usb_serial_jtag_read_bytes(bytes, sizeof(bytes), pdMS_TO_TICKS(5));
        for (int i = 0; i < count; i++) if (fly_protocol_feed(&input, (char)bytes[i])) {
            fly_message_t msg;
            if (fly_protocol_parse(input.data, &msg)) message(&msg, now);
        }
        int key;
        while (xQueueReceive(s_keys, &key, 0) == pdTRUE) key_event(key, now);
        fly_model_tick(&s_model, now);
        if (s_model.command_pending && now - s_last_send >= 350) {
            if (s_attempts >= 6) { s_model.command_pending = false; s_model.command_failed = true; }
            else {
                char packet[80];
                snprintf(packet, sizeof(packet), "F1 KEY %lu %lu %s\n", (unsigned long)s_boot,
                         (unsigned long)s_command, s_pending);
                send_line(packet); s_last_send = now; s_attempts++;
            }
        }
        uint64_t idle = now - s_model.last_key_ms;
        int target = s_model.mode == FLY_LOCAL ? idle > 300000 ? 0 : idle > 90000 ? 12 : 70 : 70;
        if (target != brightness) { bsp_display_backlight(target); brightness = target; }
        if (now - frame_at >= (brightness ? 80 : 500)) {
            if (bsp_lvgl_lock(30)) {
                fly_view_render(s_canvas + 64, &s_model, s_battery);
                lv_obj_invalidate(s_view);
                bsp_lvgl_unlock(); s_frames++;
            }
            frame_at = now;
        }
        if (now - status_at >= 1000) {
            char status[180];
            snprintf(status, sizeof(status), "F1 STATUS %lu %d %d %d %d %u %u %lu %u %d %d %d %d %lu\n",
                     (unsigned long)s_boot, s_model.mode, s_model.selected, (int)s_model.food,
                     (int)s_model.energy, (unsigned)esp_get_free_heap_size(),
                     (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT),
                     (unsigned long)s_frames, s_dropped_keys, (int)(s_model.u * 1000),
                     (int)(s_model.v * 1000), s_model.feeding, s_model.world_state,
                     (unsigned long)s_model.sequence);
            send_line(status); status_at = now;
        }
        if (battery_ok && now - battery_at >= 15000) { s_battery = bsp_battery_soc(); battery_at = now; }
        if (now - save_at >= 60000) { save_state(); save_at = now; }
        vTaskDelay(pdMS_TO_TICKS(10));
    }
}

idf_component_register(
    SRCS "main.c" "fly_model.c" "fly_protocol.c" "fly_view.c"
    INCLUDE_DIRS "."
    REQUIRES bsp esp_timer esp_driver_usb_serial_jtag nvs_flash
)

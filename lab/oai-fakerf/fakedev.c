/* Radio FALSA para OAI (lte-softmodem): hace el papel del USRP sin hardware.
 *  - trx_read: entrega muestras de ruido muy bajo al ritmo REAL del reloj de muestreo (1 ms de muestras tarda 1 ms) y avanza
 *    una marca de tiempo; así los hilos de tiempo real de la capa física giran y el planificador MAC corre.
 *  - trx_write: descarta lo que OAI transmite (no hay antena).
 * No es una señal NB-IoT: NO prueba la capa física. Sirve para ejercitar MAC, RRC y S1AP de OAI con eventos inyectados.
 * Se carga porque OAI hace dlopen("liboai_device.so"): basta que ese nombre apunte a esta biblioteca. */
#define _GNU_SOURCE
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "common_lib.h"

typedef struct { double rate; int64_t ts; struct timespec next; int started; uint32_t rng; } fake_t;

static int fk_start(openair0_device *d) { (void)d; return 0; }
static int fk_noop(openair0_device *d) { (void)d; return 0; }
static void fk_end(openair0_device *d) { (void)d; }
static int fk_write(openair0_device *d, openair0_timestamp ts, void **buff, int n, int ant, int flags) {
  (void)d; (void)ts; (void)buff; (void)ant; (void)flags; return n;
}
static int fk_read(openair0_device *d, openair0_timestamp *pts, void **buff, int n, int cc) {
  fake_t *f = (fake_t *)d->priv;
  if (!f->started) { clock_gettime(CLOCK_MONOTONIC, &f->next); f->started = 1; }
  long ns = (long)((double)n / f->rate * 1e9);
  f->next.tv_nsec += ns;
  while (f->next.tv_nsec >= 1000000000L) { f->next.tv_nsec -= 1000000000L; f->next.tv_sec++; }
  clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &f->next, NULL);
  *pts = f->ts; f->ts += n;
  for (int a = 0; a < cc; a++) {
    int16_t *p = (int16_t *)buff[a];
    if (!p) continue;
    for (int i = 0; i < 2 * n; i++) { f->rng = f->rng * 1664525u + 1013904223u; p[i] = (int16_t)((f->rng >> 28) & 3) - 1; }
  }
  return n;
}
static int fk_freq(openair0_device *d, openair0_config_t *c, int dummy) { (void)d; (void)c; (void)dummy; return 0; }
static int fk_gains(openair0_device *d, openair0_config_t *c) { (void)d; (void)c; return 0; }

int device_init(openair0_device *device, openair0_config_t *cfg) {
  fake_t *f = calloc(1, sizeof *f);
  f->rate = cfg[0].sample_rate; f->rng = 12345;
  fprintf(stderr, "[RADIO FALSA] sin hardware: %.2f Msps, %d canales RX, %d TX. No emite ni recibe señal real.\n",
          f->rate / 1e6, cfg[0].rx_num_channels, cfg[0].tx_num_channels);
  device->priv = f;
  device->type = USRP_B200_DEV;
  device->openair0_cfg = cfg;
  device->trx_start_func = fk_start; device->trx_stop_func = fk_noop; device->trx_end_func = fk_end;
  device->trx_write_func = fk_write; device->trx_read_func = fk_read;
  device->trx_get_stats_func = fk_noop; device->trx_reset_stats_func = fk_noop;
  device->trx_set_freq_func = fk_freq; device->trx_set_gains_func = fk_gains;
  return 0;
}

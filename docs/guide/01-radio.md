# 1. Antes de transmitir (RF)

La RF está **apagada por defecto**. Solo se emite con el plan completo y la autorización del docente.

1. Confirma por escrito con el docente: banda, frecuencia, potencia máxima, lugar/horario y si se permite antena.
2. En la pestaña **Radio**, completa el plan: banda (B3, B8, B20 o B28; el módulo no soporta B7), EARFCN, ganancia TX, modo y quién autorizó.
3. Conecta **USRP → atenuador ≥ 60 dB → módulo**, sin antena. La antena solo con permiso escrito.
4. Haz el barrido de espectro y marca *Portadora libre* solo si la portadora de 200 kHz está libre de señales reales.
5. Empieza con la ganancia en el mínimo y sube de a poco, midiendo con un analizador de espectro.
6. Escribe `EMITIR` y pulsa **Activar transmisión**. El eNB se corta solo al cumplirse la duración máxima (máx. 600 s) y la sesión queda registrada.

Para detener antes: **Detener ahora** (o `docker stop nb-enb-nbiot`).

> El panel comprueba que el plan esté completo, pero **no mide la potencia real**.

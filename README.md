# Simulación de gastos de vivienda (España / Cataluña)

Calcula el gasto mensual y acumulado de comprar (con hipoteca de tipo fijo)
o alquilar una vivienda.

## Uso

```bash
python3 simulate.py config.example.json [-o salida.csv]
python3 simulate.py config.alquiler.example.json [-o alquiler.csv]
```

El campo `modelo` del JSON selecciona el simulador (`"compra"` o `"alquiler"`).
Cada modelo genera un CSV con una fila por mes (`0` = firma) y sus columnas
propias, con `gasto_mes`, `gasto_acumulado` y `comentario` comunes. La
columna `comentario` marca hitos (`firma`, `última cuota hipoteca`,
`revisión de cuota`) para poder anotar gráficos.

## Modelo "compra"

| Campo | Significado |
|---|---|
| `tipo_operacion` | `obra_nueva` (IVA 10% + AJD 1,5%) o `segunda_mano` (ITP por tramos) |
| `itp_reducido` | Opcional, por defecto `false`. Aplica el ITP reducido del 5% plano. Solo válido con `segunda_mano`. La verificación de que el comprador cumple los requisitos (edad, familia numerosa, discapacidad, límites de renta, residencia habitual...) es responsabilidad del usuario |
| `valor_propiedad` | Precio de compra (€) |
| `entrada` | Importe aportado (€); el préstamo es `valor_propiedad − entrada` |
| `tasacion`, `notaria`, `registro`, `gestoria` | Gastos únicos de firma (€) |
| `comision_apertura_pct` | % de comisión de apertura sobre el préstamo |
| `seguro_hogar`, `seguro_vida`, `ibi`, `comunidad` | Costes recurrentes (€/año); se prorratean a €/mes. `seguro_vida` es opcional (por defecto 0) |
| `tipo_fijo` | Tipo de interés fijo anual (%) |
| `n_mensualidades` | Duración de la hipoteca (meses) |

Los tramos del ITP catalán (6–11%), el ITP y el AJD son constantes internas
de `modelos/compra.py`, no parámetros configurables.

Supuestos: sistema francés (cuota constante); el mes 0 concentra todo el
desembolso inicial; recurrentes suavizados a pago mensual; no se modelan
arras, reformas, amueblamiento, suministros, plusvalía municipal (la paga el
vendedor) ni comisiones de amortización anticipada.

## Modelo "alquiler"

| Campo | Significado |
|---|---|
| `cuota_inicial` | €/mes de la primera mensualidad |
| `incremento_pct` | % de incremento **por revisión**, compuesto. La verificación de que el valor es realista (límites del índice de referencia INE, zona tensionada...) es responsabilidad del usuario |
| `intervalo_incremento_meses` | Meses entre revisiones (p. ej. 12, o 36 para "cada 3 años"). `0` = sin revisiones (cuota constante); en ese caso `incremento_pct` debe ser 0 |
| `fianza_mensualidades` | Nº de mensualidades depositadas al inicio (fianza + garantías). Coste del mes 0, sin devolución |
| `agencia` | Opcional, por defecto 0. Comisión de agencia (€); en Cataluña la paga el propietario en los contratos nuevos |
| `seguro_hogar` | €/año de seguro de inquilario, prorrateado a €/mes |

```
cuota(mes) = cuota_inicial × (1 + incremento_pct)^(⌊(mes − 1) / intervalo⌋)
```

Los meses 1..intervalo se pagan a la cuota inicial; la primera revisión
aplica a partir del mes `intervalo + 1`. El mes 0 concentra fianza + agencia
(convención idéntica al modelo de compra). No se modelan IBI ni comunidad
(los paga el propietario), ni mudanzas ni suministros.

## Modelo "cooperativa"

Simula la adquisición a través de una cooperativa de vivienda, de forma
simplificada. Con `C` = coste total del proyecto, `π` = participación de tu
unidad, `p` = pago inicial y `s` = subvención:

```
pago inicial (tuyo) = π × p × C
hipoteca (tuya)     = π × C × (1 − p) × (1 − s)
```

La subvención se descuenta a nivel de proyecto antes de repartir la
hipoteca, por lo que el beneficio que recibes escala con tu participación.
La hipoteca (sistema francés, tipo fijo) se paga en los meses 1..n; el mes
0 concentra el pago inicial; a partir del mes n solo queda la cuota
cooperativa.

| Campo | Significado |
|---|---|
| `coste_total_proyecto` | € del proyecto completo |
| `porcentaje_participacion_pct` | % del coste que asume tu unidad |
| `pago_inicial_pct` | % del coste total pagado por adelantado, a nivel de proyecto. Lo habitual en cooperativas es 5–15%; fuera de ese rango el modelo avisa (no es error) |
| `subvencion_pct` | % del coste restante (tras el pago inicial) subvencionado por entidades públicas |
| `tipo_fijo` | Tipo de interés fijo anual (%) |
| `n_mensualidades` | Duración de la hipoteca (meses) |
| `cuota_cooperativa` | Cuota por pertenecer a la cooperativa, en **€/mes** (a diferencia de `comunidad` en compra, que es €/año prorrateado) |

Supuestos y omisiones: los pagos escalonados durante la construcción
ocurren todos en el mes 0; se ignoran el seguro de hogar, los gastos de
subrogación/tasación/notaría/registro y los impuestos (IVA, AJD o ITP según
la tipología del proyecto).

## Campo común

`horizonte_meses` o `horizonte_anios`: horizonte de la simulación, en ambos
modelos. Puede superar la duración de la hipoteca (a partir de su
liquidación solo quedan los recurrentes). Si se dan ambos, deben ser
consistentes.

## Interfaz gráfica

Aplicación **estática, sin backend**: abre `web/index.html` directamente en
cualquier navegador (doble clic) o sirvela desde cualquier hosting
estático (GitHub Pages, etc.). No necesita Python ni conexión a internet:
toda la simulación se ejecuta en el navegador y Chart.js está vendoreado.

Para compartirla basta enviar la carpeta `web/`.

La interfaz muestra un grupo por modelo con un botón «+ Añadir
instancia». Cada instancia es un recuadro con: un campo **nombre** (que es
la etiqueta de su línea en los gráficos y en la leyenda), un checkbox de
activo, un botón para quitarla (✕), sus parámetros (precargados con los
valores de los `config.*example.json`) y su resumen. Añadir o quitar una
instancia añade o elimina su línea de los gráficos. La primera instancia
de cada modelo se llama como el modelo y las siguientes reciben sufijo
numérico (`compra 2`); el color se asigna por instancia y se refleja en el
borde izquierdo del recuadro.

Junto a las instancias hay un horizonte temporal global y dos gráficos
comparativos con una línea por instancia activa: gasto mensual y gasto
acumulado (eje X: meses; eje Y: euros). Los hitos (`firma`, `última
cuota hipoteca`, `revisión de cuota`) se marcan sobre las líneas. El
gráfico mensual permite ocultar el pico del mes 0 (gastos de firma) con un
checkbox. Todo se recalcula en tiempo real al cambiar cualquier parámetro
(los errores de validación se muestran en el recuadro de la instancia
afectada, sin romper el resto).

La lógica de simulación del navegador vive en `web/modelos.js`, una
traducción a JavaScript del paquete `modelos/` (Python). El CLI
`simulate.py` sigue usando la versión Python, que es la implementación de
referencia: **cualquier cambio debe aplicarse en ambas y mantenerse en
paridad** (existe una prueba de paridad que compara las series fila a fila,
ver abajo).

## Añadir nuevos modelos

Los modelos viven en `modelos/`, cada uno en su módulo. Para añadir uno
nuevo, crea un módulo que exponga `NOMBRE`, `COLUMNAS`, `cargar(data)`,
`simular(cfg, horizonte)` y `resumen(cfg, filas)`, y regístralo en la lista
`MODULOS_MODELO` de `modelos/__init__.py`. La interfaz de cada modelo está
documentada en ese fichero.

Para que el modelo aparezca también en la interfaz gráfica:
1. Tradúcelo a JavaScript en `web/modelos.js` (misma interfaz) y añádelo
   al registro `MODELOS`.
2. Añade su entrada en `ESPECIFICACION_UI` describiendo los campos del
   formulario y sus valores por defecto.
3. Crea su `config.<modelo>.example.json` (valores por defecto del CLI).

Comprueba la paridad Python/JS ejecutando las simulaciones de ambos con
los mismos parámetros y comparando las series fila a fila.

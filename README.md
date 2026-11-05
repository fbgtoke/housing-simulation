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

## Campo común

`horizonte_meses` o `horizonte_anios`: horizonte de la simulación, en ambos
modelos. Puede superar la duración de la hipoteca (a partir de su
liquidación solo quedan los recurrentes). Si se dan ambos, deben ser
consistentes.

## Añadir nuevos modelos

Los modelos viven en `modelos/`, cada uno en su módulo. Para añadir uno
nuevo, crea un módulo que exponga `NOMBRE`, `COLUMNAS`, `cargar(data)`,
`simular(cfg, horizonte)` y `resumen(cfg, filas)`, y regístralo en la lista
`MODULOS_MODELO` de `modelos/__init__.py`. La interfaz de cada modelo está
documentada en ese fichero.

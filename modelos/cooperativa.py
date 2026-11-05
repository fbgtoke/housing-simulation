"""Modelo de adquisición de vivienda mediante cooperativa.

Modelo simplificado: el proyecto tiene un coste total, del que todas las
unidades de convivencia pagan por adelantado un porcentaje; del coste
restante, una parte se subvenciona y la cooperativa hipoteca el resto,
que luego se subroga a cada unidad según su participación.

Flujo del dinero (C = coste total, π = participación, p = pago inicial,
s = subvención):

    pago inicial (mío) = π × p × C
    hipoteca (mía)     = π × C × (1 − p) × (1 − s)

La subvención se descuenta a nivel de proyecto antes de repartir la
hipoteca, por lo que el beneficio que recibe cada unidad escala con su
participación.
"""

from __future__ import annotations

from dataclasses import dataclass

from .comun import ConfigError, comprobar_campos, resolver_horizonte

NOMBRE = "cooperativa"

COLUMNAS = ["mes", "cuota_hipoteca", "cuota_cooperativa", "gasto_mes",
            "gasto_acumulado", "comentario"]

CAMPOS_OBLIGATORIOS = {
    "coste_total_proyecto", "porcentaje_participacion_pct", "pago_inicial_pct",
    "subvencion_pct", "tipo_fijo", "n_mensualidades", "cuota_cooperativa",
}
CAMPOS_OPCIONALES = {"horizonte_meses", "horizonte_anios"}

# Rango habitual del pago inicial en cooperativas; fuera de estos límites
# el modelo solo avisa (no es un error).
PAGO_INICIAL_MIN_PCT = 5.0
PAGO_INICIAL_MAX_PCT = 15.0


@dataclass(frozen=True)
class Config:
    coste_total_proyecto: float  # €
    porcentaje_participacion_pct: float  # π: % del coste que asume mi unidad
    pago_inicial_pct: float  # p: % del coste total pagado por adelantado
    subvencion_pct: float  # s: % del coste restante subvencionado
    tipo_fijo: float  # % anual
    n_mensualidades: int
    cuota_cooperativa: float  # €/mes, sin prorrateo


def cargar(data: dict) -> tuple[Config, int]:
    """Valida la configuración y devuelve (config, horizonte en meses)."""
    comprobar_campos(data, CAMPOS_OBLIGATORIOS, CAMPOS_OPCIONALES, NOMBRE)
    horizonte = resolver_horizonte(data)

    cfg = Config(
        coste_total_proyecto=float(data["coste_total_proyecto"]),
        porcentaje_participacion_pct=float(data["porcentaje_participacion_pct"]),
        pago_inicial_pct=float(data["pago_inicial_pct"]),
        subvencion_pct=float(data["subvencion_pct"]),
        tipo_fijo=float(data["tipo_fijo"]),
        n_mensualidades=int(data["n_mensualidades"]),
        cuota_cooperativa=float(data["cuota_cooperativa"]),
    )

    if cfg.coste_total_proyecto <= 0:
        raise ConfigError("'coste_total_proyecto' debe ser positivo")
    if not 0 < cfg.porcentaje_participacion_pct <= 100:
        raise ConfigError("'porcentaje_participacion_pct' debe estar en (0, 100]")
    if not 0 < cfg.pago_inicial_pct < 100:
        raise ConfigError("'pago_inicial_pct' debe estar en (0, 100)")
    if not 0 <= cfg.subvencion_pct <= 100:
        raise ConfigError("'subvencion_pct' debe estar en [0, 100]")
    if cfg.tipo_fijo < 0:
        raise ConfigError("'tipo_fijo' no puede ser negativo")
    if cfg.n_mensualidades <= 0:
        raise ConfigError("'n_mensualidades' debe ser positivo")
    if cfg.cuota_cooperativa < 0:
        raise ConfigError("'cuota_cooperativa' no puede ser negativa")

    return cfg, horizonte


# ---------------------------------------------------------------------------
# Cálculos
# ---------------------------------------------------------------------------

def participacion(cfg: Config) -> float:
    """Coste total que asume mi unidad (π × C), antes de subvenciones."""
    return cfg.coste_total_proyecto * cfg.porcentaje_participacion_pct / 100


def pago_inicial(cfg: Config) -> float:
    """Parte del pago inicial adelantado que corresponde a mi unidad."""
    return participacion(cfg) * cfg.pago_inicial_pct / 100


def subvencion_unidad(cfg: Config) -> float:
    """Beneficio de la subvención que corresponde a mi unidad."""
    return (participacion(cfg) * (1 - cfg.pago_inicial_pct / 100)
            * cfg.subvencion_pct / 100)


def hipoteca_unidad(cfg: Config) -> float:
    """Capital de la hipoteca subrogada a mi unidad."""
    return (participacion(cfg) * (1 - cfg.pago_inicial_pct / 100)
            * (1 - cfg.subvencion_pct / 100))


def cuota_hipoteca(prestamo: float, tipo_fijo: float, n: int) -> float:
    """Sistema francés: cuota constante con tipo fijo anual (como en compra)."""
    if prestamo == 0:
        return 0.0
    i = tipo_fijo / 100 / 12
    if i == 0:
        return prestamo / n
    return prestamo * i / (1 - (1 + i) ** -n)


# ---------------------------------------------------------------------------
# Simulación
# ---------------------------------------------------------------------------

def simular(cfg: Config, horizonte: int) -> list[dict]:
    """Genera una fila por mes, de 0 (firma) a `horizonte`.

    Convención idéntica a los otros modelos: el mes 0 concentra el pago
    inicial y las cuotas (hipoteca + cooperativa) empiezan en el mes 1.
    """
    cuota = cuota_hipoteca(hipoteca_unidad(cfg), cfg.tipo_fijo,
                           cfg.n_mensualidades)

    filas = []
    acumulado = 0.0
    for mes in range(0, horizonte + 1):
        if mes == 0:
            cuota_hip, cuota_coop, gasto = 0.0, 0.0, pago_inicial(cfg)
            comentario = "firma"
        else:
            cuota_hip = cuota if mes <= cfg.n_mensualidades else 0.0
            cuota_coop = cfg.cuota_cooperativa
            gasto = cuota_hip + cuota_coop
            if mes == cfg.n_mensualidades:
                comentario = "última cuota hipoteca"
            else:
                comentario = ""
        acumulado += gasto
        filas.append({
            "mes": mes,
            "cuota_hipoteca": cuota_hip,
            "cuota_cooperativa": cuota_coop,
            "gasto_mes": gasto,
            "gasto_acumulado": acumulado,
            "comentario": comentario,
        })
    return filas


def resumen(cfg: Config, filas: list[dict]) -> str:
    prestamo = hipoteca_unidad(cfg)
    cuota = filas[1]["cuota_hipoteca"] if len(filas) > 1 else 0.0
    total_hipoteca = cuota * cfg.n_mensualidades
    lineas = [
        f"Coste total proyecto:     {cfg.coste_total_proyecto:,.2f} €",
        f"Mi participación:         {cfg.porcentaje_participacion_pct}%  "
        f"({participacion(cfg):,.2f} €)",
        f"Pago inicial:             {pago_inicial(cfg):,.2f} €  "
        f"({cfg.pago_inicial_pct}% del proyecto)",
        f"Subvención (mi parte):    {subvencion_unidad(cfg):,.2f} €",
        f"Mi hipoteca:              {prestamo:,.2f} €",
        f"Cuota mensual:            {cuota:,.2f} €  "
        f"({cfg.n_mensualidades} meses a {cfg.tipo_fijo}%)",
        f"Cuota cooperativa:        {cfg.cuota_cooperativa:,.2f} €/mes",
        f"Total hipoteca:           {total_hipoteca:,.2f} €",
        f"Intereses totales:        {total_hipoteca - prestamo:,.2f} €",
    ]
    if not PAGO_INICIAL_MIN_PCT <= cfg.pago_inicial_pct <= PAGO_INICIAL_MAX_PCT:
        lineas.append(
            f"Aviso: el pago inicial ({cfg.pago_inicial_pct}%) está fuera "
            f"del rango habitual de "
            f"{PAGO_INICIAL_MIN_PCT:.0f}-{PAGO_INICIAL_MAX_PCT:.0f}% en "
            "cooperativas (esto es solo un aviso, no un error del modelo)."
        )
    return "\n".join(lineas)

"""Modelo de compra de vivienda (España, Cataluña)."""

from __future__ import annotations

from dataclasses import dataclass

from .comun import ConfigError, comprobar_campos, resolver_horizonte

NOMBRE = "compra"

COLUMNAS = ["mes", "cuota_hipoteca", "recurrentes", "gasto_mes",
            "gasto_acumulado", "comentario"]

CAMPOS_OBLIGATORIOS = {
    "tipo_operacion", "valor_propiedad", "entrada", "tasacion",
    "comision_apertura_pct", "notaria", "registro", "gestoria",
    "seguro_hogar", "ibi", "comunidad", "tipo_fijo", "n_mensualidades",
}
CAMPOS_OPCIONALES = {"itp_reducido", "seguro_vida", "horizonte_meses", "horizonte_anios"}

# ---------------------------------------------------------------------------
# Constantes fiscales (Cataluña). No son parámetros libres del modelo: se
# derivan de `tipo_operacion` y `itp_reducido`.
# ---------------------------------------------------------------------------

# Tramos del ITP (segunda mano), aplicados de forma progresiva.
ITP_TRAMOS = [
    (100_000, 0.06),
    (200_000, 0.07),
    (400_000, 0.08),
    (600_000, 0.09),
    (1_000_000, 0.10),
    (float("inf"), 0.11),
]
IVA_PCT = 0.10  # obra nueva
AJD_PCT = 0.015  # obra nueva
ITP_REDUCIDO_PCT = 0.05  # ITP reducido (circunstancias del comprador)


@dataclass(frozen=True)
class Config:
    tipo_operacion: str  # "obra_nueva" | "segunda_mano"
    valor_propiedad: float  # €
    entrada: float  # €
    tasacion: float  # €
    comision_apertura_pct: float  # % sobre el préstamo
    notaria: float  # €
    registro: float  # €
    gestoria: float  # €
    seguro_hogar: float  # €/año
    seguro_vida: float  # €/año
    ibi: float  # €/año
    comunidad: float  # €/año
    tipo_fijo: float  # % anual
    n_mensualidades: int
    itp_reducido: bool = False  # ITP al 5% (solo segunda_mano)


def cargar(data: dict) -> tuple[Config, int]:
    """Valida la configuración y devuelve (config, horizonte en meses)."""
    comprobar_campos(data, CAMPOS_OBLIGATORIOS, CAMPOS_OPCIONALES, NOMBRE)
    horizonte = resolver_horizonte(data)

    if data["tipo_operacion"] not in ("obra_nueva", "segunda_mano"):
        raise ConfigError("'tipo_operacion' debe ser 'obra_nueva' o 'segunda_mano'")

    cfg = Config(
        tipo_operacion=data["tipo_operacion"],
        valor_propiedad=float(data["valor_propiedad"]),
        entrada=float(data["entrada"]),
        tasacion=float(data["tasacion"]),
        comision_apertura_pct=float(data["comision_apertura_pct"]),
        notaria=float(data["notaria"]),
        registro=float(data["registro"]),
        gestoria=float(data["gestoria"]),
        seguro_hogar=float(data["seguro_hogar"]),
        seguro_vida=float(data.get("seguro_vida", 0.0)),
        ibi=float(data["ibi"]),
        comunidad=float(data["comunidad"]),
        tipo_fijo=float(data["tipo_fijo"]),
        n_mensualidades=int(data["n_mensualidades"]),
        itp_reducido=bool(data.get("itp_reducido", False)),
    )

    if cfg.itp_reducido and cfg.tipo_operacion != "segunda_mano":
        raise ConfigError(
            "'itp_reducido' solo es aplicable a operaciones de segunda mano"
        )
    if cfg.entrada >= cfg.valor_propiedad:
        raise ConfigError("'entrada' debe ser menor que 'valor_propiedad'")
    if cfg.n_mensualidades <= 0:
        raise ConfigError("'n_mensualidades' debe ser positivo")
    if cfg.tipo_fijo < 0:
        raise ConfigError("'tipo_fijo' no puede ser negativo")
    for campo in ("valor_propiedad", "entrada", "tasacion", "notaria",
                  "registro", "gestoria", "seguro_hogar", "seguro_vida",
                  "ibi", "comunidad"):
        if getattr(cfg, campo) < 0:
            raise ConfigError(f"'{campo}' no puede ser negativo")

    return cfg, horizonte


# ---------------------------------------------------------------------------
# Cálculos
# ---------------------------------------------------------------------------

def calcular_itp(valor: float, reducido: bool = False) -> float:
    """ITP catalán: tramos progresivos, o 5% plano si aplica el reducido."""
    if reducido:
        return valor * ITP_REDUCIDO_PCT
    total = 0.0
    anterior = 0.0
    for limite, tipo in ITP_TRAMOS:
        if valor <= limite:
            return total + (valor - anterior) * tipo
        total += (limite - anterior) * tipo
        anterior = limite
    return total


def calcular_impuestos(cfg: Config) -> float:
    if cfg.tipo_operacion == "obra_nueva":
        return cfg.valor_propiedad * (IVA_PCT + AJD_PCT)
    return calcular_itp(cfg.valor_propiedad, cfg.itp_reducido)


def cuota_hipoteca(prestamo: float, tipo_fijo: float, n: int) -> float:
    """Sistema francés: cuota constante con tipo fijo anual."""
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
    """Genera una fila por mes, de 0 (firma) a `horizonte`."""
    prestamo = cfg.valor_propiedad - cfg.entrada
    cuota = cuota_hipoteca(prestamo, cfg.tipo_fijo, cfg.n_mensualidades)
    impuestos = calcular_impuestos(cfg)
    comision_apertura = prestamo * cfg.comision_apertura_pct / 100
    recurrentes_mes = (cfg.seguro_hogar + cfg.seguro_vida
                       + cfg.ibi + cfg.comunidad) / 12

    desembolso_firma = (cfg.entrada + impuestos + cfg.tasacion
                        + comision_apertura + cfg.notaria + cfg.registro
                        + cfg.gestoria)

    filas = []
    acumulado = 0.0
    for mes in range(0, horizonte + 1):
        if mes == 0:
            cuota_mes, rec_mes, gasto = 0.0, 0.0, desembolso_firma
            comentario = "firma"
        else:
            cuota_mes = cuota if mes <= cfg.n_mensualidades else 0.0
            rec_mes = recurrentes_mes
            gasto = cuota_mes + rec_mes
            if mes == cfg.n_mensualidades:
                comentario = "última cuota hipoteca"
            else:
                comentario = ""
        acumulado += gasto
        filas.append({
            "mes": mes,
            "cuota_hipoteca": cuota_mes,
            "recurrentes": rec_mes,
            "gasto_mes": gasto,
            "gasto_acumulado": acumulado,
            "comentario": comentario,
        })
    return filas


def resumen(cfg: Config, filas: list[dict]) -> str:
    prestamo = cfg.valor_propiedad - cfg.entrada
    cuota = filas[1]["cuota_hipoteca"] if len(filas) > 1 else 0.0
    total_hipoteca = cuota * cfg.n_mensualidades
    ltv = prestamo / cfg.valor_propiedad * 100
    detalle_imp = (
        "ITP reducido (5%)" if cfg.itp_reducido
        else "ITP tramos 6-11%" if cfg.tipo_operacion == "segunda_mano"
        else "IVA 10% + AJD 1,5%"
    )
    lineas = [
        f"Operación:            {cfg.tipo_operacion}",
        f"Valor propiedad:      {cfg.valor_propiedad:,.2f} €",
        f"Entrada:              {cfg.entrada:,.2f} €",
        f"Préstamo:             {prestamo:,.2f} €  (LTV {ltv:.1f}%)",
        f"Impuestos:            {calcular_impuestos(cfg):,.2f} €  ({detalle_imp})",
        f"Desembolso en firma:  {filas[0]['gasto_mes']:,.2f} €",
        f"Cuota mensual:        {cuota:,.2f} €  ({cfg.n_mensualidades} meses a {cfg.tipo_fijo}%)",
        f"Total hipoteca:       {total_hipoteca:,.2f} €",
        f"Intereses totales:    {total_hipoteca - prestamo:,.2f} €",
    ]
    if ltv > 80:
        lineas.append(
            "Aviso: LTV > 80%; la mayoría de bancos no financian por encima "
            "de ese umbral (esto es solo un aviso, no un error del modelo)."
        )
    return "\n".join(lineas)

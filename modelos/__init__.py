"""Registro de modelos de simulación disponibles.

Para añadir un nuevo modelo: crea un módulo en este paquete que exponga

    NOMBRE:    str               # valor del campo "modelo" en el JSON
    COLUMNAS:  list[str]         # columnas del CSV
    cargar(data)                 # valida el JSON -> (Config, horizonte_meses)
    simular(cfg, horizonte)      # -> list[dict], claves = COLUMNAS
    resumen(cfg, filas)          # -> str, resumen para consola

e impórtalo en la lista MODELO_MODULES de abajo.
"""

from . import alquiler, compra, cooperativa

MODULOS_MODELO = (compra, alquiler, cooperativa)

MODELOS = {mod.NOMBRE: mod for mod in MODULOS_MODELO}

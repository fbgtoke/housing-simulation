#!/usr/bin/env python3
"""
Servidor web local para visualizar y comparar las simulaciones.

Arranca un servidor en 127.0.0.1 que sirve la interfaz de web/ y expone
una API que ejecuta los modelos del paquete modelos/. Toda la lógica de
simulación vive en modelos/; este fichero solo la expone por HTTP.

Uso:
    python app.py [--puerto 8000] [--no-abrir-navegador]
"""

from __future__ import annotations

import argparse
import json
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from modelos import MODELOS
from modelos.comun import ConfigError

RAIZ = Path(__file__).resolve().parent
DIR_WEB = RAIZ / "web"

# ---------------------------------------------------------------------------
# Descripción de los campos de la interfaz de cada modelo. Los valores por
# defecto se toman de los ficheros config.<modelo>.example.json.
#
# Para añadir un modelo nuevo: registrar el módulo en modelos/__init__.py,
# añadir su entrada aquí y crear su config de ejemplo.
# ---------------------------------------------------------------------------

CAMPOS_UI: dict[str, list[dict]] = {
    "compra": [
        {"clave": "tipo_operacion", "etiqueta": "Tipo de operación",
         "tipo": "selector", "opciones": ["obra_nueva", "segunda_mano"]},
        {"clave": "itp_reducido", "etiqueta": "ITP reducido (5%)",
         "tipo": "booleano"},
        {"clave": "valor_propiedad", "etiqueta": "Valor de la propiedad (€)",
         "tipo": "numero"},
        {"clave": "entrada", "etiqueta": "Entrada (€)", "tipo": "numero"},
        {"clave": "tasacion", "etiqueta": "Tasación (€)", "tipo": "numero"},
        {"clave": "comision_apertura_pct",
         "etiqueta": "Comisión de apertura (% s/ préstamo)", "tipo": "numero"},
        {"clave": "notaria", "etiqueta": "Notaría (€)", "tipo": "numero"},
        {"clave": "registro", "etiqueta": "Registro de la propiedad (€)",
         "tipo": "numero"},
        {"clave": "gestoria", "etiqueta": "Gestoría (€)", "tipo": "numero"},
        {"clave": "seguro_hogar", "etiqueta": "Seguro de hogar (€/año)",
         "tipo": "numero"},
        {"clave": "seguro_vida", "etiqueta": "Seguro de vida (€/año)",
         "tipo": "numero"},
        {"clave": "ibi", "etiqueta": "IBI (€/año)", "tipo": "numero"},
        {"clave": "comunidad", "etiqueta": "Comunidad (€/año)",
         "tipo": "numero"},
        {"clave": "tipo_fijo", "etiqueta": "Tipo de interés fijo (%)",
         "tipo": "numero"},
        {"clave": "n_mensualidades", "etiqueta": "Mensualidades",
         "tipo": "numero"},
    ],
    "alquiler": [
        {"clave": "cuota_inicial", "etiqueta": "Cuota mensual inicial (€)",
         "tipo": "numero"},
        {"clave": "incremento_pct",
         "etiqueta": "Incremento por revisión (%)", "tipo": "numero"},
        {"clave": "intervalo_incremento_meses",
         "etiqueta": "Meses entre revisiones", "tipo": "numero"},
        {"clave": "fianza_mensualidades",
         "etiqueta": "Fianza (nº de mensualidades)", "tipo": "numero"},
        {"clave": "agencia", "etiqueta": "Comisión de agencia (€)",
         "tipo": "numero"},
        {"clave": "seguro_hogar", "etiqueta": "Seguro de hogar (€/año)",
         "tipo": "numero"},
    ],
    "cooperativa": [
        {"clave": "coste_total_proyecto",
         "etiqueta": "Coste total del proyecto (€)", "tipo": "numero"},
        {"clave": "porcentaje_participacion_pct",
         "etiqueta": "Participación de mi unidad (%)", "tipo": "numero"},
        {"clave": "pago_inicial_pct",
         "etiqueta": "Pago inicial del proyecto (%)", "tipo": "numero"},
        {"clave": "subvencion_pct",
         "etiqueta": "Subvención del coste restante (%)", "tipo": "numero"},
        {"clave": "tipo_fijo", "etiqueta": "Tipo de interés fijo (%)",
         "tipo": "numero"},
        {"clave": "n_mensualidades", "etiqueta": "Mensualidades",
         "tipo": "numero"},
        {"clave": "cuota_cooperativa",
         "etiqueta": "Cuota cooperativa (€/mes)", "tipo": "numero"},
    ],
}

TIPOS_MIME = {".html": "text/html", ".js": "text/javascript",
              ".css": "text/css", ".svg": "image/svg+xml"}


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------

def valores_defecto() -> dict[str, dict]:
    """Lee los config.<modelo>.example.json como valores por defecto."""
    defectos: dict[str, dict] = {}
    for fichero in RAIZ.glob("config*example.json"):
        try:
            data = json.loads(fichero.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        nombre = data.get("modelo")
        if nombre in MODELOS:
            defectos[nombre] = data
    return defectos


def describir_modelos() -> dict:
    """Especificación de la interfaz: campos y valores por defecto."""
    defectos = valores_defecto()
    return {
        nombre: {
            "campos": CAMPOS_UI[nombre],
            "defectos": defectos.get(nombre, {}),
        }
        for nombre in MODELOS
        if nombre in CAMPOS_UI
    }


def simular(payload: dict) -> dict:
    """Ejecuta los modelos solicitados y devuelve sus series.

    payload: {"horizonte_meses": int, "modelos": {nombre: {valores...}}}
    Los modelos con parámetros inválidos devuelven {"error": "..."} en
    lugar de serie; el resto de modelos se calcula igualmente.
    """
    horizonte = int(payload["horizonte_meses"])
    resultado: dict[str, dict] = {}
    for nombre, valores in payload.get("modelos", {}).items():
        modelo = MODELOS.get(nombre)
        if modelo is None:
            resultado[nombre] = {"error": f"modelo desconocido: {nombre}"}
            continue
        data = dict(valores)
        data["modelo"] = nombre
        data["horizonte_meses"] = horizonte
        try:
            cfg, h = modelo.cargar(data)
            filas = modelo.simular(cfg, h)
            resultado[nombre] = {
                "resumen": modelo.resumen(cfg, filas),
                "serie": {
                    "gasto_mes": [f["gasto_mes"] for f in filas],
                    "gasto_acumulado": [f["gasto_acumulado"] for f in filas],
                    "comentarios": [
                        {"mes": f["mes"], "texto": f["comentario"]}
                        for f in filas if f["comentario"]
                    ],
                },
            }
        except (ConfigError, TypeError, ValueError, KeyError) as e:
            resultado[nombre] = {"error": str(e) or e.__class__.__name__}
    return resultado


# ---------------------------------------------------------------------------
# Servidor HTTP
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):

    def do_GET(self):
        if self.path == "/api/modelos":
            self._responder_json(describir_modelos())
        else:
            self._servir_estatico(self.path)

    def do_POST(self):
        if self.path != "/api/simular":
            self._responder_json({"error": "ruta desconocida"}, codigo=404)
            return
        try:
            longitud = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(longitud))
            self._responder_json(simular(payload))
        except (ValueError, json.JSONDecodeError) as e:
            self._responder_json({"error": f"payload inválido: {e}"},
                                 codigo=400)

    def _responder_json(self, objeto, codigo=200):
        cuerpo = json.dumps(objeto, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def _servir_estatico(self, ruta):
        ruta = ruta.split("?", 1)[0]
        if ruta == "/":
            ruta = "/index.html"
        fichero = (DIR_WEB / ruta.lstrip("/")).resolve()
        if not fichero.is_file() or DIR_WEB.resolve() not in fichero.parents:
            self.send_error(404)
            return
        cuerpo = fichero.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TIPOS_MIME.get(
            fichero.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(cuerpo)))
        self.end_headers()
        self.wfile.write(cuerpo)

    def log_message(self, formato, *args):
        pass  # silencia el log de cada petición


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Interfaz web para comparar simulaciones de vivienda."
    )
    parser.add_argument("--puerto", type=int, default=8000)
    parser.add_argument("--no-abrir-navegador", action="store_true")
    args = parser.parse_args()

    servidor = ThreadingHTTPServer(("127.0.0.1", args.puerto), Handler)
    url = f"http://127.0.0.1:{args.puerto}"
    print(f"Interfaz disponible en {url} (Ctrl+C para parar)")
    if not args.no_abrir_navegador:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nParando el servidor.")


if __name__ == "__main__":
    main()

"use strict";

// Interfaz interactiva: una sección de parámetros por modelo y dos gráficos
// comparativos (gasto mensual y gasto acumulado) que se recalculan con
// debounce en cada cambio. La lógica de simulación vive en el backend
// (paquete modelos/); aquí solo se recogen parámetros y se pintan series.

const PALETA = ["#2563eb", "#16a34a", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
const DEBOUNCE_MS = 300;

let especificacion = null;  // respuesta de /api/modelos
const colorModelo = {};     // nombre de modelo -> color de su línea
let graficoMensual = null;
let graficoAcumulado = null;
let temporizador = null;

function formatoEUR(valor) {
    return valor.toLocaleString("es-ES", { maximumFractionDigits: 0 }) + " €";
}

// ---------------------------------------------------------------------------
// Construcción de la interfaz
// ---------------------------------------------------------------------------

function crearCampo(campo, defectos) {
    const envoltorio = document.createElement("label");
    envoltorio.className = "campo";
    const etiqueta = document.createElement("span");
    etiqueta.textContent = campo.etiqueta;
    envoltorio.appendChild(etiqueta);

    let entrada;
    if (campo.tipo === "booleano") {
        entrada = document.createElement("input");
        entrada.type = "checkbox";
        entrada.checked = Boolean(defectos[campo.clave]);
        envoltorio.classList.add("booleano");
    } else if (campo.tipo === "selector") {
        entrada = document.createElement("select");
        for (const opcion of campo.opciones) {
            const option = document.createElement("option");
            option.value = opcion;
            option.textContent = opcion;
            entrada.appendChild(option);
        }
        entrada.value = defectos[campo.clave] ?? campo.opciones[0];
    } else {  // numero
        entrada = document.createElement("input");
        entrada.type = "number";
        entrada.step = "any";
        entrada.value = defectos[campo.clave] ?? 0;
    }
    entrada.dataset.clave = campo.clave;
    envoltorio.appendChild(entrada);
    return envoltorio;
}

function renderizarSecciones() {
    const contenedor = document.getElementById("modelos");
    for (const [nombre, spec] of Object.entries(especificacion)) {
        const seccion = document.createElement("section");
        seccion.className = "modelo";
        seccion.dataset.modelo = nombre;

        const cabecera = document.createElement("div");
        cabecera.className = "cabecera";
        const activo = document.createElement("input");
        activo.type = "checkbox";
        activo.className = "activo";
        activo.checked = true;
        const titulo = document.createElement("strong");
        titulo.textContent = nombre;
        cabecera.append(activo, titulo);

        const error = document.createElement("div");
        error.className = "error";

        const campos = document.createElement("div");
        campos.className = "campos";
        for (const campo of spec.campos) {
            campos.appendChild(crearCampo(campo, spec.defectos));
        }

        const resumen = document.createElement("pre");
        resumen.className = "resumen";

        seccion.append(cabecera, error, campos, resumen);
        contenedor.appendChild(seccion);
    }
}

function recogerValores(seccion) {
    const valores = {};
    seccion.querySelectorAll("[data-clave]").forEach((entrada) => {
        const clave = entrada.dataset.clave;
        if (entrada.type === "checkbox") {
            valores[clave] = entrada.checked;
        } else if (entrada.type === "number") {
            valores[clave] = parseFloat(entrada.value);
        } else {
            valores[clave] = entrada.value;
        }
    });
    return valores;
}

// ---------------------------------------------------------------------------
// Recálculo
// ---------------------------------------------------------------------------

async function recalcular() {
    const valor = parseFloat(document.getElementById("horizonte").value);
    const unidades = document.getElementById("horizonte-unidades").value;
    const horizonteMeses = Math.round(valor * (unidades === "anios" ? 12 : 1));
    if (!Number.isFinite(horizonteMeses) || horizonteMeses < 1) return;

    const modelos = {};
    document.querySelectorAll("section.modelo").forEach((seccion) => {
        if (seccion.querySelector(".activo").checked) {
            modelos[seccion.dataset.modelo] = recogerValores(seccion);
        }
    });

    const respuesta = await fetch("/api/simular", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ horizonte_meses: horizonteMeses, modelos }),
    });
    const resultado = await respuesta.json();
    actualizarSecciones(resultado);
    actualizarGraficos(resultado);
}

function programarRecalculo() {
    clearTimeout(temporizador);
    temporizador = setTimeout(recalcular, DEBOUNCE_MS);
}

function actualizarSecciones(resultado) {
    document.querySelectorAll("section.modelo").forEach((seccion) => {
        const res = resultado[seccion.dataset.modelo];
        const error = seccion.querySelector(".error");
        const resumen = seccion.querySelector(".resumen");
        if (!res) {  // modelo inactivo
            error.textContent = "";
            resumen.textContent = "";
            return;
        }
        error.textContent = res.error || "";
        resumen.textContent = res.error ? "" : res.resumen;
    });
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------

function configuracionGrafico(titulo, etiquetaY) {
    return {
        type: "line",
        data: { datasets: [] },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "nearest", axis: "x", intersect: false },
            scales: {
                x: {
                    type: "linear",
                    title: { display: true, text: "mes" },
                    ticks: { stepSize: 12, maxRotation: 0, autoSkip: false },
                },
                y: {
                    title: { display: true, text: etiquetaY },
                    ticks: { callback: (v) => formatoEUR(v) },
                },
            },
            plugins: {
                title: { display: true, text: titulo },
                legend: {
                    labels: {
                        filter: (item, data) =>
                            !data.datasets[item.datasetIndex].marcador,
                    },
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.marcador) {
                                return ` ${ctx.raw.texto} (mes ${ctx.parsed.x})`;
                            }
                            return ` ${ctx.dataset.label}: ${formatoEUR(ctx.parsed.y)}`;
                        },
                    },
                },
            },
        },
    };
}

function construirDatasets(resultado, claveSerie, incluirMes0) {
    const datasets = [];
    for (const [nombre, res] of Object.entries(resultado)) {
        if (!res.serie) continue;
        const color = colorModelo[nombre];

        datasets.push({
            label: nombre,
            data: res.serie[claveSerie].map((v, mes) => ({
                x: mes,
                y: mes === 0 && !incluirMes0 ? null : v,
            })),
            borderColor: color,
            backgroundColor: color,
            borderWidth: 2,
            pointRadius: 0,
        });

        // Hitos (firma, revisiones, última cuota) como marcadores.
        const marcadores = res.serie.comentarios
            .filter((c) => incluirMes0 || c.mes !== 0)
            .map((c) => ({
                x: c.mes,
                y: res.serie[claveSerie][c.mes],
                texto: c.texto,
            }));
        if (marcadores.length > 0) {
            datasets.push({
                marcador: true,
                type: "scatter",
                label: nombre,
                data: marcadores,
                backgroundColor: color,
                pointRadius: 5,
                pointStyle: "rectRot",
            });
        }
    }
    return datasets;
}

function actualizarGraficos(resultado) {
    const incluirFirma = document.getElementById("incluir-firma").checked;
    graficoMensual.data.datasets =
        construirDatasets(resultado, "gasto_mes", incluirFirma);
    graficoAcumulado.data.datasets =
        construirDatasets(resultado, "gasto_acumulado", true);
    graficoMensual.update("none");
    graficoAcumulado.update("none");
}

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

async function iniciar() {
    const respuesta = await fetch("/api/modelos");
    especificacion = await respuesta.json();
    Object.keys(especificacion).forEach((nombre, i) => {
        colorModelo[nombre] = PALETA[i % PALETA.length];
    });
    renderizarSecciones();

    graficoMensual = new Chart(
        document.getElementById("grafico-mensual"),
        configuracionGrafico("Gasto mensual", "gasto (€/mes)"));
    graficoAcumulado = new Chart(
        document.getElementById("grafico-acumulado"),
        configuracionGrafico("Gasto acumulado", "gasto acumulado (€)"));

    document.addEventListener("input", programarRecalculo);
    document.addEventListener("change", programarRecalculo);
    recalcular();
}

document.addEventListener("DOMContentLoaded", iniciar);

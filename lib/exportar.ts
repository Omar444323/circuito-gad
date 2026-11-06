import type { Workbook } from "exceljs";

// Una columna exportable: fecha y dinero se tratan aparte para que Excel los reconozca como tales
export type Columna = { titulo: string; clave: string; tipo?: "fecha" | "dinero" | "numero" };
export type Hoja = { nombre: string; columnas: Columna[]; filas: Record<string, unknown>[] };

const fechaEs = (v: string) => v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
const celda = (c: Columna, v: unknown) => {
  if (v === null || v === undefined || v === "") return "";
  if (c.tipo === "fecha") return fechaEs(String(v));
  if (c.tipo === "dinero") return Number(v).toFixed(2).replace(".", ",");
  if (c.tipo === "numero") return String(Number(v)).replace(".", ",");
  return String(v);
};
const comillas = (s: string) => (/[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
// Evita que Excel ejecute como fórmula un texto escrito por un alumno
const texto = (s: string) => (/^[=+\-@\t\r]/.test(s) ? "'" + s : s);

// CSV con ; y coma decimal. La BOM hace que Excel en español lea bien los acentos
export function aCsv(hojas: Hoja[]) {
  const partes = hojas.map((h) => {
    const cab = h.columnas.map((c) => comillas(c.titulo)).join(";");
    const filas = h.filas.map((f) => h.columnas.map((c) => {
      const v = celda(c, f[c.clave]);
      return comillas(c.tipo ? v : texto(v));
    }).join(";"));
    return [hojas.length > 1 ? comillas(h.nombre) : null, cab, ...filas].filter((x) => x !== null).join("\r\n");
  });
  return "﻿" + partes.join("\r\n\r\n") + "\r\n";
}

// Excel admite 31 caracteres por hoja, sin algunos signos y sin repetir nombre
export function nombreHoja(nombre: string, usados: Set<string>) {
  const limpio = nombre.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 28) || "Hoja";
  let n = limpio;
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = limpio + " " + i;
  usados.add(n.toLowerCase());
  return n;
}

export async function aXlsx(hojas: Hoja[]) {
  const { default: ExcelJS } = await import("exceljs");
  const wb: Workbook = new ExcelJS.Workbook();
  const usados = new Set<string>();
  for (const h of hojas) {
    const ws = wb.addWorksheet(nombreHoja(h.nombre, usados), { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = h.columnas.map((c) => ({ header: c.titulo, key: c.clave, width: Math.max(c.titulo.length + 2, c.tipo ? 13 : 24), style: c.tipo === "dinero" ? { numFmt: '#,##0.00 "€"' } : c.tipo === "fecha" ? { numFmt: "dd/mm/yyyy" } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const f of h.filas) {
      const fila: Record<string, unknown> = {};
      for (const c of h.columnas) {
        const v = f[c.clave];
        if (v === null || v === undefined || v === "") fila[c.clave] = null;
        else if (c.tipo === "fecha") fila[c.clave] = new Date(String(v).slice(0, 10) + "T00:00:00Z");
        else if (c.tipo === "dinero" || c.tipo === "numero") fila[c.clave] = Number(v);
        else fila[c.clave] = texto(String(v));
      }
      ws.addRow(fila);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Importador. Admite ; o tabulador, comillas dobles, fechas dd/mm/aaaa y números con coma decimal
export const COLUMNAS_IMPORTAR = ["tipo", "num", "fecha", "emisor", "receptor", "concepto", "base", "cuota", "total"] as const;
export type FilaImportada = Record<(typeof COLUMNAS_IMPORTAR)[number], string | null>;

function trocear(linea: string, sep: string) {
  const r: string[] = [];
  let cur = "";
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (dentro) {
      if (c === '"' && linea[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') dentro = false;
      else cur += c;
    } else if (c === '"') dentro = true;
    else if (c === sep) { r.push(cur); cur = ""; }
    else cur += c;
  }
  r.push(cur);
  return r.map((x) => x.trim());
}
const importe = (s: string) => (s === "" ? null : s.replace(/\s|€/g, "").replace(/\.(?=\d{3}(,|$))/g, "").replace(",", "."));
const empresa = (s: string) => (s === "" ? null : s.replace(/^g/i, ""));
function fechaIso(s: string) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : s;
}

export function leerCsv(textoCsv: string): { filas: FilaImportada[]; error?: string } {
  const lineas = textoCsv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lineas.length < 2) return { filas: [], error: "Hace falta la línea de títulos y al menos un documento." };
  const sep = lineas[0].includes("\t") ? "\t" : ";";
  const cab = trocear(lineas[0], sep).map((x) => x.toLowerCase());
  const falta = COLUMNAS_IMPORTAR.filter((c) => !cab.includes(c));
  if (falta.length) return { filas: [], error: "Faltan estas columnas: " + falta.join(", ") + "." };
  const filas = lineas.slice(1).map((l) => {
    const v = trocear(l, sep);
    const de = (k: string) => v[cab.indexOf(k)] ?? "";
    return {
      tipo: de("tipo").toLowerCase(), num: de("num"), fecha: fechaIso(de("fecha")), emisor: empresa(de("emisor")), receptor: empresa(de("receptor")), concepto: de("concepto"),
      base: importe(de("base")), cuota: importe(de("cuota")), total: importe(de("total")),
    };
  });
  return { filas };
}

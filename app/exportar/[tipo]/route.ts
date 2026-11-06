import { NextResponse, type NextRequest } from "next/server";
import { aCsv, aXlsx, type Hoja } from "@/lib/exportar";
import { sb } from "@/lib/supabase";

const LIBRO = [
  { titulo: "Tipo", clave: "tipo" }, { titulo: "Número", clave: "num" }, { titulo: "Fecha", clave: "fecha", tipo: "fecha" }, { titulo: "Sentido", clave: "sentido" }, { titulo: "Otra parte", clave: "otra" },
  { titulo: "Estado", clave: "estado" }, { titulo: "Importe", clave: "importe", tipo: "dinero" }, { titulo: "Elaboró", clave: "elaboro" }, { titulo: "Revisó", clave: "reviso" },
] as const;
const EXTRACTO = [
  { titulo: "Fecha", clave: "fecha", tipo: "fecha" }, { titulo: "Concepto", clave: "concepto" }, { titulo: "Justificante", clave: "justificante" }, { titulo: "Importe", clave: "importe", tipo: "dinero" }, { titulo: "Saldo", clave: "saldo", tipo: "dinero" },
] as const;
const FICHA = [
  { titulo: "Fecha", clave: "fecha", tipo: "fecha" }, { titulo: "Concepto", clave: "concepto" }, { titulo: "Documento", clave: "documento" },
  { titulo: "Entrada uds", clave: "entrada_uds", tipo: "numero" }, { titulo: "Entrada precio", clave: "entrada_precio", tipo: "dinero" }, { titulo: "Entrada importe", clave: "entrada_importe", tipo: "dinero" },
  { titulo: "Salida uds", clave: "salida_uds", tipo: "numero" }, { titulo: "Salida precio", clave: "salida_precio", tipo: "dinero" }, { titulo: "Salida importe", clave: "salida_importe", tipo: "dinero" },
  { titulo: "Regularización", clave: "regularizacion", tipo: "dinero" }, { titulo: "Existencias uds", clave: "existencias_uds", tipo: "numero" }, { titulo: "PMP", clave: "existencias_pmp", tipo: "dinero" }, { titulo: "Existencias importe", clave: "existencias_importe", tipo: "dinero" },
] as const;
const diaOk = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const error = (t: string, status: number) => new NextResponse(t, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

// Corre con la sesión de quien descarga: las políticas y funciones de la base de datos deciden qué puede ver
export async function GET(req: NextRequest, { params }: { params: Promise<{ tipo: string }> }) {
  const { tipo } = await params;
  const q = req.nextUrl.searchParams;
  const s = await sb();
  const { data: u } = await s.auth.getUser();
  if (!u.user) return error("Inicia sesión para descargar.", 401);
  const { data: yo } = await s.rpc("mi_empresa");
  const empresa = Number(q.get("empresa") ?? yo);
  if (!Number.isInteger(empresa) || empresa <= 0) return error("Elige una empresa.", 400);
  const desde = diaOk(q.get("desde"));
  const hasta = diaOk(q.get("hasta"));
  const { data: emp } = await s.from("empresas").select("id, corto");
  const corto = (g: number | null) => emp?.find((e) => e.id === g)?.corto ?? "";
  const quien = corto(empresa) || "empresa";
  let hojas: Hoja[];
  if (tipo === "libro") {
    const { data, error: e } = await s.rpc("archivo_documentos", { p_empresa: empresa, p_tipo: q.get("tipo") || null, p_desde: desde, p_hasta: hasta });
    if (e) return error(e.message, 403);
    hojas = [{ nombre: "Libro de documentos", columnas: [...LIBRO], filas: ((data ?? []) as { otra_id: number | null }[]).map((f) => ({ ...f, otra: corto(f.otra_id) })) }];
  } else if (tipo === "extracto") {
    let c = s.from("movimientos_banco").select("fecha, concepto, justificante, importe, saldo").eq("empresa_id", empresa).order("id");
    if (desde) c = c.gte("fecha", desde);
    if (hasta) c = c.lte("fecha", hasta);
    const { data, error: e } = await c;
    if (e) return error(e.message, 403);
    hojas = [{ nombre: "Extracto " + quien, columnas: [...EXTRACTO], filas: data ?? [] }];
  } else if (tipo === "almacen") {
    const { data: arts, error: e } = await s.rpc("almacen", { p_empresa: empresa });
    if (e) return error(e.message, 403);
    const lista = (arts ?? []) as { id: string; nombre: string }[];
    hojas = await Promise.all(lista.map(async (a) => {
      const { data } = await s.rpc("ficha_almacen", { p_articulo: a.id });
      return { nombre: a.nombre, columnas: [...FICHA], filas: (data ?? []) as Record<string, unknown>[] };
    }));
    if (!hojas.length) return error("Esta empresa no tiene almacén.", 404);
  } else return error("Esa exportación no existe.", 404);

  const nombre = `${tipo}-${quien.toLowerCase().replace(/[^a-z0-9]+/g, "")}`;
  if (q.get("formato") === "csv") return new NextResponse(aCsv(hojas), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${nombre}.csv"` } });
  return new NextResponse(new Uint8Array(await aXlsx(hojas)), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${nombre}.xlsx"` } });
}

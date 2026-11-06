import { redirect } from "next/navigation";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

type Linea = { descripcion: string; pedidos: { comprador_id: number; etapa: string; servicio: boolean } | null };
const SERVICIOS: [string, RegExp][] = [["Asesoría fiscal y laboral", /asesor/i], ["Reparación", /repara/i], ["Publicidad", /public|anuncio|campa[nñ]a/i]];

// Punto 6 de las normas. Los servicios se reconocen por el nombre de la línea, así que es una ayuda para revisar y no un veredicto
export default async function Seguimiento() {
  const yo = await miSesion();
  if (yo.rol !== "profesora") redirect("/");
  const s = await sb();
  const [{ data: emp }, { data: lin }, { data: fia }, { data: cat }, { data: ped }] = await Promise.all([
    s.from("empresas").select("id, corto").eq("tipo", "grupo").order("id"),
    s.from("pedido_lineas").select("descripcion, pedidos(comprador_id, etapa, servicio)"),
    s.from("fianzas").select("empresa_id, suministro, estado"),
    s.from("catalogo").select("empresa_id").eq("activo", true),
    s.from("pedidos").select("comprador_id, vendedor_id, fecha, etapa"),
  ]);
  const lineas = (lin ?? []) as unknown as Linea[];
  const si = (ok: boolean) => <span className={"chip " + (ok ? "good" : "off")}>{ok ? "Sí" : "No"}</span>;
  const meses = [...new Set((ped ?? []).map((p) => p.fecha.slice(0, 7)))].sort();
  return (
    <>
      <div className="head"><h1>Seguimiento de la actividad</h1><p>Operaciones recurrentes del punto 6, por empresa. Los servicios se detectan por el nombre de la línea del pedido: compruébalo antes de valorar.</p></div>
      <section className="card"><h2>Operaciones mínimas</h2>
        <div className="tw"><table className="t"><thead><tr><th>Empresa</th><th>Catálogo</th><th>Electricidad</th><th>Agua</th>{SERVICIOS.map(([n]) => <th key={n}>{n}</th>)}</tr></thead><tbody>
          {(emp ?? []).map((e) => <tr key={e.id}><td><strong>{e.corto}</strong></td><td>{si((cat ?? []).some((c) => c.empresa_id === e.id))}</td>
            {["electricidad", "agua"].map((k) => <td key={k}>{si((fia ?? []).some((z) => z.empresa_id === e.id && z.suministro === k && z.estado === "constituida"))}</td>)}
            {SERVICIOS.map(([n, r]) => <td key={n}>{si(lineas.some((l) => l.pedidos?.comprador_id === e.id && l.pedidos.servicio && l.pedidos.etapa !== "pedido_rechazado" && r.test(l.descripcion)))}</td>)}
          </tr>)}
        </tbody></table></div>
      </section>
      <section className="card"><h2>Pedidos por mes</h2>
        {meses.length ? <div className="tw"><table className="t"><thead><tr><th>Empresa</th>{meses.map((m) => <th className="num" key={m}>{m.slice(5)}/{m.slice(0, 4)}</th>)}</tr></thead><tbody>
          {(emp ?? []).map((e) => <tr key={e.id}><td><strong>{e.corto}</strong></td>{meses.map((m) => <td className="num" key={m}>{(ped ?? []).filter((p) => p.fecha.startsWith(m) && (p.comprador_id === e.id || p.vendedor_id === e.id)).length}</td>)}</tr>)}
        </tbody></table></div> : <p className="empty">Todavía no hay pedidos.</p>}
        <p className="hint" style={{ marginTop: 8 }}>Cuenta compras y ventas. Compáralo con el mínimo que indiques en cada circular.</p>
      </section>
    </>
  );
}

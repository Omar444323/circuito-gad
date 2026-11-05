import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";
import { chipEtapa, chipPlazo, type Pedido } from "@/lib/circuito";

type Fila = Pedido & { pedido_lineas: { unidades: number; precio: number }[] };

export default async function Operaciones() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: filas }, { data: empresas }, { data: hoy }] = await Promise.all([
    s.from("pedidos").select("*, plazo_limite, pedido_lineas(unidades, precio)").order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.rpc("hoy"),
  ]);
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const lista = (filas ?? []) as unknown as Fila[];
  const prof = yo.rol === "profesora";
  return (
    <>
      <div className="head"><h1>{prof ? "Todas las operaciones" : "Operaciones"}</h1>
        <p>{prof ? "Vista completa de la clase." : "Solo aparecen las operaciones en las que tu empresa compra o vende. El resto de la clase no las ve."}</p></div>
      {!prof && <div className="btns"><Link className="btn" href="/operaciones/nuevo" style={{ textDecoration: "none" }}>Nuevo pedido</Link></div>}
      <section className="card">
        {lista.length ? <div className="tw"><table className="t"><thead><tr><th>Pedido</th><th>Fecha</th><th>{prof ? "Empresas" : "Con"}</th><th>Estado</th><th className="num">Importe</th><th>Plazo</th></tr></thead><tbody>
          {lista.map((p) => {
            const e = chipEtapa(p, hoy as string);
            const pl = chipPlazo(p, hoy as string);
            const suma = p.pedido_lineas.reduce((a, l) => a + Number(l.unidades) * Number(l.precio), 0);
            return (
              <tr key={p.id}>
                <td><Link className="ref" href={"/operaciones/" + p.id}>{p.num}</Link></td>
                <td className="mono">{fecha(p.fecha)}</td>
                <td>{prof ? corto(p.comprador_id) + " → " + corto(p.vendedor_id) : p.comprador_id === yo.empresa_id ? corto(p.vendedor_id) : corto(p.comprador_id)}</td>
                <td><span className={"chip " + e.color}>{e.texto}</span></td>
                <td className="num">{fmt(suma)}</td>
                <td>{pl ? <span className={"chip " + pl.color}>{pl.texto}</span> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody></table></div> : <p className="empty">Todavía no hay operaciones.</p>}
      </section>
    </>
  );
}

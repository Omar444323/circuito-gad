import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";
import { calcularFactura } from "@/lib/calculo";
import { ESTADOS_PRESUPUESTO, turnoPresupuesto, type Presupuesto } from "@/lib/circuito";

type Fila = Presupuesto & { presupuesto_lineas: { unidades: number; precio: number }[] };

export default async function Presupuestos() {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: filas }, { data: empresas }, { data: hoy }] = await Promise.all([
    s.from("presupuestos").select("*, plazo_presupuesto, presupuesto_lineas(unidades, precio)").order("id", { ascending: false }),
    s.from("empresas").select("id, corto"),
    s.rpc("hoy"),
  ]);
  const corto = (g: number) => empresas?.find((e) => e.id === g)?.corto ?? "";
  const lista = (filas ?? []) as unknown as Fila[];
  const prof = yo.rol === "profesora";
  return (
    <>
      <div className="head"><div><h1>Presupuestos</h1>
        <p>{prof ? "Todas las negociaciones de la clase. Solo las revisas: las cierran los grupos." : "Negocia precio y descuentos antes de comprar. Al aceptar la oferta se crea el pedido con lo acordado."}</p></div>
        {!prof && <Link className="btn" href="/presupuestos/nuevo" style={{ textDecoration: "none" }}>Solicitar presupuesto</Link>}</div>
      <section className="card">
        {lista.length ? <div className="tw"><table className="t"><thead><tr><th>Presupuesto</th><th>Fecha</th><th>{prof ? "Empresas" : "Con"}</th><th>Estado</th><th className="num">Importe sin IVA</th><th>Responde</th></tr></thead><tbody>
          {lista.map((p) => {
            const e = ESTADOS_PRESUPUESTO[p.estado];
            const turno = turnoPresupuesto(p);
            const vence = p.plazo_presupuesto && (hoy as string) > p.plazo_presupuesto;
            return (
              <tr key={p.id}>
                <td><Link className="ref" href={"/presupuestos/" + p.id}>{p.num}</Link></td>
                <td className="mono">{fecha(p.fecha)}</td>
                <td>{prof ? corto(p.comprador_id) + " → " + corto(p.vendedor_id) : p.comprador_id === yo.empresa_id ? corto(p.vendedor_id) : corto(p.comprador_id)}</td>
                <td><span className={"chip " + e.color}>{e.etiqueta}</span></td>
                <td className="num">{fmt(calcularFactura(p.presupuesto_lineas.map((l) => ({ unidades: Number(l.unidades), precio: Number(l.precio) })), { dto: Number(p.dto), rappel: Number(p.rappel), pronto_pago: Number(p.pronto_pago) }).base)}</td>
                <td>{turno ? <span className={"chip " + (vence ? "bad" : turno === yo.empresa_id ? "warn" : "off")}>{vence ? "Plazo vencido · " : ""}{turno === yo.empresa_id ? "Te toca" : corto(turno)}</span> : <span className="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody></table></div> : <p className="empty">Todavía no hay presupuestos.</p>}
      </section>
    </>
  );
}

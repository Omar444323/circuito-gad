import { redirect } from "next/navigation";
import { CuadroCuotas, type Cuota } from "@/components/CuadroCuotas";
import { Form } from "@/components/Form";
import { comprarEnTienda, contratarServicioPersonal, pagarGastoPersonal, solicitarPrestamoPersonal } from "@/app/acciones-circuito";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha, fmt } from "@/lib/formato";

type Mov = { id: number; fecha: string; concepto: string; importe: number; saldo: number; justificante: string | null };
type Gasto = { id: number; num: string; tipo: string; descripcion: string; base: number; cuota: number; total: number; fecha: string; proveedor_id: number };
type Prestamo = { id: number; importe: number; plazo_meses: number; estado: string; tipo_interes: number | null; motivo_rechazo: string | null; cuotas_prestamo: Cuota[] };
const ESTADO: Record<string, [string, string]> = { solicitada: ["En el banco", "info"], estudiada: ["Con la profesora", "warn"], autorizada: ["Abonado", "good"], rechazada: ["Rechazado", "bad"] };

export default async function Personal() {
  const yo = await miSesion();
  if (yo.rol === "profesora") redirect("/");
  const s = await sb();
  const [{ data: mods }, { data: movs }, { data: gas }, { data: pres }, { data: nom }, { data: cat }] = await Promise.all([
    s.from("modulos").select("clave, activo").in("clave", ["consumidores", "financiacion"]),
    s.from("movimientos_personales").select("*").eq("perfil_id", yo.id).order("id", { ascending: false }),
    s.from("gastos_personales").select("*").eq("perfil_id", yo.id).order("id", { ascending: false }),
    s.from("solicitudes_financiacion").select("id, importe, plazo_meses, estado, tipo_interes, motivo_rechazo, cuotas_prestamo(*)").eq("perfil_id", yo.id).order("id", { ascending: false }),
    s.from("nominas").select("id, num, mes, bruto, liquido").eq("trabajador_id", yo.id).order("mes", { ascending: false }),
    s.from("catalogo").select("id, empresa_id, nombre, precio, iva").in("empresa_id", [4, 6]).eq("activo", true).order("nombre"),
  ]);
  const activo = (k: string) => !!mods?.find((m) => m.clave === k)?.activo;
  const movimientos = (movs ?? []) as unknown as Mov[];
  const gastos = (gas ?? []) as unknown as Gasto[];
  const prestamos = (pres ?? []) as unknown as Prestamo[];
  const saldo = Number(movimientos[0]?.saldo ?? 0);
  const opciones = (g: number) => (cat ?? []).filter((c) => c.empresa_id === g).map((c) => <option key={c.id} value={c.id}>{c.nombre} · {fmt(Number(c.precio) * (1 + Number(c.iva) / 100))} con IVA</option>);
  return (
    <>
      <div className="head"><h1>Mis finanzas</h1><p>Además de trabajador, eres consumidor. No llevas contabilidad personal: aquí tienes tu extracto y tus justificantes. Solo lo ves tú y la profesora.</p></div>
      <div className="kpis"><div className="kpi"><span className="lbl">Saldo personal</span><span className="v">{fmt(saldo)}</span></div></div>
      {activo("consumidores") ? (
        <section className="card"><h2>Gastar</h2>
          <div className="stack">
            <Form action={comprarEnTienda} boton="Comprar en la tienda" clase="btn ghost"><div className="row3"><label>Artículo del G6<select className="in" name="catalogo">{opciones(6)}</select></label><label>Unidades<input className="in" type="number" min="1" step="1" name="unidades" defaultValue="1" required /></label></div></Form>
            <Form action={contratarServicioPersonal} boton="Contratar el servicio" clase="btn ghost"><div className="row3"><label>Servicio del G4<select className="in" name="catalogo">{opciones(4)}</select></label><label>Unidades<input className="in" type="number" min="1" step="1" name="unidades" defaultValue="1" required /></label></div></Form>
            <Form action={pagarGastoPersonal} boton="Pagar el recibo" clase="btn ghost"><div className="row3"><label>Gasto<select className="in" name="tipo"><option value="vivienda">Vivienda</option><option value="suministros">Suministros</option></select></label><label>Concepto<input className="in" name="concepto" maxLength={150} placeholder="Por ejemplo, alquiler de noviembre" required /></label><label>Total del recibo €<input className="in" type="number" min="0.01" step="0.01" name="total" required /></label></div><p className="hint">Se paga al G4. La vivienda va sin IVA y los suministros con el 21 % incluido.</p></Form>
          </div>
        </section>
      ) : <div className="note info">La parte de consumidores todavía no está activada por la profesora. Puedes ver tus nóminas y tu extracto.</div>}
      <section className="card"><h2>Préstamo personal</h2>
        <div className="stack">
          {activo("consumidores") && activo("financiacion") ? <Form action={solicitarPrestamoPersonal} boton="Enviar al banco" clase="btn ghost"><div className="row3"><label>Importe €<input className="in" type="number" min="0.01" step="0.01" name="importe" required /></label><label>Plazo en meses (máximo 48)<input className="in" type="number" min="1" max="48" name="plazo" required /></label><label>Motivo<input className="in" name="motivo" maxLength={500} required /></label></div></Form> : <p className="empty">La financiación personal todavía no está activada.</p>}
          {prestamos.map((p) => <div className="doc" key={p.id}>
            <div className="btns" style={{ justifyContent: "space-between" }}><strong>{fmt(p.importe)} a {p.plazo_meses} meses</strong><span className={"chip " + ESTADO[p.estado][1]}>{ESTADO[p.estado][0]}</span></div>
            {p.motivo_rechazo && <p className="muted">{p.motivo_rechazo}</p>}
            {p.cuotas_prestamo.length > 0 && <CuadroCuotas cuotas={p.cuotas_prestamo} puedePagar />}
          </div>)}
        </div>
      </section>
      <section className="card"><h2>Mis nóminas</h2>
        {nom?.length ? <div className="tw"><table className="t"><thead><tr><th>Nómina</th><th>Mes</th><th className="num">Bruto</th><th className="num">Líquido</th></tr></thead><tbody>{nom.map((n) => <tr key={n.id}><td className="ref">{n.num}</td><td className="mono">{n.mes.slice(5, 7)}/{n.mes.slice(0, 4)}</td><td className="num">{fmt(n.bruto)}</td><td className="num">{fmt(n.liquido)}</td></tr>)}</tbody></table></div> : <p className="empty">Todavía no has cobrado ninguna nómina.</p>}
      </section>
      <section className="card"><h2>Mis justificantes de compra</h2>
        {gastos.length ? <div className="tw"><table className="t"><thead><tr><th>Documento</th><th>Fecha</th><th>Concepto</th><th className="num">Base</th><th className="num">IVA</th><th className="num">Total</th></tr></thead><tbody>{gastos.map((g) => <tr key={g.id}><td className="ref">{g.num}</td><td className="mono">{fecha(g.fecha)}</td><td>{g.descripcion}</td><td className="num">{fmt(g.base)}</td><td className="num">{fmt(g.cuota)}</td><td className="num">{fmt(g.total)}</td></tr>)}</tbody></table></div> : <p className="empty">Sin compras todavía.</p>}
      </section>
      <section className="card"><h2>Extracto</h2>
        {movimientos.length ? <div className="tw"><table className="t"><thead><tr><th>Fecha</th><th>Concepto</th><th>Justificante</th><th className="num">Importe</th><th className="num">Saldo</th></tr></thead><tbody>{movimientos.map((m) => <tr key={m.id}><td className="mono">{fecha(m.fecha)}</td><td>{m.concepto}</td><td className="ref">{m.justificante}</td><td className="num">{fmt(m.importe)}</td><td className="num">{fmt(m.saldo)}</td></tr>)}</tbody></table></div> : <p className="empty">Sin movimientos.</p>}
      </section>
    </>
  );
}

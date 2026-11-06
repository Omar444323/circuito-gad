import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";
import { actorDe, turnoPresupuesto, type Pedido, type Presupuesto } from "@/lib/circuito";
import { Avisos } from "@/components/Avisos";
import { salir } from "../acciones";
import "../circuito.css";

type Entrada = [string, string, number?];
type BloqueoAbierto = { etapa: string; etapa_desde: string; pedidos: { etapa: string; etapa_desde: string } | null };
const contar = { count: "exact", head: true } as const;

export default async function Layout({ children }: { children: React.ReactNode }) {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: e }, { data: hoyR }] = await Promise.all([
    yo.empresa_id ? s.from("empresas").select("nombre").eq("id", yo.empresa_id).single() : Promise.resolve({ data: null }),
    s.rpc("hoy"),
  ]);
  const hoy = hoyR as string;
  let nav: Entrada[];
  const inicial: string[] = [];
  if (yo.rol === "profesora") {
    const [{ data }, { count: precios }, { count: prestamos }, { count: planes }, { count: entregas }, { count: impagos }] = await Promise.all([
      s.from("bloqueos").select("etapa, etapa_desde, pedidos(etapa, etapa_desde)").eq("registrado", false),
      s.from("solicitudes_precio").select("id", contar).eq("estado", "pendiente"),
      s.from("solicitudes_financiacion").select("id", contar).eq("estado", "estudiada"),
      s.from("planes_viabilidad").select("id", contar).eq("estado", "presentado"),
      s.from("entregas").select("id", contar).is("revisada_en", null),
      s.from("deudas").select("id", contar).not("impago_comunicado", "is", null).eq("impago_registrado", false).eq("estado", "vigente"),
    ]);
    const abiertos = ((data ?? []) as unknown as BloqueoAbierto[]).filter((b) => b.pedidos?.etapa === b.etapa && b.pedidos?.etapa_desde === b.etapa_desde).length;
    nav = [["/", "Panel de control", abiertos], ["/operaciones", "Operaciones"], ["/presupuestos", "Presupuestos"], ["/deudas", "Deudas", impagos ?? 0], ["/seguimiento", "Seguimiento"], ["/archivo", "Archivo"], ["/importar", "Importar lo ya hecho"], ["/rotacion", "Rotación de roles"], ["/nominas", "Nóminas"], ["/iva", "Liquidación de IVA"], ["/fianzas", "Electricidad y agua"], ["/correo", "Todos los correos"], ["/circulares", "Circulares y entregas", entregas ?? 0], ["/autorizaciones", "Autorizaciones", (precios ?? 0) + (prestamos ?? 0) + (planes ?? 0)], ["/existencias", "Existencias"], ["/condiciones", "Condiciones del banco"], ["/equipos", "Equipos y usuarios"], ["/calendario", "Calendario lectivo"], ["/ayuda", "Ayuda"]];
  } else {
    const [{ data }, { data: pres }, { count: sinLeer }, { count: circulares }, { count: leidas }, { data: deu }] = await Promise.all([
      s.from("pedidos").select("*, plazo_limite"),
      s.from("presupuestos").select("estado, comprador_id, vendedor_id"),
      s.from("correos").select("id", contar).eq("destinatario_id", yo.empresa_id!).is("leido_en", null),
      s.from("circulares").select("id", contar),
      s.from("circular_lecturas").select("circular_id", contar).eq("empresa_id", yo.empresa_id!),
      s.from("deudas").select("estado, propuso_empresa, deudor_id, vencimiento").in("estado", ["propuesta", "vigente"]),
    ]);
    // Propuestas por responder y lo que debo y ya ha vencido
    const deudasNav: Entrada = ["/deudas", "Deudas y rappel", (deu ?? []).filter((d) => (d.estado === "propuesta" && d.propuso_empresa !== yo.empresa_id) || (d.estado === "vigente" && d.deudor_id === yo.empresa_id && !!d.vencimiento && hoy > d.vencimiento)).length];
    const tocan = ((data ?? []) as unknown as Pedido[]).filter((p) => actorDe(p, hoy) === yo.empresa_id).length;
    const venceHoy = ((data ?? []) as unknown as Pedido[]).filter((p) => actorDe(p, hoy) === yo.empresa_id && p.plazo_limite === hoy).length;
    if (venceHoy) inicial.push(venceHoy === 1 ? "Hoy vence el plazo de una operación" : `Hoy vence el plazo de ${venceHoy} operaciones`);
    const presupuestos: Entrada = ["/presupuestos", "Presupuestos", ((pres ?? []) as unknown as Presupuesto[]).filter((p) => turnoPresupuesto(p) === yo.empresa_id).length];
    const correo: Entrada = ["/correo", "Correo", sinLeer ?? 0];
    const avisos: Entrada = ["/circulares", "Circulares y entregas", Math.max((circulares ?? 0) - (leidas ?? 0), 0)];
    const obligaciones: Entrada[] = [["/archivo", "Archivo"], ["/personal", "Mis finanzas"], ["/nominas", "Nóminas"], ["/iva", "IVA"], ["/fianzas", "Electricidad y agua"], ["/rotacion", "Rotación de roles"]];
    if (yo.empresa_id === 5) {
      const [{ count: sinRevisar }, { count: solicitudes }] = await Promise.all([
        s.from("ordenes_pago").select("id", contar).eq("estado", "ejecutada").is("revisado_en", null),
        s.from("solicitudes_financiacion").select("id", contar).eq("estado", "solicitada"),
      ]);
      nav = [["/", "Inicio"], ["/ordenes", "Pagos por revisar", sinRevisar ?? 0], ["/financiacion", "Financiación", solicitudes ?? 0], ["/condiciones", "Condiciones y cálculo"], ["/operaciones", "Mis operaciones", tocan], presupuestos, deudasNav, correo, avisos, ["/operaciones/nuevo", "Nuevo pedido"], ["/mi-cuenta", "Mi cuenta"], ...obligaciones, ["/mi-empresa", "Mi empresa"], ["/ayuda", "Ayuda"]];
    } else {
      const almacen: Entrada[] = yo.empresa_id === 4 ? [] : [["/almacen", yo.empresa_id === 2 ? "Almacén y fabricación" : yo.empresa_id === 6 ? "Almacén y tienda" : "Almacén"]];
      nav = [["/", "Inicio"], ["/operaciones", "Operaciones", tocan], presupuestos, deudasNav, correo, avisos, ["/operaciones/nuevo", "Nuevo pedido"], ...almacen, ["/mi-cuenta", "Mi cuenta"], ...obligaciones, ["/financiacion", "Financiación"], ["/condiciones", "Condiciones del banco"], ["/mi-empresa", "Mi empresa"], ["/ayuda", "Ayuda"]];
    }
  }
  return (
    <>
      <header className="top">
        <div className="brand">Circuito <span>GAD</span></div>
        <div className="today">{fecha(hoy)}</div>
        <div className="who">
          <div style={{ textAlign: "right" }}><span className="lbl">{yo.nombre}{yo.compartida && <> · <Link href="/quien-soy">Cambiar</Link></>}</span><strong>{e?.nombre ?? "Estado · Profesora"}</strong></div>
          <form action={salir}><button className="btn ghost sm">Salir</button></form>
        </div>
      </header>
      <div className="shell">
        <nav className="side" aria-label="Secciones">{nav.map(([h, l, b]) => <Link key={h} href={h} data-badge={b ? String(b) : undefined}>{l}</Link>)}</nav>
        <main>{children}</main>
      </div>
      <Avisos empresa={yo.empresa_id} hoy={hoy} inicial={inicial} />
    </>
  );
}

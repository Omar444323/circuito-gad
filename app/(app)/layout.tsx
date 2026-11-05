import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";
import { actorDe, type Pedido } from "@/lib/circuito";
import { salir } from "../acciones";
import "../circuito.css";

type Entrada = [string, string, number?];
type BloqueoAbierto = { etapa: string; etapa_desde: string; pedidos: { etapa: string; etapa_desde: string } | null };

export default async function Layout({ children }: { children: React.ReactNode }) {
  const yo = await miSesion();
  const s = await sb();
  const [{ data: e }, { data: hoyR }] = await Promise.all([
    yo.empresa_id ? s.from("empresas").select("nombre").eq("id", yo.empresa_id).single() : Promise.resolve({ data: null }),
    s.rpc("hoy"),
  ]);
  const hoy = hoyR as string;
  let nav: Entrada[];
  if (yo.rol === "profesora") {
    const { data } = await s.from("bloqueos").select("etapa, etapa_desde, pedidos(etapa, etapa_desde)").eq("registrado", false);
    const abiertos = ((data ?? []) as unknown as BloqueoAbierto[]).filter((b) => b.pedidos?.etapa === b.etapa && b.pedidos?.etapa_desde === b.etapa_desde).length;
    nav = [["/", "Panel de control", abiertos], ["/operaciones", "Operaciones"], ["/condiciones", "Condiciones del banco"], ["/equipos", "Equipos y usuarios"], ["/calendario", "Calendario lectivo"]];
  } else {
    const { data } = await s.from("pedidos").select("*");
    const tocan = ((data ?? []) as unknown as Pedido[]).filter((p) => actorDe(p, hoy) === yo.empresa_id).length;
    if (yo.empresa_id === 5) {
      const { count } = await s.from("ordenes_pago").select("id", { count: "exact", head: true }).eq("estado", "pendiente");
      nav = [["/", "Inicio"], ["/ordenes", "Órdenes de pago", count ?? 0], ["/condiciones", "Condiciones y cálculo"], ["/operaciones", "Mis operaciones", tocan], ["/operaciones/nuevo", "Nuevo pedido"], ["/mi-cuenta", "Mi cuenta"], ["/mi-empresa", "Mi empresa"]];
    } else {
      nav = [["/", "Inicio"], ["/operaciones", "Operaciones", tocan], ["/operaciones/nuevo", "Nuevo pedido"], ["/mi-cuenta", "Mi cuenta"], ["/condiciones", "Condiciones del banco"], ["/mi-empresa", "Mi empresa"]];
    }
  }
  return (
    <>
      <header className="top">
        <div className="brand">Circuito <span>GAD</span></div>
        <div className="today">{fecha(hoy)}</div>
        <div className="who">
          <div style={{ textAlign: "right" }}><span className="lbl">{yo.nombre}</span><strong>{e?.nombre ?? "Estado · Profesora"}</strong></div>
          <form action={salir}><button className="btn ghost sm">Salir</button></form>
        </div>
      </header>
      <div className="shell">
        <nav className="side" aria-label="Secciones">{nav.map(([h, l, b]) => <Link key={h} href={h} data-badge={b ? String(b) : undefined}>{l}</Link>)}</nav>
        <main>{children}</main>
      </div>
    </>
  );
}

import Link from "next/link";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";
import { salir } from "../acciones";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const yo = await miSesion();
  const s = await sb();
  const { data: e } = yo.empresa_id ? await s.from("empresas").select("nombre").eq("id", yo.empresa_id).single() : { data: null };
  const nav = yo.rol === "profesora"
    ? [["/", "Panel de control"], ["/equipos", "Equipos y usuarios"], ["/calendario", "Calendario lectivo"]]
    : [["/", "Inicio"], ["/mi-cuenta", "Mi cuenta"], ["/mi-empresa", "Mi empresa"]];
  const hoy = new Date().toISOString().slice(0, 10);
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
        <nav className="side" aria-label="Secciones">{nav.map(([h, l]) => <Link key={h} href={h}>{l}</Link>)}</nav>
        <main>{children}</main>
      </div>
    </>
  );
}

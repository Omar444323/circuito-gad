import Link from "next/link";
import { redirect } from "next/navigation";
import { PedidoForm } from "@/components/PedidoForm";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

export default async function NuevoPresupuesto() {
  const yo = await miSesion();
  if (yo.rol === "profesora") redirect("/presupuestos");
  const s = await sb();
  const [{ data: empresas }, { data: catalogo }] = await Promise.all([
    s.from("empresas").select("id, corto, nombre").eq("tipo", "grupo").order("id"),
    s.from("catalogo").select("id, empresa_id, nombre, precio").eq("activo", true).order("nombre"),
  ]);
  const proveedores = (empresas ?? []).filter((e) => e.id !== 5 && e.id !== yo.empresa_id);
  return (
    <>
      <Link className="btn ghost sm" href="/presupuestos" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Presupuestos</Link>
      <div className="head"><h1>Solicitar presupuesto</h1><p>Parte de los precios de tarifa. El proveedor tiene 2 días lectivos para responder con una oferta, y después podéis negociar precio y descuentos.</p></div>
      <section className="card"><PedidoForm proveedores={proveedores} catalogo={catalogo ?? []} miEmpresa={yo.empresa_id!} modo="presupuesto" /></section>
    </>
  );
}

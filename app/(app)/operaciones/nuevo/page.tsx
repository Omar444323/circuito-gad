import { redirect } from "next/navigation";
import { PedidoForm } from "@/components/PedidoForm";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

export default async function NuevoPedido() {
  const yo = await miSesion();
  if (yo.rol === "profesora") redirect("/operaciones");
  const s = await sb();
  const [{ data: empresas }, { data: catalogo }] = await Promise.all([
    s.from("empresas").select("id, corto, nombre").order("id"),
    s.from("catalogo").select("id, empresa_id, nombre, precio").eq("activo", true).order("nombre"),
  ]);
  const proveedores = (empresas ?? []).filter((e) => e.id !== 5 && e.id !== yo.empresa_id);
  return (
    <>
      <div className="head"><h1>Nuevo pedido</h1><p>Precios del catálogo publicado por cada proveedor. El proveedor tiene 2 días lectivos para aceptarlo o rechazarlo.</p></div>
      <section className="card"><PedidoForm proveedores={proveedores} catalogo={catalogo ?? []} /></section>
    </>
  );
}

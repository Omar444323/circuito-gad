import Link from "next/link";
import { redirect } from "next/navigation";
import { PedidoForm } from "@/components/PedidoForm";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";

export default async function NuevoPedido() {
  const yo = await miSesion();
  if (yo.rol === "profesora") redirect("/operaciones");
  const g = yo.empresa_id!;
  const s = await sb();
  const [{ data: empresas }, { data: catalogo }, { data: mov }] = await Promise.all([
    s.from("empresas").select("id, corto, nombre").order("id"),
    s.from("catalogo").select("id, empresa_id, nombre, precio, es_transporte").eq("activo", true).order("nombre"),
    s.from("movimientos_banco").select("saldo").eq("empresa_id", g).order("id", { ascending: false }).limit(1).maybeSingle(),
  ]);
  // Hacienda y la Seguridad Social no venden nada, y al Estado solo le compra el G1
  const proveedores = (empresas ?? []).filter((e) => e.id !== 5 && e.id !== g && (e.id <= 6 || (e.id === 7 && g === 1)));
  const transportes = (catalogo ?? []).filter((c) => c.empresa_id === 4 && c.es_transporte);
  return (
    <>
      <div className="head"><h1>Nuevo pedido</h1><p>Precios del catálogo publicado por cada proveedor. El proveedor tiene 2 días lectivos para aceptarlo o rechazarlo. Para negociar el precio, <Link href="/presupuestos/nuevo">pide antes un presupuesto</Link>.</p></div>
      <section className="card"><PedidoForm proveedores={proveedores} catalogo={catalogo ?? []} transportes={transportes} saldo={Number(mov?.saldo ?? 0)} miEmpresa={g} /></section>
    </>
  );
}

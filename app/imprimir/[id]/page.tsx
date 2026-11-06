import Link from "next/link";
import { notFound } from "next/navigation";
import { BotonImprimir } from "@/components/BotonImprimir";
import { DocAlbaran, DocFactura, DocJustificante, DocPedido, DocRectificativa, type Albaran, type Empresa, type Factura, type Linea, type Orden, type Rectificativa } from "@/components/Documentos";
import { cuentaActual } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import type { Pedido } from "@/lib/circuito";
import "../../circuito.css";

// Sin el menú de la app: solo el documento. Desde el navegador se imprime o se guarda como PDF
export default async function Imprimir({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ doc?: string }> }) {
  const { id } = await params;
  const { doc } = await searchParams;
  if (!/^\d+$/.test(id)) notFound();
  await cuentaActual();
  const s = await sb();
  const { data } = await s.from("pedidos").select("*, plazo_limite").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as unknown as Pedido;
  const [lin, alb, fac, rec, ord, emp] = await Promise.all([
    s.from("pedido_lineas").select("*").eq("pedido_id", id).order("id"),
    s.from("albaranes").select("*").eq("pedido_id", id).maybeSingle(),
    s.from("facturas").select("*, factura_lineas(*)").eq("pedido_id", id).order("version", { ascending: false }),
    s.from("rectificativas").select("*, rectificativa_lineas(*)").eq("pedido_id", id).order("id", { ascending: false }),
    s.from("ordenes_pago").select("*").eq("pedido_id", id).eq("estado", "ejecutada").order("id"),
    s.from("empresas").select("id, nombre, corto, iban, con_almacen"),
  ]);
  const empresas = (emp.data ?? []) as unknown as Empresa[];
  const empresa = (g: number) => empresas.find((e) => e.id === g);
  const comprador = empresa(p.comprador_id);
  const vendedor = empresa(p.vendedor_id);
  const lineas = (lin.data ?? []) as unknown as Linea[];
  const albaran = alb.data as unknown as Albaran | null;
  const facturas = (fac.data ?? []) as unknown as Factura[];
  const factura = facturas[0];
  const rectificativas = (rec.data ?? []) as unknown as Rectificativa[];
  const ordenes = (ord.data ?? []) as unknown as Orden[];
  const ver = (k: string) => !doc || doc === k;
  return (
    <main className="impresion">
      <div className="btns no-print"><BotonImprimir /><Link className="btn ghost" href={"/operaciones/" + p.id} style={{ textDecoration: "none" }}>Volver a la operación</Link></div>
      {ver("pedido") && <DocPedido p={p} lineas={lineas} comprador={comprador} vendedor={vendedor} />}
      {ver("albaran") && albaran && <DocAlbaran a={albaran} p={p} lineas={lineas} comprador={comprador} vendedor={vendedor} />}
      {ver("factura") && facturas.map((f, i) => <DocFactura key={f.id} f={f} varias={facturas.length > 1} antigua={i > 0} comprador={comprador} vendedor={vendedor} />)}
      {ver("rectificativa") && factura && rectificativas.map((r) => <DocRectificativa key={r.id} r={r} facturaNum={factura.num} comprador={comprador} vendedor={vendedor} />)}
      {ver("justificante") && ordenes.map((o) => <DocJustificante key={o.id} o={o} ordenante={empresa(o.ordenante_id)} beneficiario={empresa(o.beneficiario_id)} />)}
    </main>
  );
}

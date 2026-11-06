import Link from "next/link";
import { AccionesPedido, type Bloqueo, type Registro } from "@/components/AccionesPedido";
import { CampoEnvio, type Transporte } from "@/components/CampoEnvio";
import { Form } from "@/components/Form";
import { anotarOperacion, contratarEnvio, intervenirPedido } from "@/app/acciones-circuito";
import { DocAlbaran, DocFactura, DocJustificante, DocPedido, DocRectificativa, type Albaran, type Empresa, type Factura, type Linea, type Orden, type Rectificativa } from "@/components/Documentos";
import { miSesion } from "@/lib/sesion";
import { sb } from "@/lib/supabase";
import { fecha } from "@/lib/formato";
import { chipEtapa, chipPlazo, ETAPAS, posicion, type Deuda, type Pedido } from "@/lib/circuito";

const SinAcceso = () => (
  <><Link className="btn ghost sm" href="/operaciones" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Operaciones</Link>
    <section className="card"><h2>Sin acceso</h2><p>Esta operación no pertenece a tu empresa. La base de datos no la devuelve aunque se intente pedir directamente.</p></section></>
);

export default async function Operacion({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) return <SinAcceso />;
  const yo = await miSesion();
  const s = await sb();
  const { data } = await s.from("pedidos").select("*, plazo_limite").eq("id", id).maybeSingle();
  if (!data) return <SinAcceso />;
  const p = data as unknown as Pedido;
  const [lin, alb, fac, reg, ord, his, blo, emp, con, hoyR, rec, env, mad, tra, pre] = await Promise.all([
    s.from("pedido_lineas").select("*").eq("pedido_id", id).order("id"),
    s.from("albaranes").select("*").eq("pedido_id", id).maybeSingle(),
    s.from("facturas").select("*, factura_lineas(*)").eq("pedido_id", id).order("version", { ascending: false }),
    s.from("registros_contables").select("*").eq("pedido_id", id),
    s.from("ordenes_pago").select("*").eq("pedido_id", id).order("id", { ascending: false }),
    s.from("historial").select("*").eq("pedido_id", id).order("id", { ascending: false }),
    s.from("bloqueos").select("*").eq("pedido_id", id),
    s.from("empresas").select("id, nombre, corto, iban, con_almacen"),
    s.from("condiciones_banco").select("comision_transferencia").order("vigente_desde", { ascending: false }).order("id", { ascending: false }).limit(1).maybeSingle(),
    s.rpc("hoy"),
    s.from("rectificativas").select("*, rectificativa_lineas(*)").eq("pedido_id", id).order("id", { ascending: false }),
    s.from("pedidos").select("id, num, etapa").eq("envio_de", id).neq("etapa", "pedido_rechazado").maybeSingle(),
    p.envio_de ? s.from("pedidos").select("id, num").eq("id", p.envio_de).maybeSingle() : Promise.resolve({ data: null }),
    s.from("catalogo").select("id, nombre, precio").eq("empresa_id", 4).eq("activo", true).eq("es_transporte", true).order("nombre"),
    p.presupuesto_id ? s.from("presupuestos").select("id, num").eq("id", p.presupuesto_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const idsCatalogo = ((lin.data ?? []) as unknown as { catalogo_id: string | null }[]).map((l) => l.catalogo_id).filter((x): x is string => !!x);
  const [{ data: rech }, { data: ivas }] = await Promise.all([
    s.from("albaranes_rechazados").select("*").eq("pedido_id", id).order("id", { ascending: false }),
    idsCatalogo.length ? s.from("catalogo").select("iva").in("id", idsCatalogo) : Promise.resolve({ data: [] as { iva: number }[] }),
  ]);
  const tiposIva = [...new Set((ivas ?? []).map((x) => Number(x.iva)))];
  const { data: deu } = await s.from("deudas").select("*").eq("pedido_id", id).order("id", { ascending: false });
  const envio = env.data as { id: number; num: string; etapa: string } | null;
  const puedeContratar = !envio && yo.empresa_id === p.comprador_id && !p.servicio && p.comprador_id !== 4 && p.etapa !== "pedido_rechazado" && p.etapa !== "pagado";
  const hoy = hoyR.data as string;
  const rectificativas = (rec.data ?? []) as unknown as Rectificativa[];
  const lineas = (lin.data ?? []) as unknown as Linea[];
  const albaran = alb.data as unknown as Albaran | null;
  const facturas = (fac.data ?? []) as unknown as Factura[];
  const registros = (reg.data ?? []) as unknown as Registro[];
  const ordenes = (ord.data ?? []) as unknown as Orden[];
  const historial = (his.data ?? []) as unknown as { id: number; fecha: string; texto: string; quien_nombre: string | null }[];
  const empresas = (emp.data ?? []) as unknown as Empresa[];
  const empresa = (g: number) => empresas.find((e) => e.id === g);
  const comprador = empresa(p.comprador_id);
  const vendedor = empresa(p.vendedor_id);
  const factura = facturas[0];
  // Una deuda se puede pagar en varias veces, y un abono lo paga el vendedor
  const pagos = ordenes.filter((o) => o.estado === "ejecutada");
  const INTERVENIBLE: Record<string, string> = { pedido_enviado: "aceptación del pedido", pedido_aceptado: "albarán", albaran_emitido: "recepción", recibido: "factura", factura_rechazada: "factura", factura_emitida: "aceptación de la factura" };
  const intervenible = INTERVENIBLE[p.etapa];
  const disp = yo.empresa_id === p.comprador_id ? await s.rpc("disponible", { p_empresa: p.comprador_id }) : null;
  let faltan: { descripcion: string; tienes: number; piden: number }[] = [];
  if (yo.empresa_id === p.vendedor_id && vendedor?.con_almacen && (p.etapa === "pedido_enviado" || p.etapa === "pedido_aceptado")) {
    const { data: mio } = await s.rpc("almacen", { p_empresa: p.vendedor_id });
    const articulos = (mio ?? []) as unknown as { catalogo_id: string | null; unidades: number }[];
    faltan = (lineas as (Linea & { catalogo_id: string })[]).map((l) => ({ descripcion: l.descripcion, tienes: Number(articulos.find((a) => a.catalogo_id === l.catalogo_id)?.unidades ?? 0), piden: Number(l.unidades) })).filter((l) => l.tienes < l.piden);
  }
  let porVincular: { linea_id: number; descripcion: string }[] = [];
  let misArticulos: { id: string; nombre: string }[] = [];
  if (yo.empresa_id === p.comprador_id && comprador?.con_almacen && p.etapa === "albaran_emitido") {
    const [vinc, mio] = await Promise.all([s.rpc("lineas_por_vincular", { p_id: Number(id) }), s.rpc("almacen", { p_empresa: p.comprador_id })]);
    porVincular = (vinc.data ?? []) as unknown as { linea_id: number; descripcion: string }[];
    misArticulos = (mio.data ?? []) as unknown as { id: string; nombre: string }[];
  }
  const otra = yo.empresa_id === p.comprador_id ? p.vendedor_id : p.comprador_id;
  const e = chipEtapa(p, hoy);
  const pl = chipPlazo(p, hoy);
  const i = posicion(p.etapa);
  const hecho = (lado: string, paso: string) => registros.some((r) => r.lado === lado && r.paso === paso);
  const clase = (si: boolean, ahora: boolean, mal = false) => (mal ? "fail" : si ? "done" : ahora ? "now" : "");
  const pasos: [string, string][] = [
    [p.presupuesto_id ? "Presupuesto negociado" : "Consulta de tarifa (catálogo publicado)", "done"],
    ["Pedido aceptado por el proveedor", clase(i > posicion("pedido_rechazado"), p.etapa === "pedido_enviado", p.etapa === "pedido_rechazado")],
    [p.servicio ? "Prestación del servicio (sin albarán)" : "Entrega de la mercancía y albarán" + (p.entrega_fecha ? " · " + fecha(p.entrega_fecha).slice(0, 5) : ""), clase(i >= posicion("recibido"), p.etapa === "pedido_aceptado" || p.etapa === "albaran_emitido")],
    ["Emisión y revisión de la factura", clase(i >= posicion("factura_aceptada"), p.etapa === "recibido" || p.etapa === "factura_emitida", p.etapa === "factura_rechazada")],
    ["Borrador manual del comprador", clase(hecho("comprador", "borrador"), p.etapa === "factura_aceptada")],
    ["Registro en el diario de Excel", clase(hecho("comprador", "diario"), p.etapa === "factura_aceptada" && hecho("comprador", "borrador"))],
    [p.etapa === "a_deber" ? "Pago por el banco (factura a deber)" : "Pago por el banco (automático)", clase(p.etapa === "pagado", p.etapa === "a_deber")],
    ["Justificante bancario emitido y archivado", clase(p.etapa === "pagado", false)],
  ];
  return (
    <>
      <Link className="btn ghost sm" href="/operaciones" style={{ alignSelf: "flex-start", textDecoration: "none" }}>← Operaciones</Link>
      <div className="head"><span className="lbl">Operación</span><h1 className="mono" style={{ fontFamily: "var(--f-mono)" }}>{p.num}</h1>
        <p>{comprador?.corto} compra a {vendedor?.corto}</p>
        <div className="btns" style={{ marginTop: 8 }}><span className={"chip " + e.color}>{e.texto}</span>{pl && <span className={"chip " + pl.color}>{pl.texto}</span>}{pre.data && <Link className="btn ghost sm" href={"/presupuestos/" + pre.data.id} style={{ textDecoration: "none" }}>Presupuesto {pre.data.num}</Link>}{yo.empresa_id && p.vendedor_id <= 6 && <Link className="btn ghost sm" href={"/correo/nuevo?para=" + otra + "&pedido=" + p.id} style={{ textDecoration: "none" }}>Escribir sobre esta operación</Link>}</div></div>
      <div className="grid2">
        <div className="stack">
          {pagos.map((o) => <DocJustificante key={o.id} o={o} ordenante={empresa(o.ordenante_id)} beneficiario={empresa(o.beneficiario_id)} />)}
          {factura && rectificativas.map((r) => <DocRectificativa key={r.id} r={r} facturaNum={factura.num} comprador={comprador} vendedor={vendedor} />)}
          {factura && <DocFactura f={factura} varias={facturas.length > 1} comprador={comprador} vendedor={vendedor} />}
          {facturas.length > 1 && <details className="ver"><summary>Versiones anteriores ({facturas.length - 1})</summary><div className="stack">{facturas.slice(1).map((f) => <DocFactura key={f.id} f={f} varias antigua comprador={comprador} vendedor={vendedor} />)}</div></details>}
          {(rech ?? []).map((r) => <div className="note bad" key={r.id}>Albarán {r.num} del {fecha(r.fecha)} rechazado por {r.rechazo_nombre} el {fecha(r.rechazo_fecha)}: {r.motivo}.</div>)}
          {albaran && <DocAlbaran a={albaran} p={p} lineas={lineas} comprador={comprador} vendedor={vendedor} />}
          <DocPedido p={p} lineas={lineas} comprador={comprador} vendedor={vendedor} />
        </div>
        <div className="stack">
          <section className="card"><h3>Siguiente paso</h3>
            <AccionesPedido p={p} miEmpresa={yo.empresa_id} hoy={hoy} factura={factura} registros={registros} empresas={empresas} comision={Number(con.data?.comision_transferencia ?? 0)} disponible={disp ? Number(disp.data) : null} bloqueos={(blo.data ?? []) as unknown as Bloqueo[]} lineas={lineas} rectificativas={rectificativas} faltan={faltan} hayAlmacen={!!vendedor?.con_almacen} porVincular={porVincular} misArticulos={misArticulos} deudas={(deu ?? []) as unknown as Deuda[]} ivaCatalogo={tiposIva[0] ?? 21} variosIva={tiposIva.length > 1} />
          </section>
          {(envio || puedeContratar || p.envio_de) && (
            <section className="card"><h3>Gastos de envío</h3>
              {p.envio_de && <p>Es el transporte {mad.data ? <>del pedido <Link className="ref" href={"/operaciones/" + mad.data.id}>{mad.data.num}</Link></> : "de un pedido del cliente"}. Se factura cuando el cliente recibe la mercancía.</p>}
              {envio && <p>Contratado con el G4: <Link className="ref" href={"/operaciones/" + envio.id}>{envio.num}</Link> <span className={"chip " + ETAPAS[envio.etapa].color}>{ETAPAS[envio.etapa].etiqueta}</span></p>}
              {puedeContratar && <Form action={contratarEnvio} boton="Contratar envío con el G4" clase="btn ghost"><input type="hidden" name="pedido" value={p.id} /><CampoEnvio transportes={(tra.data ?? []) as unknown as Transporte[]} /></Form>}
            </section>
          )}
          {yo.rol === "profesora" && intervenible && (
            <section className="card"><h3>Documento sustitutorio</h3>
              <Form action={intervenirPedido} boton={"Emitir: " + intervenible} clase="btn danger"><input type="hidden" name="pedido" value={p.id} />
                <label>Motivo de la intervención<input className="in" name="motivo" maxLength={300} required /></label>
                {intervenible === "factura" && <div className="row3"><label>IVA %<select className="in" name="iva" defaultValue={tiposIva[0] ?? 21}>{[21, 10, 4, 0].map((v) => <option key={v} value={v}>{v} %</option>)}</select></label><label>Vencimiento en días<input className="in" type="number" min="0" max="30" name="vencimiento" defaultValue="15" /></label></div>}
                <p className="hint">Punto 12: haces el paso del equipo que no responde. Queda firmado como documento sustitutorio y el incumplimiento se registra contra ese equipo.</p>
              </Form>
            </section>
          )}
          {yo.rol === "profesora" && (
            <section className="card"><h3>Revisión de la profesora</h3>
              <Form action={anotarOperacion} boton="Guardar observación" clase="btn ghost"><input type="hidden" name="pedido" value={p.id} /><label>Observación para el grupo (no mueve la operación)<textarea className="in" name="texto" maxLength={1000} required /></label></Form>
            </section>
          )}
          <section className="card"><h3>Circuito</h3>
            <ol className="steps">{pasos.map(([t, c]) => <li className={c} key={t}>{t}</li>)}</ol>
            <p className="hint" style={{ marginTop: 4 }}>Los 8 pasos del punto 4 de las normas. En los pasos 5 y 6 la app solo deja constancia de quién los hizo: el borrador se hace a mano y el diario en el Excel común.</p>
          </section>
          <section className="card"><h3>Historial</h3>
            <ul className="log">{historial.map((l) => <li key={l.id}><span className="d">{fecha(l.fecha).slice(0, 5)}</span><span>{l.texto}{l.quien_nombre ? <> · <span className="muted">{l.quien_nombre}</span></> : null}</span></li>)}</ul>
          </section>
        </div>
      </div>
    </>
  );
}

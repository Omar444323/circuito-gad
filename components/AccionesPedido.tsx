import { Form } from "./Form";
import { FacturaForm, type LineaFactura } from "./FacturaForm";
import { RevisionFactura } from "./RevisionFactura";
import { TIPOS_RECTIFICATIVA, type Empresa, type Factura, type Linea, type Orden, type Rectificativa } from "./Documentos";
import * as A from "@/app/acciones-circuito";
import { actorDe, enCamino, ETAPAS, MOTIVOS_PEDIDO, posicion, textoPlazo, vencido, type Pedido } from "@/lib/circuito";
import { fecha, fmt } from "@/lib/formato";

export type Registro = { lado: string; paso: string; hecho_nombre: string };
export type Bloqueo = { etapa: string; etapa_desde: string; comunicado_fecha: string | null; registrado: boolean };
type Props = {
  p: Pedido; miEmpresa: number | null; hoy: string; factura?: Factura; orden?: Orden; registros: Registro[]; empresas: Empresa[]; comision: number; disponible: number | null; bloqueos: Bloqueo[]; lineas: Linea[];
  rectificativas: Rectificativa[]; faltan: { descripcion: string; tienes: number; piden: number }[]; hayAlmacen: boolean; porVincular: { linea_id: number; descripcion: string }[]; misArticulos: { id: string; nombre: string }[];
};
const Oculto = ({ p }: { p: Pedido }) => <input type="hidden" name="pedido" value={p.id} />;

function Registros({ p, lado, registros }: { p: Pedido; lado: string; registros: Registro[] }) {
  const hecho = (paso: string) => registros.find((r) => r.lado === lado && r.paso === paso);
  const item = (paso: string, texto: string, activo: boolean) => {
    const r = hecho(paso);
    if (r) return <li className="done" key={paso}><span>{texto} · <span className="muted">{r.hecho_nombre}</span></span></li>;
    return <li className={activo ? "now" : ""} key={paso}><span>{texto}{activo && <Form action={A.marcarRegistro} boton="Marcar hecho" clase="btn sm"><Oculto p={p} /><input type="hidden" name="paso" value={paso} /></Form>}</span></li>;
  };
  return <ol className="steps">{item("borrador", "Borrador manual", true)}{item("diario", "Registro en el diario de Excel", !!hecho("borrador"))}</ol>;
}

function Bloqueos({ p, miEmpresa, hoy, bloqueos, empresas }: Pick<Props, "p" | "miEmpresa" | "hoy" | "bloqueos" | "empresas">) {
  if (!vencido(p, hoy) || !p.plazo_limite) return null;
  const b = bloqueos.find((x) => x.etapa === p.etapa && x.etapa_desde === p.etapa_desde);
  const resp = empresas.find((e) => e.id === p.vendedor_id)?.corto;
  const lim = fecha(p.plazo_limite);
  if (miEmpresa === null) return b?.registrado ? <div className="note info">Incumplimiento registrado.</div> : (
    <div className="stack"><div className="note bad">{resp} no ha llegado a {textoPlazo(p)} (límite {lim}). {b?.comunicado_fecha ? "Bloqueo comunicado el " + fecha(b.comunicado_fecha) + "." : "Sin comunicar."}</div>
      <Form action={A.registrarIncumplimiento} boton="Registrar incumplimiento" clase="btn danger"><Oculto p={p} /></Form></div>
  );
  if (miEmpresa === p.comprador_id) return b?.comunicado_fecha ? <div className="note info">Bloqueo comunicado a la profesora el {fecha(b.comunicado_fecha)}.{b.registrado ? " Incumplimiento registrado." : ""}</div> : (
    <div className="stack"><div className="note bad">{resp} no ha llegado a {textoPlazo(p)} (límite {lim}).</div>
      <Form action={A.comunicarBloqueo} boton="Comunicar bloqueo a la profesora" clase="btn danger"><Oculto p={p} /></Form></div>
  );
  return <div className="note bad">Plazo vencido el {lim}. {b?.comunicado_fecha ? "El otro equipo ya lo ha comunicado a la profesora." : ""}</div>;
}

function Paso({ p, miEmpresa, hoy, factura, orden, registros, empresas, comision, disponible, lineas, rectificativas, faltan, hayAlmacen, porVincular, misArticulos }: Props) {
  const avisoFaltan = faltan.length > 0 ? "No tienes existencias suficientes de: " + faltan.map((l) => l.descripcion + " (tienes " + l.tienes + ", piden " + l.piden + ")").join("; ") + "." : "";
  const actor = actorDe(p, hoy);
  const nombre = (g: number | null) => empresas.find((e) => e.id === g)?.corto;
  if (enCamino(p, hoy)) {
    return <div className="note info">Mercancía en camino. Entrega pactada el <strong>{fecha(p.entrega_fecha as string)}</strong>. {miEmpresa === p.vendedor_id ? "El albarán se podrá emitir ese día." : miEmpresa === p.comprador_id ? "Ese día recibirás el albarán para confirmarlo." : ""}</div>;
  }
  if (miEmpresa === null) return <><p>{actor ? <>Le toca actuar a <strong>{nombre(actor)}</strong>: {ETAPAS[p.etapa].paso.toLowerCase()}.</> : "Operación cerrada."}</p><p className="hint">Como profesora ves todo, pero no actúas por los grupos.</p></>;
  if (actor !== miEmpresa) {
    if (p.etapa === "pagado") return <div className="note good">Operación cerrada: factura cobrada y pagada con justificante.</div>;
    if (p.etapa === "pedido_rechazado") return <div className="note bad">Pedido rechazado: {p.motivo_rechazo}</div>;
    return actor ? <p>Esperando a <strong>{nombre(actor)}</strong>: {ETAPAS[p.etapa].paso.toLowerCase()}.</p> : <p>Operación cerrada.</p>;
  }
  switch (p.etapa) {
    case "pedido_enviado":
      return (
        <div className="stack">
          {hayAlmacen && (avisoFaltan ? <div className="note bad">{avisoFaltan} Puedes rechazar por falta de existencias, o fabricar o comprar antes de la entrega.</div> : <div className="note good">Tienes existencias suficientes para servir este pedido.</div>)}
          <Form action={A.aceptarPedido} boton="Aceptar pedido"><Oculto p={p} /></Form>
          <Form action={A.rechazarPedido} boton="Rechazar pedido" clase="btn danger"><Oculto p={p} /><label>Motivo si lo rechazas<select className="in" name="motivo">{MOTIVOS_PEDIDO.map((m) => <option key={m}>{m}</option>)}</select></label></Form>
          <p className="hint">Solo se admiten los motivos de rechazo de las normas (punto 8).</p>
        </div>
      );
    case "pedido_aceptado":
      return (
        <div className="stack">
          {p.entrega_fecha && hoy > p.entrega_fecha ? <div className="note warn">Entrega retrasada: estaba pactada el {fecha(p.entrega_fecha)}.</div> : <div className="note good">Hoy es el día de entrega pactado.</div>}
          {avisoFaltan && <div className="note bad">{avisoFaltan} Fabrica o compra antes de emitir el albarán.</div>}
          <Form action={A.emitirAlbaran} boton="Entregar y emitir albarán"><Oculto p={p} /></Form>
          <p className="hint">Se generará el albarán con las unidades del pedido{hayAlmacen ? " y la salida de almacén a PMP" : ""}.</p>
        </div>
      );
    case "albaran_emitido":
      return <div className="stack"><p className="hint">Comprueba que lo recibido coincide con el albarán.</p><Form action={A.confirmarRecepcion} boton="Confirmar recepción"><Oculto p={p} />{porVincular.map((l) => <label key={l.linea_id}>{l.descripcion}: artículo en tu almacén<select className="in" name={"vinculo_" + l.linea_id} defaultValue=""><option value="">Crear un artículo nuevo</option>{misArticulos.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>)}</Form></div>;
    case "recibido":
    case "factura_rechazada": {
      const previa = p.etapa === "factura_rechazada" ? factura : undefined;
      const ls: LineaFactura[] = lineas.map((l) => {
        const anterior = previa?.factura_lineas.find((x) => x.pedido_linea_id === l.id);
        return { id: l.id, descripcion: l.descripcion, unidades: Number(anterior?.unidades ?? l.unidades), precio: Number(anterior?.precio ?? l.precio) };
      });
      const opciones = previa ? { dto: Number(previa.dto), rappel: Number(previa.rappel), pronto_pago: Number(previa.pronto_pago), portes: Number(previa.portes), envases: Number(previa.envases), iva: Number(previa.iva), retencion: Number(previa.retencion), vencimiento_dias: previa.vencimiento_dias } : null;
      return <div className="stack">{previa && <div className="note bad">Rechazada por el cliente: {previa.motivo_rechazo}</div>}<FacturaForm pedido={p.id} lineas={ls} previa={opciones} g4={p.vendedor_id === 4} /></div>;
    }
    case "factura_emitida":
      return (
        <div className="stack">
          <RevisionFactura pedido={p.id} />
          <Form action={A.rechazarFactura} boton="Rechazar factura" clase="btn danger"><Oculto p={p} /><label>Motivo del rechazo<input className="in" name="motivo" placeholder="Indica qué dato es incorrecto" required /></label></Form>
        </div>
      );
    case "factura_aceptada": {
      if (registros.filter((r) => r.lado === "comprador").length < 2) {
        return <div className="stack"><p>Antes de ordenar el pago, deja constancia de los pasos 5 y 6 del circuito.</p><Registros p={p} lado="comprador" registros={registros} /><p className="hint">Hazlos fuera de la app: borrador a mano y asiento en el diario del Excel común.</p></div>;
      }
      if (!factura) return null;
      const aceptadas = rectificativas.filter((r) => r.estado === "aceptada").reduce((a, r) => a + Number(r.total), 0);
      const imp = Math.round((Number(factura.total) + aceptadas) * 100) / 100;
      const disp = disponible ?? 0;
      const insuficiente = imp + comision > disp;
      const avisar = !insuficiente && imp > disp * 0.2;
      const benef = empresas.find((e) => e.id === p.vendedor_id);
      return (
        <div className="stack">
          <dl className="dl"><dt>Total factura</dt><dd>{fmt(factura.total)}</dd>{aceptadas !== 0 && <><dt>Rectificativas aceptadas</dt><dd>{fmt(aceptadas)}</dd></>}<dt><strong>A transferir</strong></dt><dd><strong>{fmt(imp)}</strong></dd><dt>Comisión del banco</dt><dd>{fmt(comision)}</dd><dt>Disponible en banco</dt><dd>{fmt(disp)}</dd>
            <dt>Sobre tu tesorería</dt><dd>{disp > 0 ? ((imp / disp) * 100).toFixed(1).replace(".", ",") + " %" : "—"}</dd><dt>Vencimiento</dt><dd>{factura.vencimiento_dias ? fecha(factura.vencimiento_fecha) : "inmediato"}</dd></dl>
          {insuficiente && <div className="note bad">Saldo insuficiente. El descubierto está prohibido.</div>}
          <div className="note good">Verificación del beneficiario: <span className="mono">{benef?.iban}</span> pertenece a {benef?.nombre}. El nombre coincide.</div>
          <Form action={A.ordenarPago} boton="Enviar orden de pago al banco"><Oculto p={p} />
            {avisar && <><div className="note warn">Supera el 20 % de tu tesorería. Las normas exigen comprobar saldo, vencimiento y forma de pago.</div><label className="check"><input type="checkbox" name="confirmado" required /> He comprobado saldo, vencimiento y forma de pago</label></>}
          </Form>
        </div>
      );
    }
    case "orden_denegada":
      return <div className="stack"><div className="note bad">El banco ha denegado la orden: {orden?.motivo_denegacion}</div><Form action={A.reordenar} boton="Preparar una nueva orden"><Oculto p={p} /></Form></div>;
    case "orden_pendiente":
      return <p className="hint">Ejecútala desde <a href="/ordenes">Órdenes de pago</a>.</p>;
  }
  return null;
}

function FormRectificativa({ p, factura }: { p: Pedido; factura: Factura }) {
  const tipos = Object.entries(TIPOS_RECTIFICATIVA).filter(([k]) => !p.servicio || k !== "devolucion");
  return (
    <details className="ver"><summary>Emitir factura rectificativa</summary>
      <Form action={A.emitirRectificativa} boton="Emitir rectificativa" clase="btn ghost"><Oculto p={p} />
        <label>Tipo<select className="in" name="tipo">{tipos.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {!p.servicio && <div className="tw"><table className="t"><thead><tr><th>Unidades devueltas</th><th className="num">Uds</th></tr></thead><tbody>
          {factura.factura_lineas.map((l) => <tr key={l.id}><td>{l.descripcion} <span className="muted">({Number(l.unidades)} uds)</span></td><td><input className="in num" type="number" min="0" step="1" name={"ru_" + l.pedido_linea_id} defaultValue="0" aria-label="Unidades devueltas" /></td></tr>)}
        </tbody></table></div>}
        <label>Base del descuento (solo rappel o pronto pago) €<input className="in" type="number" min="0" step="0.01" name="base" defaultValue="0" /></label>
        <p className="hint">Solo antes del pago. La devolución mueve existencias en los dos almacenes cuando el cliente la acepta. IVA de la factura original.</p>
      </Form>
    </details>
  );
}

export function AccionesPedido(props: Props) {
  const { p, miEmpresa, registros, rectificativas, factura, empresas } = props;
  const pendiente = rectificativas.find((r) => r.estado === "emitida");
  if (pendiente && miEmpresa === p.comprador_id) {
    return (
      <div className="stack">
        <div className="note warn">{empresas.find((e) => e.id === p.vendedor_id)?.corto} ha emitido la rectificativa {pendiente.num} ({TIPOS_RECTIFICATIVA[pendiente.tipo].toLowerCase()}) por {fmt(pendiente.total)}. Revísala antes de pagar.</div>
        <Form action={A.aceptarRectificativa} boton="Aceptar rectificativa"><Oculto p={p} /></Form>
        <Form action={A.rechazarRectificativa} boton="Rechazar" clase="btn danger"><Oculto p={p} /><label>Motivo si la rechazas<input className="in" name="motivo" placeholder="Qué dato es incorrecto" required /></label></Form>
      </div>
    );
  }
  const venta = miEmpresa === p.vendedor_id && posicion(p.etapa) >= posicion("factura_aceptada") && registros.filter((r) => r.lado === "vendedor").length < 2;
  return (
    <div className="stack">
      <Bloqueos {...props} />
      {venta && <div className="stack"><p><strong>Tu registro de la venta</strong> <span className="hint">(no bloquea el circuito)</span></p><Registros p={p} lado="vendedor" registros={registros} /></div>}
      {pendiente && miEmpresa === p.vendedor_id && <div className="note info">Rectificativa {pendiente.num} pendiente de revisión por el cliente.</div>}
      {!pendiente && miEmpresa === p.vendedor_id && p.etapa === "factura_aceptada" && factura && <FormRectificativa p={p} factura={factura} />}
      <Paso {...props} />
    </div>
  );
}

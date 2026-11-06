"use client";
import { useState } from "react";
import { Form } from "./Form";
import { CampoEnvio, type Transporte } from "./CampoEnvio";
import { crearPedido, solicitarPresupuesto } from "@/app/acciones-circuito";
import { fmt } from "@/lib/formato";
import { r2 } from "@/lib/calculo";

type Empresa = { id: number; corto: string; nombre: string };
type Articulo = { id: string; empresa_id: number; nombre: string; precio: number };
type Props = { proveedores: Empresa[]; catalogo: Articulo[]; transportes?: Transporte[]; saldo?: number; miEmpresa: number; modo?: "pedido" | "presupuesto" };

export function PedidoForm({ proveedores, catalogo, transportes = [], saldo = 0, miEmpresa, modo = "pedido" }: Props) {
  const [prov, setProv] = useState(proveedores[0]?.id ?? 0);
  const [uds, setUds] = useState<Record<string, string>>({});
  const lista = catalogo.filter((c) => c.empresa_id === prov);
  const total = r2(lista.reduce((a, c) => a + Number(c.precio) * (Number(uds[c.id]) || 0), 0));
  const pedido = modo === "pedido";
  const avisar = pedido && total > saldo * 0.2;
  return (
    <Form action={pedido ? crearPedido : solicitarPresupuesto} boton={pedido ? "Enviar pedido" : "Solicitar presupuesto"}>
      <label>Proveedor
        <select className="in" name="vendedor" value={prov} onChange={(e) => { setProv(Number(e.target.value)); setUds({}); }}>
          {proveedores.map((g) => <option key={g.id} value={g.id}>{g.corto} · {g.nombre}</option>)}
        </select>
      </label>
      {prov === 7 && <p className="hint">Compra de materias primas al Estado. Haces tú todos los documentos, y el pago va a la cuenta bancaria &quot;Estado vende materias&quot;.</p>}
      <div className="tw"><table className="t"><thead><tr><th>Artículo o servicio</th><th className="num">Precio</th><th className="num">Unidades</th></tr></thead><tbody>
        {lista.map((c) => (
          <tr key={c.id}><td>{c.nombre}</td><td className="num">{fmt(c.precio)}</td>
            <td><input className="in num" type="number" min="0" step="1" name={"ud_" + c.id} value={uds[c.id] ?? "0"} onChange={(e) => setUds({ ...uds, [c.id]: e.target.value })} aria-label={"Unidades de " + c.nombre} /></td></tr>
        ))}
      </tbody></table></div>
      <dl className="dl"><dt>{pedido ? "Importe del pedido sin IVA" : "Importe a precios de tarifa, sin IVA"}</dt><dd>{fmt(total)}</dd></dl>
      {prov === 4 ? <p className="hint">Los servicios no llevan albarán: se dan por prestados al aceptar el pedido.</p> : (
        <>
          <label>Plazo de entrega solicitado
            <select className="in" name="entrega_dias" defaultValue="2">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} día{n > 1 ? "s" : ""} lectivo{n > 1 ? "s" : ""} desde la aceptación</option>)}
            </select>
          </label>
          <p className="hint">Al aceptar el pedido, el proveedor se compromete a esa fecha. El albarán no se puede emitir antes, y si se pasa, cuenta como retraso.</p>
          {pedido && miEmpresa !== 4 && <><CampoEnvio transportes={transportes} /><p className="hint">El G4 factura el transporte cuando recibes la mercancía. Su coste se suma al valor de lo comprado en tu almacén.</p></>}
        </>
      )}
      {!pedido && <label>Nota para el proveedor (opcional)<textarea className="in" name="nota" maxLength={1000} placeholder="Por ejemplo, el descuento que propones" /></label>}
      {avisar && <><div className="note warn">Esta compra supera el 20 % de tu tesorería ({fmt(saldo)}). Las normas exigen comprobar saldo, vencimiento y forma de pago antes de hacerla.</div><label className="check"><input type="checkbox" name="confirmado" required /> He comprobado saldo, vencimiento y forma de pago</label></>}
    </Form>
  );
}

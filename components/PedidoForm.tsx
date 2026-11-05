"use client";
import { useState } from "react";
import { Form } from "./Form";
import { crearPedido } from "@/app/acciones-circuito";
import { fmt } from "@/lib/formato";
import { r2 } from "@/lib/calculo";

type Empresa = { id: number; corto: string; nombre: string };
type Articulo = { id: string; empresa_id: number; nombre: string; precio: number };

export function PedidoForm({ proveedores, catalogo }: { proveedores: Empresa[]; catalogo: Articulo[] }) {
  const [prov, setProv] = useState(proveedores[0]?.id ?? 0);
  const [uds, setUds] = useState<Record<string, string>>({});
  const lista = catalogo.filter((c) => c.empresa_id === prov);
  const total = r2(lista.reduce((a, c) => a + Number(c.precio) * (Number(uds[c.id]) || 0), 0));
  return (
    <Form action={crearPedido} boton="Enviar pedido">
      <label>Proveedor
        <select className="in" name="vendedor" value={prov} onChange={(e) => { setProv(Number(e.target.value)); setUds({}); }}>
          {proveedores.map((g) => <option key={g.id} value={g.id}>{g.corto} · {g.nombre}</option>)}
        </select>
      </label>
      <div className="tw"><table className="t"><thead><tr><th>Artículo o servicio</th><th className="num">Precio</th><th className="num">Unidades</th></tr></thead><tbody>
        {lista.map((c) => (
          <tr key={c.id}><td>{c.nombre}</td><td className="num">{fmt(c.precio)}</td>
            <td><input className="in num" type="number" min="0" step="1" name={"ud_" + c.id} value={uds[c.id] ?? "0"} onChange={(e) => setUds({ ...uds, [c.id]: e.target.value })} aria-label={"Unidades de " + c.nombre} /></td></tr>
        ))}
      </tbody></table></div>
      <dl className="dl"><dt>Importe del pedido sin IVA</dt><dd>{fmt(total)}</dd></dl>
      {prov === 4 ? <p className="hint">Los servicios no llevan albarán: se dan por prestados al aceptar el pedido.</p> : (
        <>
          <label>Plazo de entrega solicitado
            <select className="in" name="entrega_dias" defaultValue="2">
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} día{n > 1 ? "s" : ""} lectivo{n > 1 ? "s" : ""} desde la aceptación</option>)}
            </select>
          </label>
          <p className="hint">Al aceptar el pedido, el proveedor se compromete a esa fecha. El albarán no se puede emitir antes, y si se pasa, cuenta como retraso.</p>
        </>
      )}
    </Form>
  );
}

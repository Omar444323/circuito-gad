import { fmt } from "@/lib/formato";

export type Transporte = { id: string; nombre: string; precio: number };

// Los gastos de envío son un servicio del G4: se contratan como un pedido propio, enlazado a la mercancía
export function CampoEnvio({ transportes }: { transportes: Transporte[] }) {
  return (
    <div className="row3">
      <label>Gastos de envío
        <select className="in" name="envio_catalogo" defaultValue={transportes[0]?.id ?? ""}>
          <option value="">Sin gastos de envío</option>
          {transportes.map((c) => <option key={c.id} value={c.id}>{c.nombre} · {fmt(c.precio)} sin IVA (G4)</option>)}
        </select>
      </label>
      <label>Unidades de transporte<input className="in" type="number" min="1" step="1" name="envio_unidades" defaultValue="1" /></label>
    </div>
  );
}

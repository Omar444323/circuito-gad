"use client";
import { useState } from "react";
import { fabricar } from "@/app/acciones-circuito";
import { Form } from "./Form";

type Producto = { id: string; nombre: string; materias: { nombre: string; cantidad: number; tienes: number }[] };

export function FabricarForm({ productos }: { productos: Producto[] }) {
  const [id, setId] = useState(productos[0]?.id ?? "");
  const [n, setN] = useState("10");
  const unidades = Number(n) || 0;
  const p = productos.find((x) => x.id === id);
  if (!productos.length) return <p className="hint">Ningún producto terminado tiene receta. Las recetas se editan en Mi empresa.</p>;
  return (
    <Form action={fabricar} boton="Registrar fabricación">
      <div className="row3">
        <label>Producto<select className="in" name="producto" value={id} onChange={(e) => setId(e.target.value)}>{productos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
        <label>Unidades<input className="in" name="unidades" type="number" min="1" step="1" required value={n} onChange={(e) => setN(e.target.value)} /></label><span />
      </div>
      {p && <div className="tw"><table className="t"><thead><tr><th>Materia prima</th><th className="num">Necesitas</th><th className="num">Tienes</th></tr></thead><tbody>
        {p.materias.map((m) => <tr key={m.nombre}><td>{m.nombre} <span className="muted">({m.cantidad} por unidad)</span></td><td className="num">{m.cantidad * unidades}</td><td className={"num" + (m.tienes < m.cantidad * unidades ? " neg" : "")}>{m.tienes}</td></tr>)}
      </tbody></table></div>}
      <p className="hint">Consume las materias primas a su PMP y da de alta el producto terminado al coste de lo consumido. La mano de obra y otros costes se añadirán cuando se expliquen.</p>
    </Form>
  );
}

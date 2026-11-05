"use client";
import { useEffect } from "react";
import { marcarCorreosLeidos } from "@/app/acciones-circuito";

// Se marca desde una acción para que el contador del menú se actualice al abrir el correo
export function MarcarLeido({ ids }: { ids: number[] }) {
  const clave = ids.join(",");
  useEffect(() => {
    if (clave) void marcarCorreosLeidos(clave.split(",").map(Number));
  }, [clave]);
  return null;
}

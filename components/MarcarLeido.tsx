"use client";
import { useEffect } from "react";
import { marcarCircularLeida, marcarCorreosLeidos } from "@/app/acciones-circuito";

export function MarcarCircularLeida({ id }: { id: number }) {
  useEffect(() => {
    void marcarCircularLeida(id);
  }, [id]);
  return null;
}

// Se marca desde una acción para que el contador del menú se actualice al abrir el correo
export function MarcarLeido({ ids }: { ids: number[] }) {
  const clave = ids.join(",");
  useEffect(() => {
    if (clave) void marcarCorreosLeidos(clave.split(",").map(Number));
  }, [clave]);
  return null;
}

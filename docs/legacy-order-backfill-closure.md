# Cierre del backfill de pedidos legacy

## Estado final aceptado

La fase de backfill de `Cliente.historialPedidos` a `Order` se considera cerrada.
La verificacion read-only realizada en produccion dio este resultado:

- `scannedCustomers`: 4
- `scannedEntries`: 39
- `alreadyMigrated`: 36
- `blocked`: 3
- `errors`: 0

Los tres registros bloqueados tienen exactamente `blockReason =
"invalid_status_undefined"`. No contienen un `estadoFinal` que permita distinguir
de forma fiable entre un pedido entregado y uno cancelado.

## Excepciones historicas aceptadas

Los tres registros permanecen en `Cliente.historialPedidos` como excepciones
historicas no migrables. No deben recibir un estado inferido o artificial y no
deben convertirse a `Order` mientras no exista evidencia confiable de su estado
final.

Que estos registros permanezcan `BLOCKED` es el comportamiento seguro y esperado,
no un error pendiente del backfill. El resultado se acepta porque todas las
entradas fueron clasificadas, las 36 migrables ya existen en `Order` y no hubo
errores de procesamiento.

## Condiciones operativas posteriores al cierre

- No volver a ejecutar `APPLY` para intentar resolver estas tres excepciones.
- No editar ni eliminar los registros legacy como parte del cierre.
- No cambiar la clasificacion oficial para inferir `estadoFinal`.
- Conservar las protecciones y pruebas que bloquean registros ambiguos.
- Usar solamente herramientas read-only si se necesita verificar nuevamente el
  estado del backfill.

Esta acta no incluye IDs de clientes, IDs de tenant, contenido de pedidos ni otros
datos personales.

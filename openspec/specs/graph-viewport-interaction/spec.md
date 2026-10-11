# graph-viewport-interaction Specification

## Purpose
Que mover y ampliar el grafo responda bien: actualizaciones acotadas a un cuadro, zoom encadenado sin pasos perdidos, reencuadre puntual con precedencia y sin perder la última posición al soltar.
## Requirements
### Requirement: Actualizaciones de encuadre acotadas a un cuadro
El encuadre SHALL aplicarse como mucho una vez por cuadro de animación durante un gesto continuo de
arrastre o rueda, y SHALL reflejar la última posición calculada de ese cuadro. Ningún evento del
gesto SHALL descartarse del cálculo.

El fundamento es que un mouse emite muchos más eventos por segundo que cuadros puede pintar el
navegador. Aplicar estado por evento no produce más información visible: produce trabajo que se
descarta y un gesto que tironea.

#### Scenario: Varios eventos de arrastre dentro del mismo cuadro
- **WHEN** llegan varios eventos de movimiento antes de que se pinte el cuadro siguiente
- **THEN** se aplica un solo encuadre, con la posición del último evento recibido

#### Scenario: Gesto que abarca varios cuadros
- **WHEN** un arrastre continuo se extiende a lo largo de varios cuadros
- **THEN** cada cuadro aplica el encuadre correspondiente a su último evento, sin saltear cuadros

### Requirement: Zoom encadenado sin pasos perdidos
Cada evento de rueda SHALL calcularse sobre el encuadre resultante del evento anterior, aunque ese
resultado todavía no se haya aplicado. El zoom acumulado de varios eventos en un mismo cuadro SHALL
equivaler al de los mismos eventos aplicados de a uno.

El fundamento es que el zoom es relativo al valor vigente: si dos eventos del mismo cuadro leyeran
ambos el último valor aplicado, el segundo anularía al primero y la rueda perdería pasos.

#### Scenario: Dos pasos de rueda en el mismo cuadro
- **WHEN** llegan dos eventos de rueda en la misma dirección antes del cuadro siguiente
- **THEN** el encuadre aplicado refleja los dos pasos de zoom, no sólo el último

### Requirement: Precedencia del reencuadre puntual
Un reencuadre puntual —reinicio, centrado o ajuste por cambio de mundo— SHALL aplicarse de inmediato
y SHALL descartar cualquier actualización de alta frecuencia pendiente. Un valor calculado antes del
reencuadre SHALL NOT aplicarse después de él.

#### Scenario: Reinicio con un cuadro pendiente
- **WHEN** se pide reiniciar el encuadre y hay una actualización de arrastre pendiente de aplicarse
- **THEN** el encuadre queda en el valor del reinicio y la actualización pendiente no lo pisa

### Requirement: Cierre del gesto sin perder la última posición
Al terminar el arrastre el encuadre SHALL quedar en la última posición calculada, aunque el gesto
termine antes de que se pinte el cuadro pendiente. Al desmontar, el cuadro pendiente SHALL cancelarse
sin aplicar estado.

#### Scenario: Soltar el arrastre con un cuadro pendiente
- **WHEN** el usuario suelta el botón y queda una actualización sin aplicar
- **THEN** esa última posición se aplica y el encuadre no retrocede al valor del cuadro anterior

#### Scenario: Desmontar durante un gesto
- **WHEN** el componente se desmonta con una actualización pendiente
- **THEN** no se aplica estado después del desmontaje


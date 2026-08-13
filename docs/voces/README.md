# Las voces del tutor — muestras y por qué quedó la que quedó

Audición del 2026-08-12. Están acá para no tener que volver a generarlas cuando
alguien pregunte "¿y esta cómo sonaba?", y para tener un punto de comparación
cuando aparezca una voz nueva.

Todas dicen la MISMA frase, que es una respuesta de tutor de verdad — con
voseo, con una analogía y con la pregunta del final:

> Mirá, la mitocondria es como la central de energía de la célula. Cuando corrés
> mucho, tus músculos le piden energía a full. ¿Se te ocurre qué pasaría si
> dejaran de funcionar?

Todo sale de la cuenta de **DeepInfra** que ya se paga por el modelo de texto.
No hizo falta abrir ninguna cuenta más.

## Las que quedaron

| archivo | voz | latencia | 
|---|---|---|
| `inworld-diego.mp3` | Diego, hombre | 3,0 s |
| `inworld-miguel.mp3` | Miguel, hombre | 2,7 s |
| `inworld-lupita.mp3` | Lupita, mujer | 3,1 s |
| `inworld-elena.mp3` | Elena, mujer | 2,5 s |

Modelo `inworld-ai/realtime-tts-2`, con `voice` y `language: "ES_ES"`.

## Las que no

| archivo | por qué no |
|---|---|
| `inworld-ashley-ingles.mp3` | **El error que hay que recordar.** Es el MISMO modelo llamado sin elegir voz: su defecto es «Ashley», una locutora en INGLÉS leyendo español. Sonaba con acento gringo y no era culpa del modelo, era de no haber elegido. |
| `kokoro-dora.mp3`, `kokoro-alex.mp3` | La voz está bien. **DeepInfra la tiene en cola**: calcula en 114 ms y tarda 27 s reales (medido tres veces: 113 s, 46 s, 27 s). No sirve para conversar. |
| `mimo.mp3` | 5,6 s, y además arrastraba el mismo problema de voz por defecto que Ashley. |

## Cómo medir una voz nueva

Lo que importa NO es el `runtime_ms` que devuelve la API —el cómputo— sino el
tiempo de punta a punta, que es lo que hace esperar al chico. Kokoro es el
ejemplo perfecto de la diferencia: 114 ms de cómputo, 27 s de espera real.

Medir **en serie**, nunca en paralelo: dos pedidos a la vez se estorban y los
números dejan de significar nada.

```bash
set -a && . .env && set +a
curl -s -w "\n%{time_total}s de punta a punta\n" \
  "https://api.deepinfra.com/v1/inference/inworld-ai/realtime-tts-2" \
  -H "Authorization: Bearer $DEEPINFRA_API_KEY" -H 'Content-Type: application/json' \
  -d '{"text":"Mirá, la célula es la unidad más pequeña que puede vivir sola.","voice":"Diego","language":"ES_ES"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);
      require("fs").writeFileSync("muestra.mp3",Buffer.from(j.audio.split(",")[1],"base64"));
      console.log("cómputo",j.inference_status.runtime_ms,"ms");})'
```

Para ver qué voces y qué parámetros acepta un modelo:

```bash
curl -s "https://api.deepinfra.com/models/inworld-ai/realtime-tts-2" \
  -H "Authorization: Bearer $DEEPINFRA_API_KEY" | jq '.in_fields, .in_schema'
```

## Dos cosas del modelo que todavía no usamos

- **Dirigir el tono desde el texto**: acepta `[be happy and upbeat] Hola!`.
  Sirve para un tutor (cálido al explicar, animado al felicitar), pero ojo:
  `apps/web/lib/speech.ts` **borra todos los corchetes** como guardia contra la
  inyección de comandos de `say`. Habría que abrirle la puerta solo a las
  etiquetas que ponemos nosotros, nunca a las que venga del modelo.
- **`speaking_rate`**, para bajarle el ritmo con los cursos más chicos.

El catálogo que ve el alumno está en `apps/web/app/voces.ts`.

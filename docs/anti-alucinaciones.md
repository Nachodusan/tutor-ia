# Plan anti-alucinaciones (modo estricto, 100% local)

Objetivo: que la IA **nunca invente**. Solo puede afirmar lo que esté respaldado
por el material del estudiante; si no lo está, se **abstiene**. Esto se logra con
varias capas defensivas, no con una sola.

## Por qué RAG local ayuda

Un modelo generativo tiende a "rellenar huecos". La estrategia es **quitarle los
huecos**: darle exactamente los fragmentos relevantes del material y prohibirle
salir de ahí. Correr local (Ollama) no cambia esto, pero garantiza privacidad y
control total sobre la configuración conservadora.

## Las capas (todas activas salvo la 5)

| # | Capa | Qué hace | Dónde |
|---|------|----------|-------|
| 1 | **Retrieval gating** | Si ningún fragmento supera el umbral de similitud, la IA se abstiene **sin llamar al modelo**. No puede inventar lo que no ejecuta. | `getTutorContext` + `config.minSimilarity` |
| 2 | **Prompt estricto** | El system prompt obliga a: usar solo el material, citar cada afirmación, y responder con una **frase de abstención fija** si no está. | `prompts.ts` (`TUTOR_SYSTEM`, `ABSTENTION`) |
| 3 | **Decodificación conservadora** | Temperatura baja (0.1) y `top_p` acotado → el modelo se apega al texto y no "improvisa". | `config.ts`, `client.ts` |
| 4 | **Citas verificables** | Cada respuesta devuelve los fragmentos y páginas usados; el estudiante puede comprobar la fuente. | `tutor.ts` → `citations`, UI |
| 5 | **Verificador (opcional)** | Segunda pasada que revisa si **cada afirmación** de la respuesta está respaldada; marca las no soportadas. Cuesta latencia; off por defecto. | `verifyAnswer`, `RAG_ENABLE_VERIFIER=1` |

### Capa 1 — Umbral de similitud (`RAG_MIN_SIMILARITY`)
- Cada fragmento recuperado trae una similitud coseno (0..1).
- Se descartan los que están por debajo del umbral (por defecto **0.35**).
- Si no queda ninguno → respuesta fija de abstención. **Cero llamada al modelo.**
- Ajuste: súbelo (p. ej. 0.5) para ser aún más estricto; bájalo si abstiene de más.

### Capa 2 — Prompt estricto
- "Usa ÚNICAMENTE los fragmentos"; "cita (Fragmento N, pág. X)"; "si no está,
  responde exactamente: …".
- Prohíbe explícitamente inventar números, fechas, nombres, fórmulas.
- "Prefiere 'el material no lo especifica' antes que arriesgar."

### Capa 3 — Conservador
- `LLM_TEMPERATURE=0.1` (casi determinista), `LLM_TOP_P=0.9`.
- En exámenes y corrección se fuerza `temperature=0`.

### Capa 4 — Trazabilidad
- La UI muestra "Fuentes: #1 (pág. 14), …". Sin fuentes visibles = señal de alarma.

### Capa 5 — Verificador (opt-in)
- `RAG_ENABLE_VERIFIER=1`.
- Tras generar, se pide al modelo comprobar la respuesta contra el material y
  devolver `{ grounded, unsupported[] }`. Si `grounded=false`, la UI puede avisar
  o pedir regenerar. Recomendado para el modo voz o exámenes de alto valor.

## En exámenes
- Se generan **solo** desde el material (mismo gating); cada pregunta lleva
  `source.page`.
- Si el material no alcanza para N preguntas, se generan **menos** en vez de
  inventar (regla explícita en el prompt).
- Salida estructurada (JSON Schema) evita respuestas mal formadas.

## Límites honestos
- Ninguna capa es 100% infalible; combinadas reducen drásticamente el riesgo.
- La calidad del retrieval depende de buenos embeddings (bge-m3) y buen chunking.
- Un modelo local pequeño puede citar mal ocasionalmente; por eso las citas son
  verificables y existe el verificador opcional.

## Parámetros clave (en `.env`)
```
LLM_TEMPERATURE=0.1        # conservador
LLM_TOP_P=0.9
RAG_MIN_SIMILARITY=0.35    # súbelo para más estricto
RAG_ENABLE_VERIFIER=0      # 1 para activar la capa 5
```

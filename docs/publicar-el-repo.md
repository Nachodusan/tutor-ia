# Publicar el repo — runbook

Estado al 2026-11-07. El historial local ya está limpio; **el remoto todavía
tiene el viejo** y el repo sigue privado. Falta un `push --force` y el cambio
de visibilidad, los dos únicos pasos irreversibles.

## Lo que ya se hizo

**El historial no reproduce los libros.** `golden-texto --auditar --historial`
recorre los 1.005 blobs de texto de todas las refs y da limpio.

Cómo se llegó, porque el camino importa para no repetirlo:

1. **Tres listas incompletas**, todas por medir lo que no era. Primero por
   nombre de campo (`texto`, `content`) en vez de por contenido: 3 archivos en
   vez de 24. Después por árbol de trabajo en vez de por historial: 24 en vez
   de 26, y faltaban `claims-audit.json` de la raíz y
   `docs/contenidos-faltantes.md`. La auditoría que vale es la del historial,
   porque un repo público publica todos los commits, no el último.

2. **Dos problemas que parecían uno.** De 35 rutas sucias, 9 no estaban en
   `main`: las sostenían la rama `feat/bloques-aurora-plan-prueba` y el tag
   `corpus-2026-08-23`, viejos. Sumaban 870.000 palabras y se fueron borrando
   las refs, sin tocar `main`. Entre ellas estaba el blob de
   `scope-audit-todas.json` con 140.544 palabras, que de lejos parecía un
   problema de `main` y no lo era.

3. **26 rutas fuera del historial** con `filter-repo`. Vuelven 24 peladas; no
   vuelven `sidecar-libro.json` (344 páginas de OCR de un libro, más la ruta
   del escritorio de quien lo generó) ni `claims-audit.json` de la raíz.

4. **El umbral son 12 palabras**, compartido por el detector y el pelador.
   Menos que eso coincide por casualidad: títulos de lección y definiciones
   canónicas. Dentro de una celda de tabla no se pela nada, porque ahí vive el
   título de la lección, que es una referencia igual que el número de página.

Comprobado además: **cero claves** con patrón conocido en los 2.977 objetos del
historial nuevo, y el repo bajó de 10,03 a 4,48 MiB.

## Lo que falta

### 1. Bajar el dump antes de borrarlo del release

205 MB: la base entera, con los chunks de los libros, 339 conversaciones de
alumnos y los hashes de contraseña. Hoy cuelga de un release del repo; cuando
el repo pase a público, cuelga de un repo público. **Esto por sí solo anula
todo lo anterior si se queda.**

```
mkdir -p ~/Documents/tutor-ia-corpus && gh release download corpus-2026-08-23 --repo Nachodusan/tutor-ia --dir ~/Documents/tutor-ia-corpus
```

```
shasum -a 256 ~/Documents/tutor-ia-corpus/tutor-2026-08-23_1611.dump
```

### 2. Borrar el release, su tag y la rama del remoto

Las refs locales ya se borraron; estas son las del servidor.

```
gh release delete corpus-2026-08-23 --repo Nachodusan/tutor-ia --cleanup-tag --yes
```

```
git push origin --delete feat/bloques-aurora-plan-prueba
```

### 3. Empujar el historial reescrito

```
git push --force origin main
```

### 4. Recién ahí, hacer público el repo

```
gh repo edit Nachodusan/tutor-ia --visibility public --accept-visibility-change-consequences
```

## Lo que se limpió después de publicar

**Rutas absolutas de la máquina.** `/Users/<usuario>/...` aparecía en 19 archivos
rastreados, y en cinco de ellos no era prolijidad sino un archivo roto: las
rutas apuntaban *dentro* del repo, así que `exp1b-compare.ts` y la ruta de
whisper no corrían en ninguna otra máquina. Las de adentro pasaron a resolverse
desde el módulo o desde la raíz del workspace; las del material, que vive
afuera a propósito, pasaron a `LIBROS_DIR` (ver `.env.example` y
`packages/eval/src/lib/libros.ts`), que falla con un mensaje claro en vez de
buscar en una carpeta inexistente.

**La licencia no se detectaba.** GitHub mostraba `NOASSERTION` porque el
`LICENSE` traía pegada abajo la nota sobre el material del Mineduc, y esos ~900
caracteres extra tiran la coincidencia por debajo del umbral del detector. El
`LICENSE` quedó con el texto MIT puro y la nota se mudó a
[`NOTICE.md`](../NOTICE.md), enlazada desde el README.

## La red

- `~/Documents/tutor-ia-RESPALDO-20261106.git` — espejo con el historial
  ORIGINAL completo, con los libros adentro. Nada de lo anterior destruyó
  material: lo sacó de lo que se publica.
- `~/Documents/tutor-ia-publicacion-20261106/` — las 24 versiones peladas y la
  lista de las 26 rutas.

## La prueba que decide

```
pnpm --filter @tutor-ia/eval golden-texto --auditar --historial
```

Tiene que decir *"ninguna versión de ningún archivo, en ningún commit,
reproduce el libro"*. Si en el futuro alguien corre `--rehidratar` y commitea
sin pelar, el hook de `.githooks/pre-commit` lo frena; pero el hook mira el
árbol, así que esta prueba sigue siendo la que vale antes de empujar.

# Publicar el repo — runbook

Estado al 2026-11-06. El repo **sigue privado** y el remoto todavía tiene el
historial viejo: nada se publicó. Los pasos van en orden y el último es el
único irreversible.

Material preparado, fuera del repo:

- `~/Documents/tutor-ia-publicacion-20261106/limpios/` — las 23 versiones ya
  peladas, que hay que devolver después del `filter-repo`.
- `~/Documents/tutor-ia-publicacion-20261106/rutas-a-purgar.txt` — las 24 rutas.
- `~/Documents/tutor-ia-RESPALDO-20261106.git` — espejo con el historial
  ORIGINAL completo (228 commits, con los libros adentro). Es la red: nada de
  lo que sigue destruye material, lo saca de lo que se publica.

## Lo que ya está hecho

El árbol de trabajo está limpio: `golden-texto --auditar` no encuentra ninguna
reproducción del libro en ningún archivo rastreado. Lo que falta es el
**historial**, que todavía tiene 53 versiones viejas de esos archivos, 7,9 MB.

## 1. Bajar el dump antes de borrarlo del release

205 MB: la base entera, con los chunks de los libros, 339 conversaciones de
alumnos y los hashes de contraseña. Hoy cuelga de un release del repo; cuando
el repo pase a público, cuelga de un repo público.

```
mkdir -p ~/Documents/tutor-ia-corpus && gh release download corpus-2026-08-23 --repo Nachodusan/tutor-ia --dir ~/Documents/tutor-ia-corpus
```

Comprobar el archivo por su contenido, no por el tamaño:

```
shasum -a 256 ~/Documents/tutor-ia-corpus/tutor-2026-08-23_1611.dump
```

## 2. Borrar el release y su tag

```
gh release delete corpus-2026-08-23 --repo Nachodusan/tutor-ia --cleanup-tag --yes
```

## 3. Borrar la rama `feat/bloques-aurora-plan-prueba`

Medido: **no tiene un solo commit que no esté en `main`**. No se pierde nada.

```
git push origin --delete feat/bloques-aurora-plan-prueba
```

```
git branch -D feat/bloques-aurora-plan-prueba && git tag -d corpus-2026-08-23
```

## 4. Reescribir el historial

Saca las 24 rutas de todos los commits. `--force` hace falta porque este repo
ya pasó una vez por `filter-repo`.

```
git filter-repo --force --invert-paths --paths-from-file ~/Documents/tutor-ia-publicacion-20261106/rutas-a-purgar.txt
```

## 5. Devolver las versiones limpias

`filter-repo` también las borró del árbol de trabajo. El sidecar no vuelve.

```
cp -R ~/Documents/tutor-ia-publicacion-20261106/limpios/. . && echo 'packages/eval/sidecar-libro.json' >> .gitignore && git add -A && git commit -m 'chore: vuelven los fixtures, ya sin texto de los libros'
```

## 6. Verificar ANTES de empujar

Las dos pruebas que deciden. La primera mira el árbol; la segunda, el historial
entero, que es la que importa acá.

```
pnpm --filter @tutor-ia/eval golden-texto --auditar
```

```
git rev-list --objects --all -- $(tr '\n' ' ' < ~/Documents/tutor-ia-publicacion-20261106/rutas-a-purgar.txt) | wc -l
```

La segunda tiene que dar **0**: ninguna versión de esas rutas quedó en ningún
commit. Si da otra cosa, el paso 4 no terminó y no hay que seguir.

## 7. Reponer el remoto y empujar

`filter-repo` borra `origin` a propósito, para que no se empuje sin querer.

```
git remote add origin https://github.com/Nachodusan/tutor-ia.git
```

```
git push --force origin main
```

## 8. Recién ahí, hacer público el repo

```
gh repo edit Nachodusan/tutor-ia --visibility public --accept-visibility-change-consequences
```

## Lo que queda por revisar antes del paso 8

- El escaneo de secretos del historial viejo (1.140 blobs contra los patrones
  de clave conocidos) quedó corriendo y **sin terminar**. Hay que verlo cerrado
  en 0 antes de publicar.
- El historial reescrito es un historial nuevo: conviene correrle el escaneo de
  nuevo, no dar por bueno el del viejo.

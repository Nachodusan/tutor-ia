-- Usuario de desarrollo (mientras no hay auth real, Fase 1).
-- Su id debe coincidir con DEV_USER_ID en .env, porque los documentos lo
-- referencian por clave foránea.
-- Usuario de desarrollo. Sin `name`: la columna se eliminó porque los usuarios
-- reales son menores y la garantía de "cero datos personales" tiene que ser
-- estructural, no una convención. Sin contraseña: no puede loguearse por la web.
insert into users (id, email, username, role)
values ('00000000-0000-0000-0000-000000000001', 'dev@local', 'dev', 'admin')
on conflict (id) do update set username = excluded.username, role = excluded.role;

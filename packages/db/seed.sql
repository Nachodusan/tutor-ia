-- Usuario de desarrollo (mientras no hay auth real, Fase 1).
-- Su id debe coincidir con DEV_USER_ID en .env, porque los documentos lo
-- referencian por clave foránea.
insert into users (id, email, name)
values ('00000000-0000-0000-0000-000000000001', 'dev@local', 'Dev')
on conflict (id) do nothing;

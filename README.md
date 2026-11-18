# Panel

App personal instalable (PWA). Funciona sin internet y guarda todo cifrado en el dispositivo.

- El código de este repositorio no contiene datos ni contraseñas.
- Los datos se cifran con la contraseña (AES-GCM 256, llave derivada con PBKDF2) y nunca salen del dispositivo.
- La página bloquea por política de seguridad cualquier conexión a otros sitios.

## Instalar en el iPad

1. Abrir la dirección de GitHub Pages en **Safari**.
2. Tocar **Compartir → Agregar a pantalla de inicio**.
3. Abrir la app desde el ícono y crear la contraseña.

Hacer un respaldo desde **Configuración → Respaldo** al menos cada semana.

## Datos de mapas incluidos

- `data/secciones-chihuahua.geojson`: secciones electorales del municipio de Chihuahua (INE, marco distrital 2018), tomadas de https://github.com/emagar/mxDistritos.
- `data/zonas-cp-chihuahua.geojson`: zonas por código postal del municipio (Correos de México / SEPOMEX), de https://github.com/open-mexico/mexico-geojson.
- `data/colonias-chihuahua.json`: colonias del municipio con su código postal (catálogo de Correos de México), de https://github.com/Swumplurd/cp-mexico.

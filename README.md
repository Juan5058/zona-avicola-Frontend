# 🐔 Zona Avícola SENA — Frontend Angular 19

Frontend completo migrado de HTML/CSS/JS nativo a **Angular 19 standalone** con lazy loading, conectado al backend NestJS.

## 🚀 Instalación y uso

```bash
# 1. Instalar dependencias
npm install

# 2. Levantar el backend NestJS primero (puerto 3000)
# Luego correr el frontend:
npm start
# → http://localhost:4200
```

## 📁 Estructura del proyecto

```
src/app/
├── components/
│   ├── shell/          # Layout principal (sidebar + header)
│   ├── sidebar/        # Navegación lateral con permisos por rol
│   └── header/         # Header con reloj, notificaciones y usuario
├── pages/
│   ├── login/          # Autenticación JWT
│   ├── dashboard/      # Carrusel de stats + gráficas
│   ├── gallinas/       # Lotes, tratamientos, mortalidad, ventas
│   ├── clasificacion/  # Conteo manual/auto + historial
│   ├── inventario/     # Inventario general + alimentos/consumo
│   ├── reportes/       # PDF/Excel con vista previa
│   ├── usuarios/       # CRUD usuarios (solo Admin)
│   └── manual/         # Guía de uso
├── services/
│   ├── auth.ts         # Sesión, token, roles
│   ├── api.ts          # Wrapper fetch con JWT automático
│   └── toast.ts        # Notificaciones toast reactivas
└── guards/
    └── auth-guard.ts   # Protección de rutas
```

## 🔐 Credenciales de prueba

| Rol          | Usuario    | Contraseña     |
|-------------|-----------|---------------|
| Admin        | admin      | admin123       |
| Usuario      | usuario    | usuario123     |
| Visitante    | visitante  | visitante123   |

## ⚙️ Configuración

El backend corre en `http://localhost:3000` (definido en `src/app/services/api.ts`).

Para cambiar la URL del backend, edita la constante `API` en:
```
src/app/services/api.ts  →  const API = 'http://localhost:3000';
```

## 🛠️ Tecnologías

- **Angular 19** — Standalone components + lazy loading
- **TypeScript** — Tipado completo
- **SCSS** — Estilos con variables CSS
- **Fetch API** — Comunicación con el backend NestJS
- **JWT** — Autenticación con Bearer token

## 📦 Build de producción

```bash
ng build
# Salida en: dist/zona-avicola-angular/
```

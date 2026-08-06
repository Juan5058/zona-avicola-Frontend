// configuracion global de la aplicacion
import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes),
    // Requerido por ClasificacionService, que usa HttpClient para hablar
    // con el servidor Python de vision (localhost:8000). El resto de la
    // app usa fetch() nativo via ApiService, por eso nunca se habia
    // necesitado antes.
    provideHttpClient(),
  ],
};
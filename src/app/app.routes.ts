import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { ShellComponent } from './components/shell/shell';

export const routes: Routes = [
  { path: '', redirectTo: 'login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard').then((m) => m.DashboardComponent),
      },
      {
        path: 'gallinas',
        loadComponent: () => import('./pages/gallinas/gallinas').then((m) => m.GallinasComponent),
      },
      {
        path: 'clasificacion',
        loadComponent: () =>
          import('./pages/clasificacion/clasificacion').then((m) => m.ClasificacionComponent),
      },
      {
        path: 'inventario',
        loadComponent: () =>
          import('./pages/inventario/inventario').then((m) => m.InventarioComponent),
      },
      {
        path: 'reportes',
        loadComponent: () => import('./pages/reportes/reportes').then((m) => m.ReportesComponent),
      },
      {
        path: 'manual',
        loadComponent: () => import('./pages/manual/manual').then((m) => m.ManualComponent),
      },
      {
        path: 'configuracion',
        loadComponent: () =>
          import('./pages/configuracion/configuracion').then((m) => m.ConfiguracionComponent),
      },
    ],
  },
  { path: '**', redirectTo: 'login' },
];
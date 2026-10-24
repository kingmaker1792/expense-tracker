import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './auth.guard';

export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./pages/login/login').then((m) => m.Login) },
  { path: 'dashboard', canActivate: [authGuard], loadComponent: () => import('./pages/dashboard/dashboard').then((m) => m.Dashboard) },
  { path: 'expenses', canActivate: [authGuard], loadComponent: () => import('./pages/expenses/expenses').then((m) => m.Expenses) },
  { path: 'orders', canActivate: [authGuard], loadComponent: () => import('./pages/orders/orders').then((m) => m.Orders) },
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: '**', redirectTo: 'dashboard' },
];

import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, map, take } from 'rxjs';
import { FirebaseDataService } from './firebase-data.service';

export const authGuard: CanActivateFn = () => {
  const data = inject(FirebaseDataService);
  const router = inject(Router);
  return toObservable(data.authReady).pipe(
    filter(Boolean),
    take(1),
    map(() => data.user() ? true : router.createUrlTree(['/login'])),
  );
};

export const guestGuard: CanActivateFn = () => {
  const data = inject(FirebaseDataService);
  const router = inject(Router);
  return toObservable(data.authReady).pipe(
    filter(Boolean),
    take(1),
    map(() => data.user() ? router.createUrlTree(['/dashboard']) : true),
  );
};

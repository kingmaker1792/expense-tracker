import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseDataService } from '../../firebase-data.service';

@Component({ selector: 'app-login', templateUrl: './login.html' })
export class Login {
  readonly data = inject(FirebaseDataService);
  private readonly router = inject(Router);

  async login(): Promise<void> {
    if (await this.data.signInWithGoogle()) await this.router.navigateByUrl('/dashboard');
  }
}

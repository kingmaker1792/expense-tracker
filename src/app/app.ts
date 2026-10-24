import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Router } from '@angular/router';
import { FirebaseDataService } from './firebase-data.service';

@Component({ selector: 'app-root', imports: [RouterOutlet, RouterLink, RouterLinkActive], templateUrl: './app.html', styleUrl: './app.scss' })
export class App {
  readonly data = inject(FirebaseDataService);
  private readonly router = inject(Router);
  async signOut(): Promise<void> { await this.data.signOutUser(); await this.router.navigateByUrl('/login'); }
}

import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CommonModule } from '@angular/common';
import { SidebarComponent } from '../sidebar/sidebar';
import { HeaderComponent } from '../header/header';
import { ToastService, Toast } from '../../services/toast';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, CommonModule, SidebarComponent, HeaderComponent],
  template: `
    <div class="shell-wrap">
      <app-sidebar />
      <div id="main">
        <app-header />
        <div class="page-body">
          <router-outlet />
        </div>
      </div>
    </div>

    <div id="toast-container">
      <div *ngFor="let t of toasts" class="toast {{ t.type }}">
        <span>{{ icons[t.type] }}</span
        ><span>{{ t.msg }}</span>
      </div>
    </div>
  `,
  styles: [
    `
      .shell-wrap {
        display: flex;
        height: 100vh;
        overflow: hidden;
        width: 100%;
      }
    `,
  ],
})
export class ShellComponent implements OnInit {
  toasts: Toast[] = [];
  icons: Record<string, string> = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

  constructor(private toastService: ToastService) {}

  ngOnInit() {
    this.toastService.toasts$.subscribe((t) => {
      this.toasts.push(t);
      setTimeout(() => (this.toasts = this.toasts.filter((x) => x.id !== t.id)), 2800);
    });
  }
}
